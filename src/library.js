// Media the edit can use besides the recording.
//
//   /data/library/music|sfx|other/<file>   the author's library, shared by every video
//   /data/videos/<id>/assets/<file>        materials attached to one video
//
// graphics.json names a file by reference: "library/sfx/Whoosh 1.mp3" or
// "assets/logo.png". A version freezes the files it uses into
// <version>/media/<reference> (hard links), so deleting a library file later
// does not break its preview or final render.
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { copyFile, link, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config, videoDir } from "./config.js";

const run = promisify(execFile);

export const LIBRARY_DIR = path.join(config.data, "library");
export const LIBRARY_CATEGORIES = {
  music: { label: "Музыка", kinds: ["audio"] },
  sfx: { label: "Звуковые эффекты", kinds: ["audio"] },
  other: { label: "Прочее", kinds: ["audio", "image", "video"] },
};
const EXTENSIONS = {
  audio: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"],
  image: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"],
  video: [".mp4", ".mov", ".m4v", ".webm"],
};
export const MEDIA_MIME = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/mp4", ".webm": "video/webm",
};
const MAX_FILE = 2 * 1024 ** 3;

export function mediaKind(name) {
  const ext = path.extname(String(name)).toLowerCase();
  return Object.entries(EXTENSIONS).find(([, list]) => list.includes(ext))?.[0] ?? null;
}

/** Throws unless `name` is a file type the category accepts. */
export function checkUpload(category, name) {
  const kind = mediaKind(name);
  const allowed = category ? LIBRARY_CATEGORIES[category]?.kinds : ["audio", "image", "video"];
  if (!allowed) throw new Error("Неизвестный раздел библиотеки.");
  if (!kind || !allowed.includes(kind)) {
    const list = allowed.flatMap((k) => EXTENSIONS[k]).join(", ");
    throw new Error(`Этот тип файла сюда не подходит. Можно: ${list}.`);
  }
  return kind;
}
export { MAX_FILE };

export const assetsDir = (videoId) => path.join(videoDir(videoId), "assets");
export const categoryDir = (category) => path.join(LIBRARY_DIR, category);

// ---------- probing, cached per folder ---------------------------------------

async function probe(file, kind) {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", file], { timeout: 20_000 });
    const data = JSON.parse(stdout);
    // Cover art in an MP3 is a "video" stream too; audio files have no picture size.
    const visual = kind === "audio" ? null : data.streams?.find((s) => s.codec_type === "video");
    const duration = Number(data.format?.duration);
    return {
      duration: kind === "image" || !Number.isFinite(duration) ? null : Math.round(duration * 100) / 100,
      width: visual?.width ?? null,
      height: visual?.height ?? null,
      hasAudio: Boolean(data.streams?.some((s) => s.codec_type === "audio")),
    };
  } catch {
    return { duration: null, width: null, height: null, hasAudio: kind === "audio" };
  }
}

/** Files of one folder with kind, size, duration and dimensions. */
export async function listFolder(dir) {
  const names = (await readdir(dir).catch(() => [])).filter((name) => !name.startsWith(".") && mediaKind(name)).sort((a, b) => a.localeCompare(b, "ru"));
  const indexFile = path.join(dir, ".index.json");
  const cache = JSON.parse(await readFile(indexFile, "utf8").catch(() => "{}"));
  const next = {};
  let changed = false;
  const files = [];
  for (const name of names) {
    const info = await stat(path.join(dir, name)).catch(() => null);
    if (!info?.isFile()) continue;
    const kind = mediaKind(name);
    const key = `2:${info.size}:${Math.round(info.mtimeMs)}`;
    let meta = cache[name]?.key === key ? cache[name].meta : null;
    if (!meta) { meta = await probe(path.join(dir, name), kind); changed = true; }
    next[name] = { key, meta };
    files.push({ name, kind, size: info.size, ...meta });
  }
  if (changed || Object.keys(cache).length !== Object.keys(next).length) await writeFile(indexFile, JSON.stringify(next)).catch(() => {});
  return files;
}

export async function listLibrary() {
  const result = {};
  for (const category of Object.keys(LIBRARY_CATEGORIES)) result[category] = await listFolder(categoryDir(category));
  return result;
}

export const listAssets = (videoId) => listFolder(assetsDir(videoId));

