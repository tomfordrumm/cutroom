// Web app: static UI, JSON API, resumable-friendly raw uploads, media with
// Range support, and a WebSocket terminal for signing the agents in.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { agentStatus, AGENT_LABELS, EFFORTS, normalizeAgentModels } from "./agent.js";
import { DEFAULT_PACK, installPackZip, listPacks, packSummary, removePack, resolvePack } from "./packs.js";
import { AGENTS, config, versionName, videoDir } from "./config.js";
import { activeJob, addMessage, db, enqueueJob, getSetting, getVideo, now, setSetting, updateVideo } from "./db.js";
import { bindChat, disconnectTelegram, NOTIFY_EVENTS, sendTest, setToken, telegramState, updateTelegram } from "./notify.js";
import { isJobConcurrency, jobConcurrency, machine, MAX_CONCURRENCY } from "./queue.js";
import { normalizeSound, SOUND_DEFAULTS, SOUND_LIMITS } from "./sound.js";
import { addEntry, listDictionary, removeEntry, updateEntry } from "./dictionary.js";
import { assetsDir, categoryDir, checkUpload, LIBRARY_CATEGORIES, listAssets, listLibrary, MEDIA_MIME } from "./library.js";
import { isWhisperModel, modelDownloaded, WHISPER_MODELS, whisperModelId } from "./models.js";
import { listSources } from "./sources.js";
import { attachTerminal } from "./terminal.js";
import { ensureWaveform, programToSource, versionTimeline, wordsAround } from "./timeline.js";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ...MEDIA_MIME,
  ".md": "text/markdown; charset=utf-8", ".log": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};
const SESSION_DAYS = 30;

// ---------- helpers ---------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "object" && !Buffer.isBuffer(body) ? MIME[".json"] : MIME[".txt"], ...headers });
  res.end(payload);
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "Слишком большой запрос");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Неверный JSON"); }
}

function safeName(name) {
  const base = path.basename(String(name ?? "")).replace(/[^\p{L}\p{N}._ -]+/gu, "_").trim();
  if (!base || base.startsWith(".")) throw new HttpError(400, "Неверное имя файла");
  return base;
}

