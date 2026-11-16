// Loudness: the voice sets the level, music and effects sit relative to it,
// and the finished mix is brought to the author's target with a limiter.
//
//   1. The cut's voice is measured (integrated LUFS, EBU R128).
//   2. Every music and effect file of a version is measured too, so the
//      agent's `volume` means the same for a quiet click and a loud stinger:
//      1 = the author's level relative to the voice, below 1 quieter.
//   3. After rendering, the whole mix gets one gain (target − voice) and a
//      peak limiter, so the voice lands on the target and nothing clips.
//
// The settings are frozen into a version's context.json; versions made before
// this existed keep their linear volumes and are not mastered.
import { execFile } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export const SOUND_FORMAT = 1;
// dB relative to the voice; the target is LUFS integrated.
export const SOUND_DEFAULTS = { targetLufs: -14, sfxDb: -10, musicDb: -20, musicPauseDb: -12 };
export const SOUND_LIMITS = {
  targetLufs: [-24, -9],
  sfxDb: [-30, 0],
  musicDb: [-40, -6],
  musicPauseDb: [-40, 0],
};
// The limiter's ceiling (dBFS) and the most a track may be boosted.
const CEILING_DB = -1;
const MAX_TRACK_GAIN = 4;

export function normalizeSound(value = {}) {
  const result = { ...SOUND_DEFAULTS };
  for (const [key, [min, max]] of Object.entries(SOUND_LIMITS)) {
    if (value?.[key] === undefined) continue;
    const number = Number(value[key]);
    if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${key}: число от ${min} до ${max}.`);
    result[key] = Math.round(number * 10) / 10;
  }
  if (result.musicPauseDb < result.musicDb) throw new Error("Музыка в паузах не может быть тише, чем под голосом.");
  return result;
}

/**
 * Integrated loudness and true-ish peak of a file's audio. Short effects are
 * padded with silence: EBU R128 gates silence out but needs 400 ms blocks.
 * Returns null for a file without audio or with nothing above the gate.
 */
export async function measureLoudness(file, { pad = false, signal } = {}) {
  const filter = `${pad ? "apad=pad_dur=1," : ""}ebur128=peak=sample`;
  let stderr;
  try {
    ({ stderr } = await run("ffmpeg", ["-nostats", "-hide_banner", "-i", file, "-vn", "-af", filter, "-f", "null", "-"], { signal, maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1]);
  if (!Number.isFinite(lufs) || lufs <= -69) return null;
  return { lufs, peak: Number.isFinite(peak) ? peak : null };
}

const dbToGain = (db) => 10 ** (db / 20);
const round = (value, digits = 4) => Number(value.toFixed(digits));

/**
 * Linear Remotion volumes for one track. `volume` and `pauseVolume` are the
 * agent's multipliers (≤ 1) of the author's level.
 */
export function trackGains({ type, fileLufs, voiceLufs, settings, volume = 1, pauseVolume = 1 }) {
  if (fileLufs == null || voiceLufs == null) return null;
  const gain = (db, multiplier) => round(Math.min(MAX_TRACK_GAIN, dbToGain(voiceLufs + db - fileLufs) * multiplier));
  if (type === "sfx") return { volume: gain(settings.sfxDb, volume) };
  return { volume: gain(settings.musicDb, volume), pauseVolume: gain(settings.musicPauseDb, pauseVolume) };
}

/** Loudness of every audio file a version uses, cached in sound.json by reference. */
export async function measureTracks(dir, files, { signal } = {}) {
  const cacheFile = path.join(dir, "sound.json");
  const cache = JSON.parse(await readFile(cacheFile, "utf8").catch(() => "{}"));
  cache.files ??= {};
  let changed = false;
  for (const [ref, { file, type }] of Object.entries(files)) {
    if (cache.files[ref] !== undefined) continue;
    cache.files[ref] = (await measureLoudness(file, { pad: type === "sfx", signal }))?.lufs ?? null;
    changed = true;
  }
  if (changed) await writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`);
  return cache.files;
}

/**
 * The final step of a render: one gain for the whole mix and a limiter.
 * Video is copied, audio re-encoded. Replaces `file` in place.
 */
export async function masterAudio(file, { gainDb, signal }) {
  const partial = path.join(path.dirname(file), `.${path.basename(file)}.master.mp4`);
  const limit = dbToGain(CEILING_DB).toFixed(4);
  const filter = `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${limit}:attack=5:release=60:level=false`;
  try {
    await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-map", "0:v?", "-map", "0:a?", "-c:v", "copy", "-af", filter, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", partial], { signal, maxBuffer: 16 * 1024 * 1024 });
    await rename(partial, file);
  } finally {
    await rm(partial, { force: true });
  }
}

/** Gain that brings the measured voice to the target. */
export const masterGainDb = (voiceLufs, settings) => round(settings.targetLufs - voiceLufs, 2);