// ---------- references ---------------------------------------------------------

/**
 * A graphics.json reference → its file. `versionDir` first looks at the files
 * the version froze; `videoId` resolves assets/… of that video.
 */
export function resolveRef(ref, { videoId, versionDir } = {}) {
  const value = String(ref ?? "").trim().replace(/^\.\//, "");
  const parts = value.split("/");
  if (!value || parts.some((part) => !part || part === "." || part === "..")) return { error: `неверная ссылка на файл «${value}»` };
  let file;
  if (parts[0] === "library" && parts.length === 3 && LIBRARY_CATEGORIES[parts[1]]) file = path.join(categoryDir(parts[1]), parts[2]);
  else if (parts[0] === "assets" && parts.length === 2 && videoId != null) file = path.join(assetsDir(videoId), parts[1]);
  else return { error: `«${value}»: ссылка начинается с library/music/, library/sfx/, library/other/ или assets/` };
  const kind = mediaKind(value);
  if (!kind) return { error: `«${value}»: неподдерживаемый тип файла` };
  const frozen = versionDir ? path.join(versionDir, "media", ...parts) : null;
  if (frozen && existsSync(frozen)) return { ref: value, file: frozen, kind };
  if (!existsSync(file) || !statSync(file).isFile()) return { error: `файла «${value}» нет (см. media.md)` };
  return { ref: value, file, kind };
}

/** Video id of a version folder (request.json), for assets/… references. */
export async function versionVideoId(versionDir) {
  try { return JSON.parse(await readFile(path.join(versionDir, "request.json"), "utf8")).video?.id ?? null; } catch { return null; }
}

/** Hard-link (or copy) the referenced files into the version, so it renders the same later. */
export async function freezeMedia(versionDir, refs, videoId) {
  const frozen = [];
  for (const ref of [...new Set(refs)]) {
    const resolved = resolveRef(ref, { videoId });
    if (resolved.error) continue;
    const target = path.join(versionDir, "media", ...resolved.ref.split("/"));
    if (target === resolved.file) { frozen.push(resolved.ref); continue; }
    await mkdir(path.dirname(target), { recursive: true });
    await rm(target, { force: true });
    try { await link(resolved.file, target); } catch { await copyFile(resolved.file, target); }
    frozen.push(resolved.ref);
  }
  return frozen;
}

// ---------- what the agent reads ---------------------------------------------

const fmt = (file) => [
  file.duration != null ? `${file.duration.toFixed(1)} с` : null,
  file.width ? `${file.width}×${file.height}` : null,
  file.kind === "video" && !file.hasAudio ? "без звука" : null,
].filter(Boolean).join(", ");

export function mediaMarkdown({ library, assets, defaultMusic }) {
  const lines = ["# Материалы и библиотека", ""];
  lines.push("Ссылайся на файлы в `graphics.json` ровно так, как они записаны ниже (поле `file`). Прослушать файлы ты не можешь: выбирай по названию, длительности и брифу.", "");
  lines.push("## Материалы этого ролика", "");
  if (!assets.length) lines.push("Автор ничего не прикрепил.");
  for (const file of assets) lines.push(`- \`assets/${file.name}\` — ${file.kind}${fmt(file) ? `, ${fmt(file)}` : ""}`);
  lines.push("", "## Музыка", "");
  if (defaultMusic) lines.push(`Музыка по умолчанию: \`library/music/${defaultMusic}\`. Ставь её фоном на весь ролик, если автор не просил иначе.`, "");
  if (!library.music.length) lines.push("Музыки в библиотеке нет.");
  for (const file of library.music) lines.push(`- \`library/music/${file.name}\`${fmt(file) ? ` — ${fmt(file)}` : ""}`);
  lines.push("", "## Звуковые эффекты", "");
  if (!library.sfx.length) lines.push("Эффектов в библиотеке нет.");
  for (const file of library.sfx) lines.push(`- \`library/sfx/${file.name}\`${fmt(file) ? ` — ${fmt(file)}` : ""}`);
  if (library.other.length) {
    lines.push("", "## Прочее", "");
    for (const file of library.other) lines.push(`- \`library/other/${file.name}\` — ${file.kind}${fmt(file) ? `, ${fmt(file)}` : ""}`);
  }
  lines.push("");
  return lines.join("\n");
}