async function serveFile(req, res, file, { download = false } = {}) {
  let info;
  try { info = await stat(file); } catch { throw new HttpError(404, "Файл не найден"); }
  if (!info.isFile()) throw new HttpError(404, "Файл не найден");
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const headers = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-cache" };
  if (download) headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
    start = Math.max(0, start); end = Math.min(info.size - 1, end);
    if (start > end) { res.writeHead(416, { "content-range": `bytes */${info.size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${info.size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    await pipeline(createReadStream(file, { start, end }), res).catch(() => {});
    return;
  }
  res.writeHead(200, { ...headers, "content-length": info.size });
  if (req.method === "HEAD") return res.end();
  await pipeline(createReadStream(file), res).catch(() => {});
}

async function receiveUpload(req, dir, name) {
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, name);
  const partial = path.join(dir, `.${name}.partial`);
  try {
    await pipeline(req, createWriteStream(partial));
    await rename(partial, target);
  } catch (error) {
    await unlink(partial).catch(() => {});
    throw error;
  }
  return target;
}

// ---------- auth -------------------------------------------------------------

const sign = (value) => createHmac("sha256", config.secret).update(value).digest("base64url");

function sessionCookie(req) {
  const expires = String(Date.now() + SESSION_DAYS * 86_400_000);
  const secure = req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
  return `cutroom=${expires}.${sign(expires)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86_400}${secure}`;
}

export function isAuthenticated(req) {
  if (!config.password) return true;
  const cookie = (req.headers.cookie ?? "").split(/;\s*/).find((part) => part.startsWith("cutroom="));
  if (!cookie) return false;
  const [expires, signature] = cookie.slice("cutroom=".length).split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = Buffer.from(sign(expires));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function passwordMatches(candidate) {
  const a = createHmac("sha256", "cmp").update(String(candidate ?? "")).digest();
  const b = createHmac("sha256", "cmp").update(config.password).digest();
  return timingSafeEqual(a, b);
}

// ---------- domain -----------------------------------------------------------

async function versionsOf(videoId) {
  const dir = path.join(videoDir(videoId), "versions");
  const names = (await readdir(dir).catch(() => [])).filter((name) => /^v\d{3}$/.test(name)).sort();
  const result = [];
  for (const name of names) {
    const vdir = path.join(dir, name);
    const read = async (file) => { try { return JSON.parse(await readFile(path.join(vdir, file), "utf8")); } catch { return null; } };
    const edit = await read("edit.json");
    if (!edit) continue;
    const build = await read("build.json");
    const outputs = await readdir(path.join(vdir, "out")).catch(() => []);
    result.push({
      number: Number(name.slice(1)),
      name,
      createdAt: edit.createdAt,
      durationSeconds: edit.output?.durationSeconds ?? null,
      removedSeconds: edit.output?.removedSeconds ?? null,
      agent: build?.agent ?? null,
      model: build?.agentRun?.usedModel ?? build?.agentRun?.model ?? null,
      buildSeconds: build?.seconds ?? null,
      files: outputs.filter((file) => !file.startsWith(".")),
    });
  }
  return result;
}

function videoSummary(video) {
  const job = activeJob(video.id) ?? db.prepare("SELECT * FROM jobs WHERE video_id = ? ORDER BY id DESC LIMIT 1").get(video.id) ?? null;
  return { ...video, job };
}

function requireVideo(id) {
  const video = getVideo(Number(id));
  if (!video) throw new HttpError(404, "Ролик не найден");
  return video;
}

function stateSnapshot() {
  return {
    onboarded: getSetting("onboarded", false),
    agent: getSetting("agent", "none"),
    agentLabels: AGENT_LABELS,
    agentStatus: agentStatus(),
    agentModels: normalizeAgentModels(getSetting("agentModels", {})),
    efforts: EFFORTS,
    pack: getSetting("pack", DEFAULT_PACK),
    defaults: getSetting("defaults", { language: "ru" }),
    whisperModel: whisperModelId(getSetting("whisperModel")),
    defaultMusic: getSetting("defaultMusic", null),
    jobConcurrency: jobConcurrency(getSetting("jobConcurrency")),
    sound: { ...SOUND_DEFAULTS, ...getSetting("sound", {}) },
    soundDefaults: SOUND_DEFAULTS,
    soundLimits: SOUND_LIMITS,
    maxConcurrency: MAX_CONCURRENCY,
    machine: machine(),
    authRequired: Boolean(config.password),
  };
}

async function tasteSnapshot() {
  const refs = await readdir(path.join(config.paths.taste, "refs")).catch(() => []);
  return {
    profile: await readFile(path.join(config.paths.taste, "profile.md"), "utf8").catch(() => ""),
    answers: getSetting("onboarding", {}),
    refs: refs.filter((name) => !name.startsWith(".")),
  };
}

function composeProfile(answers, refs) {
  const block = (title, text) => (String(text ?? "").trim() ? `## ${title}\n\n${String(text).trim()}\n` : "");
  return [
    "# Профиль вкуса",
    "",
    `Собран на онбординге ${now().slice(0, 10)}. Это постоянные правила автора: меняются только по его явному указанию, не по одной правке в ролике.`,
    "",
    block("Как я монтирую", answers.editing),
    block("Бренд и оформление", answers.brand),
    block("Пожелания к роликам по умолчанию", answers.defaults),
    refs.length ? `## Референсы\n\n${refs.map((name) => `- ${path.join(config.paths.taste, "refs", name)}`).join("\n")}\n\n${String(answers.refsNote ?? "").trim()}\n` : "",
  ].filter(Boolean).join("\n");
}

// ---------- routes -----------------------------------------------------------

const routes = [];
const route = (method, pattern, handler, { open = false } = {}) => {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, key) => { keys.push(key); return "([^/]+)"; })}$`);
  routes.push({ method, regex, keys, handler, open });
};

route("GET", "/healthz", (req, res) => send(res, 200, { ok: true }), { open: true });

route("GET", "/api/session", (req, res) => send(res, 200, { authenticated: isAuthenticated(req), authRequired: Boolean(config.password) }), { open: true });
route("POST", "/api/login", async (req, res) => {
  const { password } = await readBody(req);
  if (!config.password || passwordMatches(password)) return send(res, 200, { ok: true }, { "set-cookie": sessionCookie(req) });
  await new Promise((resolve) => setTimeout(resolve, 600));
  throw new HttpError(401, "Неверный пароль");
}, { open: true });
route("POST", "/api/logout", (req, res) => send(res, 200, { ok: true }, { "set-cookie": "cutroom=; Path=/; Max-Age=0" }));

route("GET", "/api/state", (req, res) => send(res, 200, stateSnapshot()));

route("PUT", "/api/settings", async (req, res) => {
  const body = await readBody(req);
  if (body.agent !== undefined) {
    if (!AGENTS.includes(body.agent)) throw new HttpError(400, "Неизвестный агент");
    setSetting("agent", body.agent);
  }
  if (body.agentModels) {
    try {
      const current = normalizeAgentModels(getSetting("agentModels", {}));
      const merged = { ...current };
      for (const [agent, entry] of Object.entries(body.agentModels)) merged[agent] = { ...current[agent], ...entry };
      setSetting("agentModels", normalizeAgentModels(merged));
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  }
  if (body.pack !== undefined) {
    const pack = (await listPacks()).find((p) => p.id === body.pack && !p.error);
    if (!pack) throw new HttpError(400, "Такого пакета вкуса нет");
    setSetting("pack", pack.id);
  }
  if (body.whisperModel !== undefined) {
    if (!isWhisperModel(body.whisperModel)) throw new HttpError(400, "Неизвестная модель распознавания");
    setSetting("whisperModel", body.whisperModel);
  }
  if (body.defaultMusic !== undefined) {
    if (body.defaultMusic !== null && !(await listLibrary()).music.some((f) => f.name === body.defaultMusic)) throw new HttpError(400, "Такого трека нет в библиотеке");
    setSetting("defaultMusic", body.defaultMusic);
  }
  if (body.sound !== undefined) {
    try { setSetting("sound", normalizeSound(body.sound === null ? {} : { ...getSetting("sound", {}), ...body.sound })); } catch (error) { throw new HttpError(400, error.message); }
  }
  if (body.jobConcurrency !== undefined) {
    if (!isJobConcurrency(body.jobConcurrency)) throw new HttpError(400, `Одновременно можно от 1 до ${MAX_CONCURRENCY} роликов`);
    setSetting("jobConcurrency", body.jobConcurrency);
  }
  if (body.defaults) setSetting("defaults", { ...getSetting("defaults", {}), ...body.defaults });
  if (body.onboarded !== undefined) setSetting("onboarded", Boolean(body.onboarded));
  send(res, 200, stateSnapshot());
});

// ---------- telegram ---------------------------------------------------------

const telegramSnapshot = () => ({ ...telegramState(), eventLabels: NOTIFY_EVENTS });
const telegram = async (action) => {
  try { await action(); } catch (error) { throw new HttpError(400, error.message); }
  return telegramSnapshot();
};

route("GET", "/api/telegram", (req, res) => send(res, 200, telegramSnapshot()));
route("POST", "/api/telegram/token", async (req, res) => {
  const { token, publicUrl } = await readBody(req);
  send(res, 200, await telegram(async () => {
    await setToken(token);
    // The page's own address is the best guess for links until the author sets one.
    if (publicUrl && !telegramState().publicUrl) updateTelegram({ publicUrl });
  }));
});
route("POST", "/api/telegram/bind", async (req, res) => send(res, 200, await telegram(() => bindChat())));
route("POST", "/api/telegram/test", async (req, res) => send(res, 200, await telegram(() => sendTest())));
route("PUT", "/api/telegram", async (req, res) => {
  const body = await readBody(req);
  send(res, 200, await telegram(() => updateTelegram(body)));
});
route("DELETE", "/api/telegram", (req, res) => { disconnectTelegram(); send(res, 200, telegramSnapshot()); });

async function packsSnapshot() {
  const active = (await resolvePack(getSetting("pack", DEFAULT_PACK)))?.id ?? null;
  return { active, packs: (await listPacks()).map(packSummary) };
}
route("GET", "/api/packs", async (req, res) => send(res, 200, await packsSnapshot()));
route("PUT", "/api/packs/upload", async (req, res) => {
  const dir = path.join(config.data, "packs", ".uploads");
  const file = await receiveUpload(req, dir, `${Date.now()}.zip`);
  try {
    const pack = await installPackZip(file);
    send(res, 200, { installed: packSummary(pack), ...(await packsSnapshot()) });
  } catch (error) {
    throw new HttpError(400, error.message);
  } finally {
    await unlink(file).catch(() => {});
  }
});
route("DELETE", "/api/packs/:id", async (req, res, { params }) => {
  try { await removePack(params.id); } catch (error) { throw new HttpError(400, error.message); }
  if (getSetting("pack", DEFAULT_PACK) === params.id) setSetting("pack", DEFAULT_PACK);
  send(res, 200, await packsSnapshot());
});

async function dictionarySnapshot() {
  const titles = new Map(db.prepare("SELECT id, title FROM videos").all().map((v) => [v.id, v.title]));
  const current = whisperModelId(getSetting("whisperModel"));
  return {
    entries: listDictionary().map((entry) => ({ ...entry, videoTitle: entry.videoId ? titles.get(entry.videoId) ?? null : null })),
    model: current,
    models: await Promise.all(WHISPER_MODELS.map(async (model) => ({ ...model, downloaded: await modelDownloaded(model.id) }))),
  };
}
const dictionaryFields = (body) => ({
  from: body.from === undefined ? undefined : body.from,
  to: body.to,
  videoId: body.videoId === undefined ? undefined : body.videoId == null ? null : requireVideo(body.videoId).id,
  status: body.status,
});
route("GET", "/api/dictionary", async (req, res) => send(res, 200, await dictionarySnapshot()));
route("POST", "/api/dictionary", async (req, res) => {
  const body = await readBody(req);
  const fields = dictionaryFields(body);
  try { addEntry({ from: fields.from, to: fields.to, videoId: fields.videoId ?? null }); } catch (error) { throw new HttpError(400, error.message); }
  send(res, 200, await dictionarySnapshot());
});
route("PATCH", "/api/dictionary/:id", async (req, res, { params }) => {
  const body = await readBody(req);
  try { updateEntry(Number(params.id), dictionaryFields(body)); } catch (error) { throw new HttpError(400, error.message); }
  send(res, 200, await dictionarySnapshot());
});
route("DELETE", "/api/dictionary/:id", async (req, res, { params }) => {
  removeEntry(Number(params.id));
  send(res, 200, await dictionarySnapshot());
});

async function librarySnapshot() {
  const files = await listLibrary();
  const defaultMusic = getSetting("defaultMusic", null);
  return {
    categories: Object.entries(LIBRARY_CATEGORIES).map(([id, { label }]) => ({ id, label, files: files[id] })),
    defaultMusic: files.music.some((f) => f.name === defaultMusic) ? defaultMusic : null,
  };
}
const libraryCategory = (id) => {
  if (!LIBRARY_CATEGORIES[id]) throw new HttpError(404, "Нет такого раздела библиотеки");
  return id;
};
route("GET", "/api/library", async (req, res) => send(res, 200, await librarySnapshot()));
route("PUT", "/api/library/:category", async (req, res, { params, query }) => {
  const category = libraryCategory(params.category);
  const name = safeName(query.get("name"));
  try { checkUpload(category, name); } catch (error) { throw new HttpError(400, error.message); }
  await receiveUpload(req, categoryDir(category), name);
  send(res, 200, await librarySnapshot());
});
route("DELETE", "/api/library/:category/:file", async (req, res, { params }) => {
  const category = libraryCategory(params.category);
  const name = safeName(decodeURIComponent(params.file));
  await unlink(path.join(categoryDir(category), name)).catch(() => {});
  if (category === "music" && getSetting("defaultMusic", null) === name) setSetting("defaultMusic", null);
  send(res, 200, await librarySnapshot());
});
route("GET", "/media/library/:category/:file", async (req, res, { params }) => {
  await serveFile(req, res, path.join(categoryDir(libraryCategory(params.category)), safeName(decodeURIComponent(params.file))));
});

route("GET", "/api/taste", async (req, res) => send(res, 200, await tasteSnapshot()));
route("PUT", "/api/taste", async (req, res) => {
  const body = await readBody(req);
  await mkdir(config.paths.taste, { recursive: true });
  if (body.answers) {
    setSetting("onboarding", body.answers);
    const refs = (await readdir(path.join(config.paths.taste, "refs")).catch(() => [])).filter((n) => !n.startsWith("."));
    await writeFile(path.join(config.paths.taste, "profile.md"), composeProfile(body.answers, refs));
  } else if (typeof body.profile === "string") {
    await writeFile(path.join(config.paths.taste, "profile.md"), body.profile);
  }
  send(res, 200, await tasteSnapshot());
});
route("PUT", "/api/taste/refs", async (req, res, { query }) => {
  await receiveUpload(req, path.join(config.paths.taste, "refs"), safeName(query.get("name")));
  send(res, 200, await tasteSnapshot());
});

route("GET", "/api/videos", (req, res) => {
  const videos = db.prepare("SELECT * FROM videos ORDER BY updated_at DESC").all().map(videoSummary);
  send(res, 200, { videos });
});
route("POST", "/api/videos", async (req, res) => {
  const { title, brief = "" } = await readBody(req);
  if (!String(title ?? "").trim()) throw new HttpError(400, "Нужно название");
  const stamp = now();
  const result = db.prepare("INSERT INTO videos (title, brief, stage, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)").run(String(title).trim(), String(brief), stamp, stamp);
  const id = Number(result.lastInsertRowid);
  await mkdir(path.join(videoDir(id), "sources"), { recursive: true });
  send(res, 201, videoSummary(getVideo(id)));
});
route("GET", "/api/videos/:id", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  const messages = db.prepare("SELECT * FROM messages WHERE video_id = ? ORDER BY id").all(video.id);
  send(res, 200, { ...videoSummary(video), sources: await listSources(video.id), assets: await listAssets(video.id), versions: await versionsOf(video.id), messages });
});
route("PATCH", "/api/videos/:id", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  const body = await readBody(req);
  const fields = {};
  if (typeof body.title === "string" && body.title.trim()) fields.title = body.title.trim();
  if (typeof body.brief === "string") fields.brief = body.brief;
  updateVideo(video.id, fields);
  send(res, 200, videoSummary(getVideo(video.id)));
});
route("DELETE", "/api/videos/:id", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  if (activeJob(video.id)) throw new HttpError(409, "Сначала остановите монтаж");
  // Everything of a video lives in its folder: recording, materials, analysis,
  // versions with previews and finals, frozen media. Files go first, so a
  // failure leaves the video in the list rather than a folder nobody sees.
  // The row's messages, jobs and video-only dictionary entries follow by cascade;
  // the shared library is not touched.
  try {
    await rm(videoDir(video.id), { recursive: true, force: true });
  } catch (error) {
    throw new HttpError(500, `Не удалось удалить файлы ролика: ${error.message}`);
  }
  db.prepare("DELETE FROM videos WHERE id = ?").run(video.id);
  send(res, 200, { ok: true });
});
route("PUT", "/api/videos/:id/sources", async (req, res, { params, query }) => {
  const video = requireVideo(params.id);
  if (activeJob(video.id)) throw new HttpError(409, "Идёт монтаж, загрузка подождёт");
  const name = safeName(query.get("name"));
  const dir = path.join(videoDir(video.id), "sources");
  // One recording per video in this version: a new upload replaces the old one.
  for (const old of await listSources(video.id)) if (old !== name) await unlink(path.join(dir, old)).catch(() => {});
  await receiveUpload(req, dir, name);
  addMessage(video.id, "system", `Загружен исходник ${name}.`);
  updateVideo(video.id, {});
  send(res, 200, { sources: await listSources(video.id) });
});
// Materials attached to the video: pictures, clips, audio the edit may use.
route("PUT", "/api/videos/:id/assets", async (req, res, { params, query }) => {
  const video = requireVideo(params.id);
  const name = safeName(query.get("name"));
  try { checkUpload(null, name); } catch (error) { throw new HttpError(400, error.message); }
  await receiveUpload(req, assetsDir(video.id), name);
  updateVideo(video.id, {});
  send(res, 200, { assets: await listAssets(video.id) });
});
route("DELETE", "/api/videos/:id/assets/:file", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  await unlink(path.join(assetsDir(video.id), safeName(decodeURIComponent(params.file)))).catch(() => {});
  send(res, 200, { assets: await listAssets(video.id) });
});
route("GET", "/media/videos/:id/assets/:file", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  await serveFile(req, res, path.join(assetsDir(video.id), safeName(decodeURIComponent(params.file))));
});

route("POST", "/api/videos/:id/messages", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  const { body, refVersion, atSeconds } = await readBody(req);
  if (!String(body ?? "").trim()) throw new HttpError(400, "Пустое сообщение");
  let pin = {};
  if (refVersion != null && Number.isFinite(Number(atSeconds))) {
    const timeline = await versionTimeline(video.id, Number(refVersion)).catch(() => null);
    if (!timeline) throw new HttpError(400, "Нет такой версии");
    const at = Math.min(Math.max(Number(atSeconds), 0), timeline.duration);
    pin = { refVersion: Number(refVersion), atSeconds: at, sourceSeconds: programToSource(timeline.segments, at), context: wordsAround(timeline, at) || null };
  }
  addMessage(video.id, "user", String(body).trim(), null, pin);
  updateVideo(video.id, {});
  send(res, 201, { ok: true });
});
// Only comments not yet sent to an edit can be removed; sent ones belong to a version's request.
route("DELETE", "/api/videos/:id/messages/:messageId", (req, res, { params }) => {
  const video = requireVideo(params.id);
  const message = db.prepare("SELECT version FROM messages WHERE id = ? AND video_id = ? AND role = 'user'").get(Number(params.messageId), video.id);
  if (!message) throw new HttpError(404, "Правка не найдена");
  if (message.version != null) throw new HttpError(409, "Эта правка уже ушла в версию");
  db.prepare("DELETE FROM messages WHERE id = ?").run(Number(params.messageId));
  updateVideo(video.id, {});
  send(res, 200, { ok: true });
});
route("POST", "/api/videos/:id/edit", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  if (activeJob(video.id)) throw new HttpError(409, "Монтаж уже идёт");
  if (!(await listSources(video.id)).length) throw new HttpError(400, "Сначала загрузите исходник");
  const agent = getSetting("agent", "none");
  if (agent !== "none" && !agentStatus()[agent]) throw new HttpError(400, `${AGENT_LABELS[agent]} не подключён: войдите в терминале настроек`);
  enqueueJob(video.id, "edit");
  updateVideo(video.id, { stage: "editing", accepted_version: null });
  addMessage(video.id, "system", video.latest_version ? "Отправлено на перемонтаж." : "Отправлено в монтаж.");
  send(res, 202, videoSummary(getVideo(video.id)));
});
route("POST", "/api/videos/:id/cancel", (req, res, { params }) => {
  const video = requireVideo(params.id);
  const job = activeJob(video.id);
  if (!job) throw new HttpError(409, "Нечего отменять");
  if (job.status === "queued") {
    db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ?").run(now(), job.id);
    if (job.kind === "edit") updateVideo(video.id, { stage: video.latest_version ? "review" : "draft" });
  } else {
    db.prepare("UPDATE jobs SET cancel_requested = 1 WHERE id = ?").run(job.id);
  }
  send(res, 200, { ok: true });
});
route("POST", "/api/videos/:id/accept", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  const { version = video.latest_version } = await readBody(req);
  if (!version) throw new HttpError(400, "Нет версии для приёмки");
  if (activeJob(video.id)) throw new HttpError(409, "Дождитесь окончания монтажа");
  updateVideo(video.id, { stage: "accepted", accepted_version: Number(version) });
  addMessage(video.id, "system", `Версия ${versionName(version)} принята. Рендерю финал в полном разрешении.`, Number(version));
  enqueueJob(video.id, "final", Number(version));
  send(res, 200, videoSummary(getVideo(video.id)));
});
route("POST", "/api/videos/:id/reopen", (req, res, { params }) => {
  const video = requireVideo(params.id);
  updateVideo(video.id, { stage: video.latest_version ? "review" : "draft", accepted_version: null });
  send(res, 200, videoSummary(getVideo(video.id)));
});
route("GET", "/api/videos/:id/versions/:version/timeline", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  const number = Number(params.version);
  const timeline = await versionTimeline(video.id, number).catch(() => { throw new HttpError(404, "Нет такой версии"); });
  const waveform = await ensureWaveform(video.id, number).catch((error) => { console.error(error); return null; });
  send(res, 200, { ...timeline, waveform: waveform ? `/media/videos/${video.id}/versions/${number}/waveform.png` : null });
});
route("GET", "/api/videos/:id/versions/:version/log", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  const file = path.join(videoDir(video.id), "versions", versionName(Number(params.version)), "agent.log");
  const text = await readFile(file, "utf8").catch(() => "Лог агента пуст.");
  send(res, 200, text.slice(-200_000));
});

route("GET", "/media/videos/:id/versions/:version/:file", async (req, res, { params, query }) => {
  const video = requireVideo(params.id);
  const name = safeName(decodeURIComponent(params.file));
  const vdir = path.join(videoDir(video.id), "versions", versionName(Number(params.version)));
  const inOut = path.join(vdir, "out", name);
  const file = (await stat(inOut).catch(() => null)) ? inOut : path.join(vdir, name);
  await serveFile(req, res, file, { download: query.has("download") });
});
route("GET", "/media/videos/:id/sources/:file", async (req, res, { params }) => {
  const video = requireVideo(params.id);
  await serveFile(req, res, path.join(videoDir(video.id), "sources", safeName(decodeURIComponent(params.file))));
});

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.resolve(config.paths.public, relative);
  if (!file.startsWith(config.paths.public)) throw new HttpError(404, "Не найдено");
  const found = await stat(file).catch(() => null);
  // Single-page app: unknown paths without an extension get index.html.
  if (!found && !path.extname(relative)) return serveFile(req, res, path.join(config.paths.public, "index.html"));
  return serveFile(req, res, file);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    const method = req.method === "HEAD" ? "GET" : req.method;
    for (const r of routes) {
      if (r.method !== method) continue;
      const match = r.regex.exec(url.pathname);
      if (!match) continue;
      if (!r.open && !isAuthenticated(req)) throw new HttpError(401, "Нужен вход");
      const params = Object.fromEntries(r.keys.map((key, i) => [key, match[i + 1]]));
      await r.handler(req, res, { params, query: url.searchParams });
      return;
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) throw new HttpError(404, "Не найдено");
    if (method !== "GET") throw new HttpError(405, "Метод не поддерживается");
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    const status = error.status ?? 500;
    if (status === 500) console.error(error);
    if (!res.headersSent) send(res, status, { error: error.message });
    else res.destroy();
  }
});

server.requestTimeout = 0; // large uploads
attachTerminal(server, { isAuthenticated });
server.listen(config.port, () => console.log(`Cutroom on http://0.0.0.0:${config.port}${config.password ? "" : " (no password set)"}`));
