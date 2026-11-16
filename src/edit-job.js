// One editing run = one immutable version folder:
//
//   videos/<id>/sources/<file>                 uploaded recording
//   videos/<id>/analysis/<fingerprint>/        Whisper + take detection, reused by every version
//   videos/<id>/versions/vNNN/
//     request.json   what was asked (brief, comments, previous version)
//     context.json   source, analysis and settings for `cutroom` (src/cut.js)
//     AGENTS.md, CLAUDE.md, taste.md, review.json, transcript.md, dictionary.md, media.md   the agent's context
//     media/library/…, media/assets/…   files graphics.json uses, frozen with the version
//     decisions.json, overrides.json, graphics.json, custom/*.tsx, reply.md, dictionary.json, remember.json   the agent's answer
//     timeline.json  kept pieces and words on program time
//     edit.json      the recipe: source, settings, decisions, keeps, graphics (source of truth)
//     build.json     how it was built
//     out/cut.mp4 (no graphics), out/preview.mp4, out/report.json, out/final.mp4
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyze, createReport } from "@openroughcut/core";
import { assertSameSource, buildReviewPacket, DECISIONS_FORMAT, sourceFingerprint } from "@openroughcut/core/agent-review.js";
import { LAST_TAKE_DUPLICATE_MODE } from "@openroughcut/core/duplicate-modes.js";
import { probeMedia } from "@openroughcut/core/media.js";
import { keepsToSeconds, renderVideo } from "@openroughcut/core/render-video.js";
import { agentStatus, AGENT_LABELS, normalizeAgentModels, runAgent } from "./agent.js";
import { config, versionName, videoDir } from "./config.js";
import { addMessage, db, getSetting, getVideo, now, updateJob, updateVideo } from "./db.js";
import { buildCut, exists, previewResolution, readAnswer, readJson, shortSideResolution, writeJson } from "./cut.js";
import { detectFaces, facesSummary } from "./faces.js";
import { customComponents, graphicsMediaRefs, readGraphics, renderGraphicsVideo, reviewGraphics, safeArea, validateGraphics } from "./graphics.js";
import { freezeMedia, listAssets, listLibrary, mediaMarkdown, versionVideoId } from "./library.js";
import { DEFAULT_PACK, resolvePack, snapshotPack, versionPack } from "./packs.js";
import { activeEntries, dictionaryMarkdown, ingestProposals, packetWithDictionary, whisperPrompt } from "./dictionary.js";
import { ensureModels, whisperModelId } from "./models.js";
import { masterAudio, masterGainDb, measureLoudness, normalizeSound } from "./sound.js";
import { checkScenes } from "./scenes.js";
import { ingestRemember } from "./proposals.js";
import { recordRun } from "./usage.js";
import { listSources } from "./sources.js";
import { ensureWaveform } from "./timeline.js";

const EDIT_FORMAT = "cutroom-edit-v1";

async function readText(file) { try { return await readFile(file, "utf8"); } catch { return ""; } }


export function analysisSettings() {
  const defaults = getSetting("defaults", {});
  return {
    transcribe: true,
    duplicateMode: LAST_TAKE_DUPLICATE_MODE,
    applyTextEdits: true,
    // Coughs, throat clearing, "эээ" between phrases: cut sounds that carry no words.
    removeNonVerbal: defaults.removeNonVerbal !== false,
    language: defaults.language || "ru",
    thresholdDb: Number(defaults.thresholdDb ?? -35),
    minimumSilence: Number(defaults.minimumSilence ?? 0.7),
    keepPause: Number(defaults.keepPause ?? 0.18),
  };
}

