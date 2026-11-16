import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.resolve(process.env.CUTROOM_DATA ?? path.join(root, ".data"));

export const config = {
  root,
  data,
  port: Number(process.env.PORT ?? 8080),
  password: process.env.CUTROOM_PASSWORD ?? "",
  secret: process.env.CUTROOM_SECRET || process.env.CUTROOM_PASSWORD || "cutroom-dev",
  // Default for installs that have not picked a model in settings.
  whisperModel: process.env.CUTROOM_WHISPER_MODEL ?? "small",
  whisperThreads: Number(process.env.CUTROOM_WHISPER_THREADS) || null,
  paths: {
    db: path.join(data, "db", "cutroom.sqlite"),
    videos: path.join(data, "videos"),
    taste: path.join(data, "taste"),
    models: path.join(data, "models"),
    home: process.env.HOME ?? path.join(data, "home"),
    instructions: path.join(root, "instructions"),
    public: path.join(root, "web", "dist"),
  },
};

export const STAGES = ["draft", "editing", "review", "accepted"];
export const AGENTS = ["claude", "codex", "none"];

export function videoDir(id) {
  return path.join(config.paths.videos, String(id));
}

export function versionName(number) {
  return `v${String(number).padStart(3, "0")}`;
}
