// A version's timeline: kept pieces of the recording laid end to end, with
// words placed on program time. Comments are made on program time (what the
// author watches) and handed to the agent in source time (what it edits).
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { versionName, videoDir } from "./config.js";

const round = (value) => Math.round(value * 1000) / 1000;

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function words(transcript) {
  const result = [];
  for (const segment of transcript?.segments ?? []) {
    for (const word of segment.words ?? []) {
      const text = String(segment.text ?? "").slice(word.startChar, word.endChar).trim();
      if (text && Number.isFinite(word.start) && Number.isFinite(word.end)) result.push({ start: word.start, end: word.end, text });
    }
  }
  return result;
}

export function segmentsFromKeeps(keeps, frameRate) {
  const seconds = (frames) => frames * frameRate.denominator / frameRate.numerator;
  let cursor = 0;
  return keeps.map(({ startFrame, endFrame }) => {
    const sourceStart = seconds(startFrame);
    const sourceEnd = seconds(endFrame);
    const segment = { programStart: round(cursor), programEnd: round(cursor + sourceEnd - sourceStart), sourceStart: round(sourceStart), sourceEnd: round(sourceEnd) };
    cursor += sourceEnd - sourceStart;
    return segment;
  });
}

export function programToSource(segments, t) {
  const segment = segments.find((s) => t >= s.programStart && t <= s.programEnd) ?? segments.at(-1);
  if (!segment) return t;
  return round(segment.sourceStart + Math.min(Math.max(t - segment.programStart, 0), segment.sourceEnd - segment.sourceStart));
}

/** Program time of source second `t`, or null when that moment was cut. */
export function sourceToProgram(segments, t) {
  const segment = segments.find((s) => t >= s.sourceStart && t <= s.sourceEnd);
  return segment ? round(segment.programStart + t - segment.sourceStart) : null;
}

/**
 * A source interval laid onto program time. A start inside a cut moves to the
 * next kept moment, an end inside a cut to the previous one; null if nothing
 * of the interval survives the cut.
 */
export function sourceRangeToProgram(segments, start, end) {
  const from = sourceToProgram(segments, start) ?? segments.find((s) => s.sourceStart >= start)?.programStart ?? null;
  const to = sourceToProgram(segments, end) ?? [...segments].reverse().find((s) => s.sourceEnd <= end)?.programEnd ?? null;
  return from === null || to === null || to <= from ? null : { start: from, end: to };
}

/** Transcript words that survive the cut, on program time. */
export function placeWords(transcript, segments) {
  return words(transcript).flatMap((word) => {
    const middle = sourceToProgram(segments, (word.start + word.end) / 2);
    if (middle === null) return [];
    const half = (word.end - word.start) / 2;
    return [{ start: Math.max(0, round(middle - half)), end: round(middle + half), text: word.text, source: round(word.start) }];
  });
}

/** Transcript units (u1…) that survive the cut, for the agent's overview. */
export function placeUnits(units, segments) {
  return (units ?? []).flatMap((unit) => {
    const range = sourceRangeToProgram(segments, unit.start, unit.end);
    return range ? [{ id: unit.id, programStart: range.start, programEnd: range.end, sourceStart: unit.start, sourceEnd: unit.end, text: unit.text }] : [];
  });
}

async function readOptional(file) {
  try { return await readJson(file); } catch { return null; }
}

/** Timeline of version `number`: { duration, segments, words, overlays } in program seconds. */
export async function versionTimeline(videoId, number) {
  const root = videoDir(videoId);
  const dir = path.join(root, "versions", versionName(number));
  const placedGraphics = await readOptional(path.join(dir, "graphics.placed.json"));
  const overlays = (placedGraphics?.overlays ?? []).map(({ id, type, component, start, end, label }) => ({ id, type, component, start, end, label }));
  const saved = await readOptional(path.join(dir, "timeline.json"));
  if (saved) return { version: number, duration: saved.duration, segments: saved.segments, words: saved.words, overlays };
  // Versions made before timeline.json: rebuild from the recipe.
  const edit = await readJson(path.join(dir, "edit.json"));
  const segments = segmentsFromKeeps(edit.cut.keeps, edit.source.frameRate);
  const packet = await readOptional(path.join(root, edit.analysis.dir, "review.json"));
  return { version: number, duration: segments.at(-1)?.programEnd ?? 0, segments, words: packet ? placeWords(packet.transcript, segments) : [], overlays };
}

/**
 * A program stretch laid onto the source: one interval per kept piece it
 * crosses. Cuts inside the stretch fall between the intervals.
 */
export function programRangeToSource(segments, start, end) {
  if (!segments.length) return [{ start: round(start), end: round(end) }];
  return segments
    .filter((s) => s.programEnd > start && s.programStart < end)
    .map((s) => ({
      start: round(s.sourceStart + Math.max(start - s.programStart, 0)),
      end: round(s.sourceStart + Math.min(end, s.programEnd) - s.programStart),
    }))
    .filter((r) => r.end > r.start);
}

/**
 * Text spoken around program second `programSeconds`, for a comment's context.
 * With `endSeconds`, the words of the whole stretch (a little padding on each side).
 */
export function wordsAround(timeline, programSeconds, radius = 2.5, endSeconds = null) {
  const from = endSeconds == null ? programSeconds - radius : programSeconds - 0.3;
  const to = endSeconds == null ? programSeconds + radius : endSeconds + 0.3;
  return timeline.words
    .filter((w) => w.end >= from && w.start <= to)
    .map((w) => w.text)
    .join(" ");
}

/** out/waveform.png of a version's preview, drawn once with FFmpeg. */
export async function ensureWaveform(videoId, number) {
  const out = path.join(videoDir(videoId), "versions", versionName(number), "out");
  const target = path.join(out, "waveform.png");
  if (await stat(target).then(() => true, () => false)) return target;
  const preview = path.join(out, "preview.mp4");
  if (!(await stat(preview).then(() => true, () => false))) return null;
  await promisify(execFile)("ffmpeg", [
    "-v", "error", "-y", "-i", preview,
    "-filter_complex", "aformat=channel_layouts=mono,compand=gain=4,showwavespic=s=2400x160:colors=0x8a8d93",
    "-frames:v", "1", target,
  ]);
  return target;
}
