// Face track of a recording: where the presenter's face is, sampled a few
// times a second in source time. Core mechanic for every taste pack: graphics
// lay out around the face, `cutroom gfx review` checks they do not cover it.
//
// Detection: OpenCV YuNet (tools/vision.py) on frames decoded by FFmpeg.
import { spawn } from "node:child_process";
import path from "node:path";
import { config } from "./config.js";
import { sourceToProgram } from "./timeline.js";

export const FACES_FORMAT = "cutroom-faces-v1";
const SAMPLE_FPS = 4;
const LONG_SIDE = 640;
const PYTHON = process.env.CUTROOM_PYTHON ?? "/opt/cutroom/py/bin/python3";
const VISION = path.join(config.root, "tools", "vision.py");
const MODEL = process.env.CUTROOM_FACE_MODEL ?? path.join(config.root, "models", "face_detection_yunet_2023mar.onnx");

const even = (value) => Math.max(2, Math.round(value / 2) * 2);

/** Run the detector over the whole recording. Boxes are [x, y, w, h, score], 0–1 of the frame. */
export function detectFaces(sourcePath, media, { signal, onProgress = () => {} } = {}) {
  const scale = LONG_SIDE / Math.max(media.width, media.height);
  const width = even(media.width * scale);
  const height = even(media.height * scale);
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-v", "error", "-i", sourcePath, "-an", "-vf", `fps=${SAMPLE_FPS},scale=${width}:${height}`, "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
    const python = spawn(PYTHON, [VISION, "faces", MODEL, String(width), String(height), String(SAMPLE_FPS)], { stdio: ["pipe", "pipe", "pipe"] });
    ffmpeg.stdout.pipe(python.stdin);
    python.stdin.on("error", () => {});
    const samples = [];
    let buffer = "";
    let errors = "";
    const total = Math.max(1, Math.floor(media.duration * SAMPLE_FPS));
    python.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        samples.push(JSON.parse(line));
        if (samples.length % 20 === 0) onProgress(Math.min(99, Math.round((samples.length / total) * 100)));
      }
    });
    ffmpeg.stderr.on("data", (chunk) => { errors += chunk; });
    python.stderr.on("data", (chunk) => { errors += chunk; });
    const abort = () => { ffmpeg.kill("SIGTERM"); python.kill("SIGTERM"); };
    signal?.addEventListener("abort", abort, { once: true });
    let ffmpegCode = null;
    ffmpeg.on("close", (code) => { ffmpegCode = code; });
    ffmpeg.on("error", reject);
    python.on("error", reject);
    python.on("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return reject(new Error("Отменено"));
      if (code !== 0 || (ffmpegCode !== null && ffmpegCode !== 0)) return reject(new Error(`Поиск лица не удался: ${errors.trim().slice(-300) || `код ${code}`}`));
      resolve({ format: FACES_FORMAT, detector: "yunet-2023mar", fps: SAMPLE_FPS, frame: { width: media.width, height: media.height }, samples });
    });
  });
}

/** The presenter: the largest confident face of each sample, or null. */
export function primaryFace(sample) {
  const face = sample.faces.find((f) => f[4] >= 0.6);
  return face ? face.slice(0, 4) : null;
}

/** Face samples on program time, for the composition: [{ t, box: [x, y, w, h] | null }]. */
export function facesOnProgram(faces, segments) {
  if (!faces) return [];
  const result = [];
  for (const sample of faces.samples) {
    const t = sourceToProgram(segments, sample.t);
    if (t === null) continue;
    result.push({ t, box: primaryFace(sample), count: sample.faces.filter((f) => f[4] >= 0.6).length });
  }
  return result.sort((a, b) => a.t - b.t);
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
};
const pct = (value) => `${Math.round(value * 100)}%`;

/** A few lines for the agent: where the face usually is, and where it is missing. */
export function facesSummary(faces) {
  if (!faces?.samples?.length) return "Поиск лица не запускался.";
  const step = 1 / faces.fps;
  const boxes = faces.samples.map(primaryFace);
  const found = boxes.filter(Boolean);
  const lines = [];
  if (!found.length) return "Лицо в кадре не найдено: раскладка графики не ограничена лицом, проверь кадры глазами.";
  const left = percentile(found.map((b) => b[0]), 0.05), right = percentile(found.map((b) => b[0] + b[2]), 0.95);
  const top = percentile(found.map((b) => b[1]), 0.05), bottom = percentile(found.map((b) => b[1] + b[3]), 0.95);
  lines.push(`Лицо найдено в ${Math.round((found.length / boxes.length) * 100)}% кадров. Обычно (90% времени) оно в зоне x ${pct(left)}–${pct(right)}, y ${pct(top)}–${pct(bottom)} кадра.`);
  const multi = faces.samples.filter((s) => s.faces.filter((f) => f[4] >= 0.6).length > 1).length;
  if (multi / boxes.length > 0.1) lines.push(`В ${Math.round((multi / boxes.length) * 100)}% кадров больше одного лица: проверяй раскладку глазами.`);
  const gaps = [];
  let gapStart = null;
  faces.samples.forEach((sample, i) => {
    if (!boxes[i] && gapStart === null) gapStart = sample.t;
    if ((boxes[i] || i === boxes.length - 1) && gapStart !== null) {
      const end = boxes[i] ? sample.t : sample.t + step;
      if (end - gapStart >= 1) gaps.push(`${gapStart.toFixed(1)}–${end.toFixed(1)}`);
      gapStart = null;
    }
  });
  if (gaps.length) lines.push(`Без лица (секунды исходника): ${gaps.slice(0, 12).join(", ")}${gaps.length > 12 ? "…" : ""}.`);
  return lines.join("\n");
}
