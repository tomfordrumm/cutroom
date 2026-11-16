// Whisper models live in the data volume and are downloaded on first use.
// The author picks one in settings; each recording is analysed once per model.
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";

const WHISPER_URL = (id) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`;
const VAD_FILE = "ggml-silero-v6.2.0.bin";
const VAD_URL = `https://huggingface.co/ggml-org/whisper-vad/resolve/main/${VAD_FILE}`;

/** Models offered in settings. Speed measured on a 10-core CPU (Docker on Apple M-series), no GPU. */
export const WHISPER_MODELS = [
  { id: "base", label: "Base", size: "142 МБ", note: "Быстро, но часто путает термины и окончания." },
  { id: "small", label: "Small", size: "466 МБ", note: "Хорошо для русского: заметно реже путает термины и окончания. Примерно в 3–4 раза медленнее base." },
  { id: "large-v3-turbo-q5_0", label: "Large v3 Turbo (сжатая)", size: "547 МБ", note: "Точнее всего, но без видеокарты медленнее самой записи в 4 раза." },
  { id: "large-v3-turbo", label: "Large v3 Turbo", size: "1,5 ГБ", note: "Та же точность, что у сжатой, но в три раза тяжелее." },
];
export const DEFAULT_WHISPER_MODEL = "small";

export function isWhisperModel(id) {
  return WHISPER_MODELS.some((model) => model.id === id);
}

/** The model in use: the author's choice, then CUTROOM_WHISPER_MODEL, then the default. */
export function whisperModelId(setting) {
  if (isWhisperModel(setting)) return setting;
  return isWhisperModel(config.whisperModel) ? config.whisperModel : DEFAULT_WHISPER_MODEL;
}

export async function modelDownloaded(id) {
  return exists(path.join(config.paths.models, `ggml-${id}.bin`));
}

async function exists(file) {
  try { return (await stat(file)).size > 0; } catch { return false; }
}

async function download(url, target, onProgress) {
  const partial = `${target}.partial`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status}): ${url}`);
  const total = Number(response.headers.get("content-length")) || 0;
  let received = 0;
  let reported = -1;
  const body = Readable.fromWeb(response.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    const percent = total ? Math.floor(received / total * 100) : null;
    if (percent !== null && percent >= reported + 5) { reported = percent; onProgress?.(percent); }
  });
  try {
    await pipeline(body, createWriteStream(partial));
    await rename(partial, target);
  } catch (error) {
    await unlink(partial).catch(() => {});
    throw error;
  }
}

const inFlight = new Map();
const listeners = new Map();

/** Paths of the Whisper and VAD models, downloading what is missing (once per model). */
export async function ensureModels(modelId, onProgress = () => {}) {
  if (!isWhisperModel(modelId)) throw new Error(`Неизвестная модель Whisper: ${modelId}`);
  if (!listeners.has(modelId)) listeners.set(modelId, new Set());
  const group = listeners.get(modelId);
  group.add(onProgress);
  if (!inFlight.has(modelId)) {
    inFlight.set(modelId, fetchModels(modelId, (message) => { for (const listener of group) listener(message); })
      .finally(() => inFlight.delete(modelId)));
  }
  try { return await inFlight.get(modelId); } finally { group.delete(onProgress); }
}

async function fetchModels(modelId, onProgress) {
  await mkdir(config.paths.models, { recursive: true });
  const whisper = path.join(config.paths.models, `ggml-${modelId}.bin`);
  const vad = path.join(config.paths.models, VAD_FILE);
  if (!(await exists(whisper))) {
    await download(WHISPER_URL(modelId), whisper, (p) => onProgress(`Скачиваю модель Whisper ${modelId}: ${p}%`));
  }
  if (!(await exists(vad))) {
    await download(VAD_URL, vad, (p) => onProgress(`Скачиваю модель VAD: ${p}%`));
  }
  return { whisper, vad };
}
