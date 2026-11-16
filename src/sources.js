import { readdir } from "node:fs/promises";
import path from "node:path";
import { videoDir } from "./config.js";

const VIDEO_EXTENSIONS = new Set([".mov", ".mp4", ".m4v", ".mkv", ".webm", ".avi"]);

/** Uploaded recordings of a video (this version uses the first one). */
export async function listSources(videoId) {
  const dir = path.join(videoDir(videoId), "sources");
  const names = await readdir(dir).catch(() => []);
  return names.filter((name) => VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase()) && !name.startsWith(".")).sort();
}