function transcriptMarkdown(packet, sounds = []) {
  const lines = ["# Расшифровка по единицам", "", "id | начало–конец, с | текст | кем вырезано", "---|---|---|---"];
  for (const unit of packet.units) {
    lines.push(`${unit.id} | ${unit.start.toFixed(2)}–${unit.end.toFixed(2)} | ${unit.text.replace(/\|/g, "/")} | ${unit.cutBy ?? ""}`);
  }
  lines.push("", "# Кандидаты детектора дублей", "");
  if (!packet.candidates.length) lines.push("Детектор не нашёл повторных дублей.");
  for (const c of packet.candidates) {
    lines.push(`- ${c.id}: ${c.applied ? "ВЫРЕЗАН" : "предложение (не вырезан)"}; единицы ${c.units.join(", ") || "—"}; оставляет ${c.keptUnits.join(", ") || "—"}; причина: ${c.reason ?? "—"}${c.timed === false ? "; без точных границ слов" : ""}`);
    if (c.removedText) lines.push(`  - убирает: «${c.removedText}»`);
  }
  lines.push("", "# Звуки без слов", "", "Кашель, кряхтение, вдохи, «эээ» между фразами. Вырезанные уже убраны; остальные можно убрать через overrides.json (action remove).", "");
  if (!sounds.length) lines.push("Детектор не нашёл отдельных звуков без слов.");
  for (const sound of sounds) {
    lines.push(`- ${sound.start.toFixed(2)}–${sound.end.toFixed(2)} с: ${sound.applied ? "ВЫРЕЗАН" : "оставлен"}${sound.removedText ? `, распознано как «${sound.removedText}»` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Whisper + take detection once per recording; later versions reuse it. */
// The Whisper prompt is not part of the key: a new word would re-transcribe
// every recording. Words added later reach old recordings as replacements.
async function prepareAnalysis(videoId, sourcePath, { signal, step }) {
  const settings = analysisSettings();
  const model = whisperModelId(getSetting("whisperModel"));
  const fingerprint = await sourceFingerprint(sourcePath);
  const settingsHash = createHash("sha256").update(JSON.stringify(settings)).digest("hex").slice(0, 8);
  const key = `${fingerprint.sampleSha256.slice(0, 16)}-${model}-${settings.language}-${settingsHash}`;
  const dir = path.join(videoDir(videoId), "analysis", key);
  const packetPath = path.join(dir, "review.json");
  const mediaPath = path.join(dir, "media.json");
  const soundsPath = path.join(dir, "sounds.json");
  if (await exists(packetPath)) {
    const sounds = await exists(soundsPath) ? await readJson(soundsPath) : [];
    const media = await readJson(mediaPath);
    const faces = await ensureFaces(dir, sourcePath, media, { signal, step });
    const asr = await exists(path.join(dir, "asr.json")) ? await readJson(path.join(dir, "asr.json")) : { model };
    return { dir, packet: await readJson(packetPath), media, sounds, faces, fingerprint, settings, asr, reused: true };
  }
  await mkdir(dir, { recursive: true });
  step("models", "Проверяю модели Whisper");
  const models = await ensureModels(model, (message) => step("models", message));
  step("analyze", "Читаю звук и ищу паузы");
  const media = await probeMedia(sourcePath, { signal });
  const prompt = whisperPrompt(activeEntries(videoId));
  const asrStarted = Date.now();
  const analysis = await analyze(sourcePath, settings, {
    signal,
    media,
    models,
    whisper: { prompt, threads: config.whisperThreads },
    onProgress: ({ message, percent }) => step("analyze", message, percent),
  });
  const packet = buildReviewPacket({
    inputPath: sourcePath,
    fingerprint,
    media,
    transcript: analysis.transcription,
    textEdits: analysis.textEdits,
    applied: analysis.appliedTextEdits,
    settings: { duplicateMode: settings.duplicateMode, textConfidence: settings.textConfidence ?? 0.9 },
    reviewPath: "review.json",
    outputPath: null,
    applyCommand: "Cutroom применяет decisions.json сам после завершения агента",
  });
  const sounds = (analysis.nonVerbal?.candidates ?? []).map(({ start, end, applied, removedText, confidence }) => ({
    start, end, applied: Boolean(applied), removedText: removedText || null, confidence: confidence ?? null,
  }));
  await writeJson(mediaPath, media);
  await writeJson(soundsPath, sounds);
  const faces = await ensureFaces(dir, sourcePath, media, { signal, step });
  const asr = { model, prompt, threads: config.whisperThreads, seconds: Math.round((Date.now() - asrStarted) / 1000) };
  await writeJson(path.join(dir, "asr.json"), asr);
  await writeJson(packetPath, packet);
  return { dir, packet, media, sounds, faces, fingerprint, settings, asr, reused: false };
}

/** Face track once per recording, next to the analysis. A failure leaves graphics unchecked, not the edit. */
async function ensureFaces(dir, sourcePath, media, { signal, step }) {
  const file = path.join(dir, "faces.json");
  if (await exists(file)) return readJson(file);
  step("faces", "Ищу лицо в кадре", 0);
  try {
    const faces = await detectFaces(sourcePath, media, { signal, onProgress: (percent) => step("faces", "Ищу лицо в кадре", percent) });
    await writeJson(file, faces);
    return faces;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.error(`faces: ${error.message}`);
    return null;
  }
}

function layoutMarkdown(media, faces, pack) {
  const { width, height } = media;
  const safe = safeArea(width, height);
  const px = (v) => Math.round(v);
  return [
    "# Раскладка кадра",
    "",
    `Кадр ${width}×${height}. Безопасная зона площадки (интерфейс Shorts, Reels, TikTok или YouTube закрывает края): сверху ${px(safe.top)} px, снизу ${px(safe.bottom)} px, слева и справа ${px(safe.left)} px. Важный текст и графика — внутри неё.`,
    "",
    "## Лицо автора",
    "",
    facesSummary(faces),
    "",
    "Полный трек — `faces.json` (секунды исходника, рамки в долях кадра [x, y, ширина, высота, уверенность]). Встроенные элементы с `position: \"auto\"` сами встают выше или ниже лица и над субтитрами. Проверка — `cutroom gfx review`.",
    "",
    "## Пакет вкуса",
    "",
    pack ? `${pack.name} ${pack.version}: \`pack/instructions/README.md\`. Компоненты пакета: ${pack.components.join(", ") || "нет"}${Object.keys(pack.replaces).length ? `; заменяют встроенные: ${Object.entries(pack.replaces).map(([type, name]) => `${type} → ${name}`).join(", ")}` : ""}.` : "Пакет не подключён: только встроенные элементы и тема по умолчанию.",
    "",
  ].join("\n");
}

async function writeAgentContext(video, dir, { packet, media, sounds, faces, pack, sourcePath, previous, comments, agent, dictionary, materials }) {
  const instructions = await readFile(path.join(config.paths.instructions, "AGENTS.md"), "utf8");
  await writeFile(path.join(dir, "AGENTS.md"), instructions);
  await writeFile(path.join(dir, "CLAUDE.md"), instructions);
  await writeFile(path.join(dir, "taste.md"), (await readText(path.join(config.paths.taste, "profile.md"))) || "Профиль вкуса пока пуст.\n");
  await writeJson(path.join(dir, "review.json"), packet);
  await writeFile(path.join(dir, "transcript.md"), transcriptMarkdown(packet, sounds));
  if (faces) await writeJson(path.join(dir, "faces.json"), faces);
  await writeFile(path.join(dir, "layout.md"), layoutMarkdown(media, faces, pack));
  await writeFile(path.join(dir, "dictionary.md"), dictionaryMarkdown(dictionary.entries, dictionary.applied, dictionary.prompt));
  await writeFile(path.join(dir, "media.md"), mediaMarkdown(materials));
  await writeJson(path.join(dir, "request.json"), {
    video: { id: video.id, title: video.title },
    brief: video.brief,
    comments,
    source: { path: sourcePath, durationSeconds: media.duration, width: media.width, height: media.height, frameRate: media.frameRate },
    previousVersion: previous,
    assets: materials.assets.map(({ name, kind, duration, width, height }) => ({ file: `assets/${name}`, kind, duration, width, height })),
    defaultMusic: materials.defaultMusic ? `library/music/${materials.defaultMusic}` : null,
    agent,
    pack: pack ? { id: pack.id, name: pack.name, version: pack.version, instructions: "pack/instructions/README.md" } : null,
    output: {
      decisions: "decisions.json",
      overrides: "overrides.json",
      graphics: "graphics.json",
      reply: "reply.md",
      dictionary: "dictionary.json",
    remember: "remember.json",
    },
    decisionsTemplate: { format: DECISIONS_FORMAT, review: "review.json", keep: [], remove: [], cut: [], notes: "" },
  });
}

async function previousVersion(video) {
  if (!video.latest_version) return null;
  const dir = path.join(videoDir(video.id), "versions", versionName(video.latest_version));
  const load = async (name) => (await exists(path.join(dir, name)) ? readJson(path.join(dir, name)) : null);
  return {
    number: video.latest_version,
    decisions: await load("decisions.json"),
    overrides: await load("overrides.json"),
    graphics: await load("graphics.json"),
    reply: await readText(path.join(dir, "reply.md")),
  };
}

/** The previous version's answer is this version's starting point; the agent changes only what is asked. */
async function inheritPrevious(video, dir) {
  if (!video.latest_version) return;
  const from = path.join(videoDir(video.id), "versions", versionName(video.latest_version));
  for (const name of ["decisions.json", "overrides.json", "graphics.json"]) {
    if (await exists(path.join(from, name))) await copyFile(path.join(from, name), path.join(dir, name));
  }
  // Volumes of a version made before loudness settings were linear; here they would be multipliers.
  const legacy = !(await readJson(path.join(from, "context.json")).catch(() => ({}))).sound;
  const graphics = legacy ? await readJson(path.join(dir, "graphics.json")).catch(() => null) : null;
  if (Array.isArray(graphics?.audio)) {
    graphics.audio = graphics.audio.map(({ volume, pauseVolume, ...rest }) => rest);
    await writeJson(path.join(dir, "graphics.json"), graphics);
  }
  if (await exists(path.join(from, "custom"))) await cp(path.join(from, "custom"), path.join(dir, "custom"), { recursive: true });
  // Files the previous graphics used stay available even if removed from the library since.
  if (await exists(path.join(from, "media"))) await cp(path.join(from, "media"), path.join(dir, "media"), { recursive: true });
}

/** Library and this video's materials, as the agent sees them in media.md. */
async function materialsFor(videoId) {
  const library = await listLibrary();
  const defaultMusic = getSetting("defaultMusic", null);
  return { library, assets: await listAssets(videoId), defaultMusic: library.music.some((f) => f.name === defaultMusic) ? defaultMusic : null };
}

/** Everything the worker checks before building: decisions, overrides, graphics. */
async function validateVersion(dir, packet, duration) {
  const answer = await readAnswer(dir, packet, duration);
  const raw = await readGraphics(dir);
  if (raw) validateGraphics(raw, { duration, custom: await customComponents(dir), pack: await versionPack(dir), media: { videoId: await versionVideoId(dir), versionDir: dir } });
  return answer;
}

export async function runEditJob(job, { signal }) {
  const video = getVideo(job.video_id);
  if (!video) throw new Error("Ролик удалён.");
  const started = Date.now();
  const step = (name, message, percent = null) => updateJob(job.id, { step: message ? `${message}` : name, progress: percent });

  const sources = await listSources(video.id);
  if (!sources.length) throw new Error("Сначала загрузите исходник.");
  const sourcePath = path.join(videoDir(video.id), "sources", sources[0]);

  const number = (video.latest_version ?? 0) + 1;
  const name = versionName(number);
  const dir = path.join(videoDir(video.id), "versions", name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, "out"), { recursive: true });
  updateJob(job.id, { version: number });

  // Pending comments belong to this version's request from now on.
  db.prepare("UPDATE messages SET version = ? WHERE video_id = ? AND role = 'user' AND version IS NULL").run(number, video.id);
  const comments = db.prepare("SELECT body, created_at, ref_version, at_seconds, source_seconds, context FROM messages WHERE video_id = ? AND role = 'user' AND version = ? ORDER BY id")
    .all(video.id, number)
    .map((row) => (row.at_seconds == null ? { body: row.body, createdAt: row.created_at } : {
      body: row.body,
      createdAt: row.created_at,
      at: {
        version: versionName(row.ref_version),
        programSeconds: row.at_seconds,
        sourceSeconds: row.source_seconds,
        words: row.context,
      },
    }));

  const prepared = await prepareAnalysis(video.id, sourcePath, { signal, step });
  const { media, sounds, faces, fingerprint, settings } = prepared;
  assertSameSource(prepared.packet, fingerprint, media.duration, "Кэш анализа");
  signal.throwIfAborted();
  // The author's dictionary, frozen into this version: later changes reach the next one.
  let entries = activeEntries(video.id);
  let { packet, applied } = packetWithDictionary(prepared.packet, entries);
  // Loudness settings, frozen like the dictionary: a final render later sounds like this preview.
  const context = { sourcePath, analysisDir: prepared.dir, settings, media, fingerprint, dictionary: entries, sound: normalizeSound(getSetting("sound", {})) };
  await writeJson(path.join(dir, "context.json"), context);

  const agent = getSetting("agent", "none");
  const previous = await previousVersion(video);
  await inheritPrevious(video, dir);
  const packInfo = await snapshotPack(await resolvePack(getSetting("pack", DEFAULT_PACK)), dir);
  const pack = await versionPack(dir);
  const materials = await materialsFor(video.id);
  await writeAgentContext(video, dir, { packet, media, sounds, faces, pack, sourcePath, previous, comments, agent, materials, dictionary: { entries, applied, prompt: whisperPrompt(entries) } });

  let answer;
  let agentRun = null;
  let passedReview = null;
  if (agent === "none") {
    step("agent", "Агент не подключён: беру решения детектора");
    if (!(await exists(path.join(dir, "decisions.json")))) {
      await writeJson(path.join(dir, "decisions.json"), { format: DECISIONS_FORMAT, review: "review.json", keep: [], remove: [], cut: [], notes: "Решения детектора без агента." });
    }
    await writeFile(path.join(dir, "reply.md"), "Агент не подключён, поэтому это автоматическая черновая склейка: убраны паузы, повторные дубли и звуки без слов. Подключите Claude Code или Codex в настройках, чтобы монтаж учитывал пожелания, правки и графику.\n");
    answer = await validateVersion(dir, packet, media.duration);
  } else {
    const status = agentStatus();
    if (!status[agent]) throw new Error(`${AGENT_LABELS[agent]} не подключён. Откройте «Настройки → Агент» и войдите своей подпиской.`);
    const logPath = path.join(dir, "agent.log");
    const basePrompt = "Ты монтажёр в Cutroom. Прочитай AGENTS.md в текущей папке и выполни задачу из request.json. Работай только в текущей папке. Инструменты: команда cutroom (cutroom --help).";
    let prompt = basePrompt;
    const { model, effort } = normalizeAgentModels(getSetting("agentModels", {}))[agent];
    agentRun = { model: model || null, effort: effort || null, usedModel: null, usage: null };
    for (let attempt = 1; attempt <= 2; attempt++) {
      step("agent", attempt === 1 ? `${AGENT_LABELS[agent]} изучает материал` : `${AGENT_LABELS[agent]} исправляет ответ`);
      const runStarted = now();
      const result = await runAgent(agent, {
        prompt, cwd: dir, logPath, signal, model, effort,
        onActivity: (activity) => step("agent", `${AGENT_LABELS[agent]}: ${activity}`),
      });
      // Every attempt is paid for, whether or not its answer is used.
      recordRun({ videoId: video.id, version: number, jobId: job.id, attempt, agent, model: result.model, effort, usage: result.usage, exitCode: result.exitCode, startedAt: runStarted });
      agentRun.usage = addUsage(agentRun.usage, result.usage);
      signal.throwIfAborted();
      agentRun.usedModel = result.model ?? agentRun.usedModel;
      try {
        if (result.exitCode !== 0 && !(await exists(path.join(dir, "decisions.json")))) {
          throw new Error(`${AGENT_LABELS[agent]} завершился с кодом ${result.exitCode}. ${result.lastError}`.trim());
        }
        answer = await validateVersion(dir, packet, media.duration);
      } catch (error) {
        if (attempt === 2 || /завершился с кодом/.test(error.message)) throw error;
        prompt = `${basePrompt}\n\nПредыдущий ответ не прошёл проверку: ${error.message}\nИсправь файлы ответа и проверь их командами cutroom cut и cutroom gfx check.`;
        continue;
      }
      // Graphics: the core checks the layout itself; one more pass for the agent if it covers the face or captions.
      if (attempt === 1 && (await readGraphics(dir))) {
        step("review", "Проверяю раскладку графики");
        await buildCut(dir, { signal, onProgress: (message, percent) => step("render", message, percent) });
        const review = await reviewGraphics(dir, { duration: media.duration, size: previewResolution(media), onProgress: (message) => step("review", message) }).catch((error) => ({ status: "error", error }));
        if (review.status !== "fail" && review.status !== "error") passedReview = review;
        const sceneProblems = (await sceneCheck(dir, media.duration)).problems;
        if (review.status === "fail" || sceneProblems.length) {
          const layout = review.status === "fail" ? review.overlays.filter((o) => o.status === "fail")
            .map((o) => `${o.id}: ${[...new Set(o.samples.flatMap((sample) => sample.problems))].join("; ")}`).join("\n") : "";
          prompt = [
            basePrompt,
            layout ? `Проверка раскладки (cutroom gfx review) нашла ошибки:\n${layout}` : null,
            sceneProblems.length ? `Карта сцен и текст на экране (cutroom gfx check):\n${sceneProblems.join("\n")}` : null,
            "Исправь scenes.json, graphics.json или компоненты, запусти cutroom gfx check и cutroom gfx review и посмотри лист кадров. Остальное не меняй. Допиши в reply.md, что исправил.",
          ].filter(Boolean).join("\n\n");
          passedReview = review.status === "fail" ? null : passedReview;
          continue;
        }
      }
      break;
    }
  }

  // Words the agent found: spelled by an author comment, they correct this version too.
  const proposals = await ingestProposals(dir, { videoId: video.id, version: number, comments });
  // Preferences the agent noticed: the author answers them in the chat.
  const remember = await ingestRemember(dir, { videoId: video.id, version: number }).catch(() => []);
  if (proposals.active.length) {
    entries = activeEntries(video.id);
    ({ packet, applied } = packetWithDictionary(prepared.packet, entries));
    await writeJson(path.join(dir, "context.json"), { ...context, dictionary: entries });
    answer = await validateVersion(dir, packet, media.duration);
  }

  // Freeze the library files and materials the graphics use into the version.
  let frozenMedia = [];
  let soundSummary = null;
  const soundNote = (audio) => {
    const music = audio.filter((a) => a.type === "music");
    const sfx = audio.filter((a) => a.type === "sfx");
    return music.length || sfx.length ? [music.length ? `музыка ${music.map((m) => path.basename(m.file, path.extname(m.file))).join(", ")}` : null, sfx.length ? `эффектов ${sfx.length}` : null].filter(Boolean).join(", ") : null;
  };
  const finalGraphics = await readGraphics(dir);
  if (finalGraphics) {
    const checked = validateGraphics(finalGraphics, { duration: media.duration, custom: await customComponents(dir), pack: await versionPack(dir), media: { videoId: video.id, versionDir: dir } });
    frozenMedia = await freezeMedia(dir, graphicsMediaRefs(checked), video.id);
  }

  const cut = await buildCut(dir, { signal, onProgress: (message, percent) => step("render", message, percent) });
  const { plan, analysis, timeline } = cut;
  const previewSize = previewResolution(media);
  let graphicsResult = null;
  if (await readGraphics(dir)) {
    step("graphics", "Рендер графики", 0);
    graphicsResult = await renderGraphicsVideo(dir, {
      baseVideo: cut.cutPath,
      outPath: path.join(dir, "out", "preview.mp4"),
      size: { width: previewSize.width, height: previewSize.height },
      duration: media.duration,
      signal,
      onProgress: (message, percent) => step("graphics", percent == null ? message : `${message} · ${percent}%`, percent),
    });
  } else {
    await copyFile(cut.cutPath, path.join(dir, "out", "preview.mp4"));
  }
  const sound = await master(path.join(dir, "out", "preview.mp4"), context.sound, cut.voiceLufs, { signal, step: (message) => step("sound", message) });
  await ensureWaveform(video.id, number).catch(() => {});
  const sourceResolution = { width: media.width, height: media.height, choice: "source" };
  const report = createReport(analysis, plan, { exportFormat: "mp4", projectResolution: sourceResolution });
  await writeJson(path.join(dir, "out", "report.json"), report);

  const placed = graphicsResult ? await readJson(path.join(dir, "graphics.placed.json")) : null;
  const sceneResult = graphicsResult ? await sceneCheck(dir, media.duration) : null;
  // What actually sounds after the cut (an effect on a cut moment is dropped with a warning).
  if (placed?.audio) soundSummary = soundNote(placed.audio);
  await writeJson(path.join(dir, "edit.json"), {
    format: EDIT_FORMAT,
    version: number,
    createdAt: now(),
    source: { file: `sources/${sources[0]}`, durationSeconds: media.duration, frameRate: media.frameRate, width: media.width, height: media.height, ...fingerprint },
    analysis: { dir: path.relative(videoDir(video.id), prepared.dir), settings, whisperModel: prepared.asr.model, whisperPrompt: prepared.asr.prompt ?? null },
    dictionary: { entries: entries.length, applied },
    cut: {
      decisions: answer.decisions,
      overrides: answer.overrides,
      keeps: plan.keeps,
      removals: plan.removals.map(({ startFrame, endFrame, reason }) => ({ startFrame, endFrame, reason: reason ?? null })),
    },
    pack: packInfo,
    graphics: graphicsResult ? { file: "graphics.json", custom: await customComponents(dir), overlays: placed.overlays.length, audio: placed.audio?.length ?? 0, media: frozenMedia, warnings: placed.warnings } : null,
    sound,
    scenes: sceneResult ? { count: sceneResult.scenes.length, problems: sceneResult.problems } : null,
    output: { durationSeconds: timeline.duration, removedSeconds: media.duration - timeline.duration },
  });
  // The author sees whether the graphics clear the face and captions; reuse the agent-loop check if nothing changed since.
  let layoutReview = null;
  if (graphicsResult) {
    layoutReview = passedReview ?? await (async () => {
      step("review", "Проверяю раскладку графики");
      return reviewGraphics(dir, { duration: media.duration, size: previewSize, onProgress: (message) => step("review", message) }).catch(() => null);
    })();
  }
  await writeJson(path.join(dir, "build.json"), {
    agent,
    agentRun,
    pack: packInfo,
    layoutReview: layoutReview ? { status: layoutReview.status, checkedAt: layoutReview.checkedAt } : null,
    analysisReused: prepared.reused,
    asr: prepared.asr,
    dictionary: { applied, proposed: proposals.proposed.map((e) => e.id), activated: proposals.active.map((e) => e.id), errors: proposals.errors },
    startedAt: new Date(started).toISOString(),
    finishedAt: now(),
    seconds: Math.round((Date.now() - started) / 1000),
    preview: { path: "out/preview.mp4", ...previewSize, graphics: Boolean(graphicsResult) },
    sound,
  });

  const sceneNote = sceneResult?.problems.length ? `\nКарта сцен: осталось замечаний ${sceneResult.problems.length} — ${sceneResult.problems.slice(0, 3).join("; ")}${sceneResult.problems.length > 3 ? "…" : ""}` : "";
  const loudness = sound?.voiceLufs != null ? ` Громкость: голос ${fmtDb(sound.voiceLufs)} → ${fmtDb(sound.outputLufs ?? sound.settings.targetLufs)} LUFS.` : "";
  const spent = agentRun?.usage ? ` Агент: ${usageLine(agentRun.usage)}.` : "";
  const extras = `${graphicsResult ? ` Графика: ${graphicsResult.overlays} элементов.` : ""}${soundSummary ? ` Звук: ${soundSummary}.` : ""}${loudness}${spent}`;
  const warnings = placed?.warnings?.length ? `\nНе показано: ${placed.warnings.join("; ")}` : "";
  const layoutIssues = layoutReview?.overlays?.filter((o) => o.status !== "pass") ?? [];
  const layoutNote = layoutIssues.length
    ? `\nПроверка раскладки: ${layoutIssues.map((o) => `${o.id} — ${[...new Set(o.samples.flatMap((sample) => sample.problems))].join("; ")}`).join("; ")}`
    : "";
  const words = (count) => `${count} ${count % 10 === 1 && count % 100 !== 11 ? "раз" : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? "раза" : "раз"}`;
  const dictionaryNote = [
    applied.length ? `\nСловарь: ${applied.map((item) => `«${item.from}» → «${item.to}» ${words(item.count)}`).join(", ")}.` : "",
    proposals.active.length ? `\nВ словарь по вашей правке: ${proposals.active.map((e) => `«${e.from}» → «${e.to}»`).join(", ")}.` : "",
    proposals.proposed.length ? `\nАгент предлагает в словарь: ${proposals.proposed.map((e) => `«${e.from}» → «${e.to}»`).join(", ")}. Ответьте ниже.` : "",
    remember.length ? `\nАгент предлагает запомнить в профиле вкуса: ${remember.length}. Ответьте ниже.` : "",
  ].join("");
  const summary = `Версия ${name}: ${timeline.duration.toFixed(1)} с из ${media.duration.toFixed(1)} с, вырезано ${Math.max(0, media.duration - timeline.duration).toFixed(1)} с. Распознавание: ${prepared.asr.model}.${extras}${packInfo ? ` Пакет: ${packInfo.name}.` : ""}${warnings}${layoutNote}${sceneNote}${dictionaryNote}`;
  addMessage(video.id, "agent", answer.reply || "Готово.", number);
  addMessage(video.id, "system", summary, number);
  updateVideo(video.id, { stage: "review", latest_version: number });
}

