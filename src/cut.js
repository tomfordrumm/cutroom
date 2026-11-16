// The cut of one version, built from the files in its folder. No database:
// the worker and the agent (through `cutroom cut`) call the same code.
//
//   context.json     written by the worker: source, analysis, settings, media
//   decisions.json   take decisions (openroughcut-decisions-v1)
//   overrides.json   keep/remove by source time (optional)
//   → timeline.json  kept pieces, words and units on program time
//   → out/cut.mp4    the cut at preview size, without graphics
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { packetWithDictionary } from "./dictionary-text.js";
import { analyze, applyDecisions, buildPlan, exportPlan } from "@openroughcut/core";
import { measureLoudness } from "./sound.js";
import { placeUnits, placeWords, segmentsFromKeeps } from "./timeline.js";

export const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
export const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
export async function exists(file) { try { await stat(file); return true; } catch { return false; } }
async function readText(file) { try { return await readFile(file, "utf8"); } catch { return ""; } }

export function previewResolution(media) {
  const scale = Math.min(1, 1280 / Math.max(media.width, media.height));
  const even = (value) => Math.max(2, Math.round(value * scale / 2) * 2);
  return { width: even(media.width), height: even(media.height), choice: "preview" };
}

/** Same frame with the short side at `size` px (final graphics render). */
export function shortSideResolution(media, size = 1080) {
  const scale = Math.min(1, size / Math.min(media.width, media.height));
  const even = (value) => Math.max(2, Math.round(value * scale / 2) * 2);
  return { width: even(media.width), height: even(media.height), choice: `short-${size}` };
}

/** The version's inputs: the shared analysis with the dictionary frozen into this version. */
export async function loadVersion(dir) {
  const context = await readJson(path.join(dir, "context.json"));
  const raw = await readJson(path.join(context.analysisDir, "review.json"));
  const { packet } = packetWithDictionary(raw, context.dictionary ?? []);
  return { ...context, packet };
}

function validateOverrides(value, duration) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : value?.overrides;
  if (!Array.isArray(list)) throw new Error("overrides.json должен быть массивом или { overrides: [...] }.");
  return list.map((entry, index) => {
    const start = Number(entry?.start);
    const end = Number(entry?.end);
    if (!["keep", "remove"].includes(entry?.action)) throw new Error(`overrides #${index + 1}: action должен быть keep или remove.`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start > duration) {
      throw new Error(`overrides #${index + 1}: неверный интервал ${entry?.start}–${entry?.end} (длительность ${duration.toFixed(2)} с).`);
    }
    return { action: entry.action, start, end: Math.min(end, duration), reason: typeof entry.reason === "string" ? entry.reason : null };
  });
}

/** Decisions, overrides and reply of the version, validated. Throws with a readable reason. */
export async function readAnswer(dir, packet, duration) {
  const decisionsPath = path.join(dir, "decisions.json");
  if (!(await exists(decisionsPath))) throw new Error("Нет decisions.json.");
  const decisions = await readJson(decisionsPath);
  decisions.review ??= "review.json";
  const speech = applyDecisions(packet, decisions);
  const overridesPath = path.join(dir, "overrides.json");
  const overrides = validateOverrides(await exists(overridesPath) ? await readJson(overridesPath) : [], duration);
  const reply = (await readText(path.join(dir, "reply.md"))).trim();
  return { decisions, speech, overrides, reply };
}

/**
 * Build the plan and timeline; with `render`, also out/cut.mp4. A render is
 * skipped when decisions and overrides did not change since the last one.
 */
export async function buildCut(dir, { signal, onProgress = () => {}, render = true } = {}) {
  const version = await loadVersion(dir);
  const { sourcePath, media, settings, packet } = version;
  const answer = await readAnswer(dir, packet, media.duration);
  onProgress("Собираю план монтажа", null);
  const analysis = await analyze(sourcePath, settings, { signal, media, speech: answer.speech });
  const plan = buildPlan(analysis, answer.overrides.map(({ action, start, end }) => ({ action, start, end })));
  if (!plan.keeps.length) throw new Error("План монтажа вырезает всю запись.");

  const segments = segmentsFromKeeps(plan.keeps, media.frameRate);
  const timeline = {
    duration: segments.at(-1)?.programEnd ?? 0,
    frameRate: media.frameRate,
    segments,
    words: placeWords(packet.transcript, segments),
    units: placeUnits(packet.units, segments),
  };
  await writeJson(path.join(dir, "timeline.json"), timeline);

  const cutPath = path.join(dir, "out", "cut.mp4");
  const stampPath = path.join(dir, "out", "cut.json");
  const inputs = createHash("sha256").update(JSON.stringify([plan.keeps, media.width, media.height])).digest("hex");
  let rendered = false;
  let voiceLufs = null;
  if (render) {
    let stamp = await exists(stampPath) ? await readJson(stampPath) : null;
    if (stamp?.inputs !== inputs || !(await exists(cutPath))) {
      onProgress("Рендер склейки", 0);
      await exportPlan(plan, {
        format: "mp4", inputPath: sourcePath, outputPath: cutPath, media, projectResolution: previewResolution(media), signal,
        onProgress: ({ percent }) => onProgress(`Рендер склейки · ${percent}%`, percent),
      });
      stamp = { inputs, ...previewResolution(media) };
      rendered = true;
    }
    // The voice as recorded, after the cut: music, effects and the master gain follow it.
    if (stamp.voiceLufs === undefined) {
      onProgress("Измеряю громкость голоса", null);
      stamp.voiceLufs = (await measureLoudness(cutPath, { signal }))?.lufs ?? null;
      await writeJson(stampPath, stamp);
    } else if (rendered) await writeJson(stampPath, stamp);
    voiceLufs = stamp.voiceLufs;
  }
  return { version, answer, analysis, plan, timeline, rendered, cutPath, voiceLufs };
}
