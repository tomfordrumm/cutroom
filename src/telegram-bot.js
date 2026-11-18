// The Telegram bot's side that listens: buttons under notifications and the
// author's replies. Runs in the app process only, as one long-polling loop
// (getUpdates); the worker only sends.
//
//   «▶ Показать ролик»  → the version's preview.mp4 as a video message
//   reply to that video → a comment for the next edit; "0:15 …" or
//                         "0:10–0:20 …" at the start of a line pins it
//   «Перемонтировать»   → queues a new edit
//   «Принять vNNN»      → accepts the version and renders the final
//
// Only the bound chat is listened to; everyone else gets no answer.
import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { versionName, videoDir } from "./config.js";
import { activeJob, getVideo } from "./db.js";
import {
  bindIfStart, call, escapeHtml, messageTarget, readTelegram, rememberMessage, send, sendVideoFile, setBotPolling, uploadedPreview, videoLink,
} from "./notify.js";
import { versionTimeline } from "./timeline.js";
import { acceptVersion, addComment, pendingComments, startEdit } from "./video-actions.js";

// Telegram takes videos up to 50 MB from a bot.
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const TIME = String.raw`(\d{1,2}):([0-5]\d)(?:[.,](\d))?`;
const LINE = new RegExp(String.raw`^\s*${TIME}(?:\s*(?:-|–|—|\.\.)\s*${TIME})?\s*(?:[-–—:]\s*)?(.*)$`);
const seconds = (m, s, tenths) => Number(m) * 60 + Number(s) + (tenths ? Number(tenths) / 10 : 0);

/**
 * A reply split into comments. A line that starts with a timecode ("0:15",
 * "1:02.5", "0:10–0:20") opens a comment pinned there; the lines after it
 * belong to it. Text before the first timecode is one general comment.
 */
export function parseNotes(text) {
  const notes = [];
  let current = { at: null, end: null, lines: [] };
  const flush = () => {
    const body = current.lines.join("\n").trim();
    if (body) notes.push({ body, at: current.at, end: current.end });
  };
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (!m) { current.lines.push(line); continue; }
    flush();
    const a = seconds(m[1], m[2], m[3]);
    const b = m[4] != null ? seconds(m[4], m[5], m[6]) : null;
    current = { at: b != null ? Math.min(a, b) : a, end: b != null && b !== a ? Math.max(a, b) : null, lines: [m[7]] };
  }
  flush();
  return notes;
}