/** The scene map check on the version's validated graphics; never throws. */
async function sceneCheck(dir, duration) {
  try {
    const raw = await readGraphics(dir);
    if (!raw) return { problems: [], scenes: [] };
    const graphics = validateGraphics(raw, { duration, custom: await customComponents(dir), pack: await versionPack(dir), media: { videoId: await versionVideoId(dir), versionDir: dir } });
    return await checkScenes(dir, graphics);
  } catch (error) {
    return { problems: [error.message], scenes: [] };
  }
}

/** "$1,31 по ценам API, 1,5 млн токенов, попыток 2". */
function usageLine(usage) {
  const tokens = (usage.inputTokens ?? 0) + (usage.cacheWriteTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.outputTokens ?? 0);
  const amount = tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1).replace(".", ",")} млн` : `${Math.round(tokens / 1000)} тыс.`;
  const cost = usage.costUsd != null ? `$${usage.costUsd.toFixed(2).replace(".", ",")} по ценам API, ` : "";
  return `${cost}${amount} токенов${usage.attempts > 1 ? `, попыток ${usage.attempts}` : ""}`;
}

/** Sum of two runs' usage; the cost stays null when a run had none (Codex). */
function addUsage(a, b) {
  if (!b) return a;
  if (!a) return { ...b, attempts: 1 };
  const sum = (key) => (a[key] ?? 0) + (b[key] ?? 0);
  return {
    inputTokens: sum("inputTokens"), cacheWriteTokens: sum("cacheWriteTokens"), cacheReadTokens: sum("cacheReadTokens"),
    outputTokens: sum("outputTokens"), thinkingTokens: sum("thinkingTokens"),
    costUsd: a.costUsd == null || b.costUsd == null ? null : a.costUsd + b.costUsd,
    costBasis: a.costBasis ?? b.costBasis, apiMs: sum("apiMs"), models: [...new Set([...(a.models ?? []), ...(b.models ?? [])])], attempts: (a.attempts ?? 1) + 1,
  };
}

const fmtDb = (value) => value.toFixed(1).replace("-", "−").replace(".", ",");

/**
 * Brings a rendered file's voice to the author's target and limits peaks.
 * Versions without frozen sound settings, or a recording without a
 * measurable voice, are left as rendered.
 */
async function master(file, settings, voiceLufs, { signal, step = () => {} }) {
  if (!settings) return null;
  if (voiceLufs == null) return { settings, voiceLufs: null, gainDb: 0, outputLufs: null };
  step("Выравниваю громкость");
  const gainDb = masterGainDb(voiceLufs, settings);
  await masterAudio(file, { gainDb, signal });
  const output = await measureLoudness(file, { signal });
  return { settings, voiceLufs, gainDb, outputLufs: output?.lufs ?? null, outputPeak: output?.peak ?? null };
}

/** Final render of an accepted version, from its edit.json: source resolution, or 1080p with graphics. */
export async function runFinalJob(job, { signal }) {
  const video = getVideo(job.video_id);
  const number = job.version ?? video.accepted_version ?? video.latest_version;
  const dir = path.join(videoDir(video.id), "versions", versionName(number));
  const edit = await readJson(path.join(dir, "edit.json"));
  const sourcePath = path.join(videoDir(video.id), edit.source.file);
  const media = await probeMedia(sourcePath, { signal });
  const progress = (message, percent) => updateJob(job.id, { step: percent == null ? message : `${message} · ${percent}%`, progress: percent });
  const keeps = keepsToSeconds(edit.cut.keeps, media.frameRate);
  const finalPath = path.join(dir, "out", "final.mp4");
  // Same settings and voice measurement as the preview, so the final sounds the same.
  const context = await readJson(path.join(dir, "context.json")).catch(() => ({}));
  const voiceLufs = (await readJson(path.join(dir, "out", "cut.json")).catch(() => ({}))).voiceLufs ?? null;
  const finalSound = () => master(finalPath, context.sound ?? null, voiceLufs, { signal, step: (message) => progress(`Рендер финала: ${message.toLowerCase()}`, null) });
  if (edit.graphics && await exists(path.join(dir, "graphics.json"))) {
    // Chromium draws graphics at 1080p; a 4K pass would take many times longer.
    const size = shortSideResolution(media, 1080);
    const basePath = path.join(dir, "out", ".final-base.mp4");
    try {
      progress("Рендер финала: склейка", 0);
      await renderVideo(sourcePath, basePath, { keeps, media, projectResolution: size, signal, onProgress: ({ percent }) => progress("Рендер финала: склейка", percent) });
      await renderGraphicsVideo(dir, { baseVideo: basePath, outPath: finalPath, size: { width: size.width, height: size.height }, duration: media.duration, signal, onProgress: (message, percent) => progress(`Рендер финала: ${message.toLowerCase()}`, percent) });
    } finally {
      await unlink(basePath).catch(() => {});
    }
    await finalSound();
    addMessage(video.id, "system", `Финал версии ${versionName(number)} с графикой готов: ${size.width}×${size.height}.`, number);
    return;
  }
  progress("Рендер финала", 0);
  await renderVideo(sourcePath, finalPath, { keeps, media, projectResolution: { width: media.width, height: media.height }, signal, onProgress: ({ percent }) => progress("Рендер финала", percent) });
  await finalSound();
  addMessage(video.id, "system", `Финальный файл версии ${versionName(number)} готов в полном разрешении.`, number);
}
