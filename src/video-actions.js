// What the author can do with a video, wherever they do it from: the web page
// or the Telegram bot. Errors carry an HTTP-like `status` for the API.
import { stat } from "node:fs/promises";
import path from "node:path";
import { agentStatus, AGENT_LABELS } from "./agent.js";
import { versionName } from "./config.js";
import { activeJob, addMessage, db, enqueueJob, getSetting, getVideo, updateVideo } from "./db.js";
import { assetsDir } from "./library.js";
import { listSources } from "./sources.js";
import { programToSource, versionTimeline, wordsAround } from "./timeline.js";

export class ActionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Where a comment points on version `refVersion`: a moment, or a stretch when
 * `endSeconds` is at least a tenth of a second after `atSeconds`.
 */
export async function commentPin(videoId, refVersion, atSeconds, endSeconds = null) {
  const timeline = await versionTimeline(videoId, Number(refVersion)).catch(() => null);
  if (!timeline) throw new ActionError(400, "Нет такой версии");
  const clamp = (t) => Math.min(Math.max(Number(t), 0), timeline.duration);
  const at = clamp(atSeconds);
  const end = endSeconds != null && Number.isFinite(Number(endSeconds)) && clamp(endSeconds) - at >= 0.1 ? clamp(endSeconds) : null;
  return {
    refVersion: Number(refVersion),
    atSeconds: at,
    sourceSeconds: programToSource(timeline.segments, at),
    endSeconds: end,
    sourceEndSeconds: end == null ? null : programToSource(timeline.segments, end),
    context: wordsAround(timeline, at, 2.5, end) || null,
  };
}

/**
 * The author's comment for the next edit. `attachments` are file names already
 * in the video's materials; `safeName` cleans each one first.
 */
export async function addComment(videoId, { body, refVersion = null, atSeconds = null, endSeconds = null, attachments = [] }, safeName = (name) => name) {
  const text = String(body ?? "").trim();
  if (!text) throw new ActionError(400, "Пустое сообщение");
  const pinned = refVersion != null && atSeconds != null && Number.isFinite(Number(atSeconds));
  const pin = pinned ? await commentPin(videoId, refVersion, atSeconds, endSeconds) : {};
  if (!Array.isArray(attachments)) throw new ActionError(400, "attachments — список файлов");
  const files = [...new Set(attachments.map((name) => safeName(name)))];
  for (const name of files) {
    if (!(await stat(path.join(assetsDir(videoId), name)).then((info) => info.isFile(), () => false))) throw new ActionError(400, `Нет файла ${name} в материалах`);
  }
  addMessage(videoId, "user", text, null, pin, files);
  updateVideo(videoId, {});
  return pin;
}

/** Comments written since the last edit, waiting for the next one. */
export function pendingComments(videoId) {
  return db.prepare("SELECT COUNT(*) AS n FROM messages WHERE video_id = ? AND role = 'user' AND version IS NULL").get(videoId).n;
}

/** Queues a new edit of the video. */
export async function startEdit(videoId) {
  const video = getVideo(videoId);
  if (!video) throw new ActionError(404, "Ролик не найден");
  if (activeJob(video.id)) throw new ActionError(409, "Монтаж уже идёт");
  if (!(await listSources(video.id)).length) throw new ActionError(400, "Сначала загрузите исходник");
  const agent = getSetting("agent", "none");
  if (agent !== "none" && !agentStatus()[agent]) throw new ActionError(400, `${AGENT_LABELS[agent]} не подключён: войдите в терминале настроек`);
  enqueueJob(video.id, "edit");
  updateVideo(video.id, { stage: "editing", accepted_version: null });
  addMessage(video.id, "system", video.latest_version ? "Отправлено на перемонтаж." : "Отправлено в монтаж.");
  return getVideo(video.id);
}

/** Accepts `version` (the latest by default) and queues its final render. */
export function acceptVersion(videoId, version = null) {
  const video = getVideo(videoId);
  if (!video) throw new ActionError(404, "Ролик не найден");
  const number = Number(version ?? video.latest_version);
  if (!number) throw new ActionError(400, "Нет версии для приёмки");
  if (activeJob(video.id)) throw new ActionError(409, "Дождитесь окончания монтажа");
  updateVideo(video.id, { stage: "accepted", accepted_version: number });
  addMessage(video.id, "system", `Версия ${versionName(number)} принята. Рендерю финал в полном разрешении.`, number);
  enqueueJob(video.id, "final", number);
  return getVideo(video.id);
}