const fmt = (t) => {
  const tenths = Math.round(t * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${String(Math.floor(s)).padStart(2, "0")}${tenths % 10 ? `.${tenths % 10}` : ""}`;
};
const span = (at, end) => (end != null ? `${fmt(at)}–${fmt(end)}` : fmt(at));
const editButton = (videoId) => ({ text: "🔁 Перемонтировать", callback_data: `edit:${videoId}` });
const acceptButton = (videoId, version) => ({ text: `✅ Принять ${versionName(version)}`, callback_data: `accept:${videoId}:${version}` });

async function videoSize(file) {
  try {
    const { stdout } = await promisify(execFile)("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", file]);
    const stream = JSON.parse(stdout).streams?.[0];
    return stream?.width && stream?.height ? { width: stream.width, height: stream.height } : {};
  } catch {
    return {};
  }
}

/** Sends the preview of a version as a video the author can reply to. */
export async function sendPreview(videoId, version) {
  const video = getVideo(videoId);
  if (!video) return send("Этого ролика больше нет в Cutroom.");
  const name = versionName(version);
  const file = path.join(videoDir(videoId), "versions", name, "out", "preview.mp4");
  const info = await stat(file).catch(() => null);
  if (!info) return send(`У <b>«${escapeHtml(video.title)}»</b> нет превью ${name}.`);
  const link = videoLink(videoId);
  if (info.size > MAX_VIDEO_BYTES) {
    const mb = Math.round(info.size / 1024 / 1024);
    const sent = await send(`Превью ${name} <b>«${escapeHtml(video.title)}»</b> весит ${mb} МБ, а бот может прислать видео до 50 МБ. Посмотрите его в Cutroom; правку можно написать ответом на это сообщение.`, { link });
    if (sent) rememberMessage(sent, videoId, version);
    return sent;
  }
  const timeline = await versionTimeline(videoId, version).catch(() => null);
  const latest = video.latest_version === version;
  const caption = [
    `<b>«${escapeHtml(video.title)}»</b> · ${name}${timeline ? ` · ${fmt(timeline.duration)}` : ""}${latest ? "" : ` · есть новее: ${versionName(video.latest_version)}`}`,
    "Ответьте на это видео, чтобы оставить правку. Таймкод в начале строки (<code>0:15</code> или <code>0:10–0:20</code>) привяжет её к месту.",
  ].join("\n");
  const buttons = [[editButton(videoId), ...(latest && video.stage === "review" ? [acceptButton(videoId, version)] : [])]];
  const t = readTelegram();
  call(t.token, "sendChatAction", { chat_id: t.chatId, action: "upload_video" }).catch(() => {});
  const known = uploadedPreview(videoId, version);
  let message = null;
  if (known) message = await sendVideoFile({ fileId: known, caption, buttons }).catch(() => null);
  if (!message) message = await sendVideoFile({ file, caption, buttons, duration: timeline?.duration, ...(await videoSize(file)) });
  rememberMessage(message, videoId, version, message.video?.file_id ?? null);
  return message;
}

/** A reply to a message about a version: its text becomes comments. */
async function takeReply(message) {
  const target = message.reply_to_message ? messageTarget(message.chat.id, message.reply_to_message.message_id) : null;
  const text = message.text ?? message.caption ?? "";
  if (!target) {
    if (/^\/(start|help)\b/.test(text)) return send("Ответьте на видео или уведомление о ролике, и ответ станет правкой к перемонтажу. Таймкод в начале строки (<code>0:15</code> или <code>0:10–0:20</code>) привяжет её к месту.");
    return send("Не понял, к какому ролику это. Ответьте на видео или уведомление о ролике: свайп влево по сообщению → «Ответить».", { replyTo: message.message_id });
  }
  const video = getVideo(target.videoId);
  if (!video) return send("Этого ролика больше нет в Cutroom.", { replyTo: message.message_id });
  if (!text.trim()) return send("Пока принимаю правки только текстом.", { replyTo: message.message_id });
  const notes = parseNotes(text);
  const timeline = target.version ? await versionTimeline(video.id, target.version).catch(() => null) : null;
  const added = [];
  for (const note of notes) {
    const pinned = timeline && note.at != null;
    // Without the version's timeline the timecode stays in the text for the agent.
    const body = note.at != null && !pinned ? `${span(note.at, note.end)} ${note.body}` : note.body;
    const pin = await addComment(video.id, { body, refVersion: pinned ? target.version : null, atSeconds: pinned ? note.at : null, endSeconds: pinned ? note.end : null });
    added.push(pin.atSeconds != null ? `• ${span(pin.atSeconds, pin.endSeconds)} — ${escapeHtml(note.body)}` : `• ${escapeHtml(note.body)}`);
  }
  const pending = pendingComments(video.id);
  const job = activeJob(video.id);
  const lines = [
    `${added.length === 1 ? "Правка добавлена" : `Правок добавлено: ${added.length}`} к <b>«${escapeHtml(video.title)}»</b>${target.version ? ` (${versionName(target.version)})` : ""}:`,
    ...added,
    "",
    job ? `Идёт ${job.kind === "edit" ? "монтаж" : "рендер"}, правки уйдут в следующую версию. Ждут: ${pending}.` : `Ждут перемонтажа: ${pending}.`,
  ];
  const sent = await send(lines.join("\n"), { replyTo: message.message_id, buttons: job ? [] : [[editButton(video.id)]] });
  // A reply to this confirmation adds to the same version, like a reply to the video.
  if (sent) rememberMessage(sent, video.id, target.version);
  return sent;
}

/** A press on one of the bot's buttons. */
async function takeButton(query) {
  const t = readTelegram();
  const answer = (text, alert = false) => call(t.token, "answerCallbackQuery", { callback_query_id: query.id, text, show_alert: alert }).catch(() => {});
  const [action, id, version] = String(query.data ?? "").split(":");
  const videoId = Number(id);
  try {
    if (action === "show") {
      await answer("Отправляю превью…");
      await sendPreview(videoId, Number(version));
    } else if (action === "edit") {
      const video = await startEdit(videoId);
      await answer("Отправлено на перемонтаж");
      await send(`<b>«${escapeHtml(video.title)}»</b> отправлен на перемонтаж. Напишу, когда новая версия будет готова.`);
    } else if (action === "accept") {
      const video = getVideo(videoId);
      if (!video) throw new Error("Этого ролика больше нет в Cutroom.");
      if (video.latest_version !== Number(version)) throw new Error(`${versionName(Number(version))} уже не последняя версия: есть ${versionName(video.latest_version)}.`);
      if (video.stage === "accepted") throw new Error(`${versionName(Number(version))} уже принята.`);
      acceptVersion(videoId, Number(version));
      await answer("Принято");
      await send(`${versionName(Number(version))} <b>«${escapeHtml(video.title)}»</b> принята. Рендерю финал в полном разрешении, напишу, когда он будет готов.`);
    } else {
      await answer("Эта кнопка устарела.");
    }
  } catch (error) {
    await answer(error.message, true);
    if (action === "show") await send(`Не удалось отправить превью: ${escapeHtml(error.message)}`).catch(() => {});
  }
}

/** One update from getUpdates. Anything outside the bound chat is ignored. */
export async function handleUpdate(update) {
  const t = readTelegram();
  const message = update.message;
  if (message && (await bindIfStart(message.chat, message.text))) return;
  if (!t.chatId) return;
  if (update.callback_query) {
    if (update.callback_query.message?.chat?.id !== t.chatId) return;
    await takeButton(update.callback_query);
  } else if (message && message.chat?.id === t.chatId) {
    await takeReply(message);
  }
}

let stopController = null;

/** Starts the long-polling loop; returns a function that stops it. */
export function startTelegramBot({ idleMs = 3000, errorMs = 5000 } = {}) {
  if (stopController) return () => stopTelegramBot();
  const controller = new AbortController();
  stopController = controller;
  setBotPolling(true);
  const sleep = (ms) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
  (async () => {
    let token = null;
    let offset = 0;
    let warned = false;
    while (!controller.signal.aborted) {
      const t = readTelegram();
      if (!t.token) { token = null; await sleep(idleMs); continue; }
      if (t.token !== token) { token = t.token; offset = 0; }
      let updates;
      try {
        updates = await call(token, "getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, { timeout: 40_000, signal: controller.signal });
        warned = false;
      } catch (error) {
        if (controller.signal.aborted) break;
        if (!warned) console.log(`[telegram] getUpdates failed: ${error.message}`);
        warned = true;
        await sleep(errorMs);
        continue;
      }
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (error) {
          console.log(`[telegram] update ${update.update_id} failed: ${error.stack ?? error.message}`);
        }
      }
    }
  })();
  return () => stopTelegramBot();
}

export function stopTelegramBot() {
  stopController?.abort();
  stopController = null;
  setBotPolling(false);
}
