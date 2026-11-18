// Telegram notifications: the author's own bot writes to the author's chat when
// a video waits for them (a new version to review, a failed edit, a final file).
//
// Setup in Settings: paste the bot token from @BotFather, open the bot by the
// link Cutroom shows and press Start. The link carries a one-time code, so a
// stranger who finds the bot cannot bind their chat. The token stays in the
// settings table and never goes back to the browser.
//
// A "new version" notification has a «Показать ролик» button: the bot (see
// telegram-bot.js) answers it with the preview, and a reply to that video
// becomes a comment for the next edit. Every message the bot sends about a
// version is remembered, so a reply finds its video and version.
import { randomBytes } from "node:crypto";
import { openAsBlob } from "node:fs";
import { db, getSetting, getVideo, setSetting } from "./db.js";

db.exec(`
CREATE TABLE IF NOT EXISTS telegram_messages (
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  version INTEGER,
  file_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
`);

const API = (process.env.CUTROOM_TELEGRAM_API || "https://api.telegram.org").replace(/\/$/, "");
export const NOTIFY_EVENTS = {
  review: "Новая версия ждёт ревью",
  failed: "Монтаж не удался",
  final: "Финальный файл готов",
};
const DEFAULT_EVENTS = { review: true, failed: true, final: true };

export const readTelegram = () => getSetting("telegram", {}) ?? {};
const read = readTelegram;
const write = (changes) => setSetting("telegram", { ...read(), ...changes });

/**
 * One Bot API call. `body` goes as JSON; a FormData body (a file upload) goes
 * as multipart. Long polling and uploads pass a longer `timeout`.
 */
export async function call(token, method, body = {}, { timeout = 15_000, signal = null } = {}) {
  let res;
  const form = body instanceof FormData;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: form ? {} : { "content-type": "application/json" },
      body: form ? body : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    throw new Error(`Telegram недоступен: ${error.cause?.code ?? error.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    const error = new Error(res.status === 401 || res.status === 404 ? "Telegram не принял токен. Скопируйте его из @BotFather заново." : `Telegram: ${data.description ?? `ошибка ${res.status}`}`);
    error.status = res.status;
    error.description = data.description ?? "";
    throw error;
  }
  return data.result;
}

/** What the settings page shows. Never includes the token. */
export function telegramState() {
  const t = read();
  return {
    configured: Boolean(t.token),
    bot: t.bot ?? null,
    connected: Boolean(t.token && t.chatId),
    chatName: t.chatName ?? null,
    link: t.token && !t.chatId && t.bot && t.code ? `https://t.me/${t.bot}?start=${t.code}` : null,
    events: { ...DEFAULT_EVENTS, ...t.events },
    publicUrl: t.publicUrl ?? defaultPublicUrl(),
    lastError: t.lastError ?? null,
    lastSentAt: t.lastSentAt ?? null,
  };
}

function defaultPublicUrl() {
  const domain = process.env.CUTROOM_DOMAIN?.trim();
  return domain && domain !== "localhost" ? `https://${domain}` : null;
}

function cleanUrl(value) {
  const text = String(value ?? "").trim().replace(/\/+$/, "");
  if (!text) return null;
  let url;
  try { url = new URL(text); } catch { throw new Error("Адрес должен начинаться с http:// или https://"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Адрес должен начинаться с http:// или https://");
  return text;
}

/** Checks the token with getMe and starts binding a chat. */
export async function setToken(token) {
  const value = String(token ?? "").trim();
  if (!/^\d+:[\w-]{20,}$/.test(value)) throw new Error("Это не похоже на токен бота. Он выглядит как 123456789:AA… и приходит от @BotFather.");
  const me = await call(value, "getMe");
  write({ token: value, bot: me.username, chatId: null, chatName: null, code: randomBytes(6).toString("hex"), lastError: null });
  return telegramState();
}

/** Binds `chat` if `text` is "/start <code>" with the current one-time code. */
export async function bindIfStart(chat, text) {
  const t = read();
  if (!t.token || t.chatId || !t.code || chat?.type !== "private" || String(text ?? "").trim() !== `/start ${t.code}`) return false;
  const chatName = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || (chat.username ? `@${chat.username}` : String(chat.id));
  write({ chatId: chat.id, chatName, code: null, lastError: null });
  await send(WELCOME).catch(() => {});
  return true;
}

const WELCOME = [
  "Cutroom подключён. Сюда будут приходить уведомления, когда ролик ждёт вас.",
  "",
  "Когда готова новая версия, нажмите «Показать ролик»: пришлю превью. Ответьте на видео, и ответ станет правкой к перемонтажу. Таймкод в начале строки, например <code>0:15 убери кашель</code> или <code>0:10–0:20 покажи скриншот</code>, привяжет правку к месту.",
].join("\n");

// While the bot's polling loop runs in this process, it reads /start itself:
// a second getUpdates call would break its long poll.
let botPolling = false;
export const setBotPolling = (value) => { botPolling = value; };

/** Looks for "/start <code>" sent to the bot; binds that chat. */
export async function bindChat() {
  const t = read();
  if (!t.token) throw new Error("Сначала добавьте токен бота.");
  if (t.chatId || botPolling) return telegramState();
  let updates;
  try {
    updates = await call(t.token, "getUpdates", { allowed_updates: ["message"], timeout: 0 });
  } catch (error) {
    if (error.status === 409) throw new Error("У этого бота настроен webhook, поэтому Cutroom не видит сообщения. Отключите webhook или создайте для Cutroom отдельного бота.");
    throw error;
  }
  const match = [...updates].reverse().find((u) => u.message?.chat?.type === "private" && String(u.message.text ?? "").trim() === `/start ${t.code}`);
  if (!match) return telegramState();
  // Acknowledge the updates so the next binding does not see old /start messages.
  await call(t.token, "getUpdates", { offset: match.update_id + 1, timeout: 0 }).catch(() => {});
  await bindIfStart(match.message.chat, match.message.text);
  return telegramState();
}

export function updateTelegram({ events, publicUrl }) {
  const changes = {};
  if (events) {
    const current = telegramState().events;
    changes.events = Object.fromEntries(Object.keys(NOTIFY_EVENTS).map((key) => [key, Boolean(events[key] ?? current[key])]));
  }
  if (publicUrl !== undefined) changes.publicUrl = cleanUrl(publicUrl);
  write(changes);
  return telegramState();
}

export function disconnectTelegram() {
  const { events, publicUrl } = read();
  setSetting("telegram", { events, publicUrl });
  return telegramState();
}

const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const keyboard = (rows) => (rows.length ? { reply_markup: { inline_keyboard: rows } } : {});

/**
 * Sends `html` to the author's chat; returns the sent message or null when no
 * chat is bound. `buttons` are rows of callback buttons; `link` adds a row with
 * a link button. Telegram refuses buttons that point to localhost or a bare IP,
 * so a local install gets the address as text instead.
 */
export async function send(html, { link = null, button = "Открыть ролик", buttons = [], replyTo = null } = {}) {
  const t = read();
  if (!t.token || !t.chatId) return null;
  const base = { chat_id: t.chatId, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) };
  try {
    let message;
    if (link) {
      try {
        message = await call(t.token, "sendMessage", { ...base, text: html, ...keyboard([...buttons, [{ text: button, url: link }]]) });
      } catch (error) {
        if (error.status !== 400) throw error;
        message = await call(t.token, "sendMessage", { ...base, text: `${html}\n\n${escape(link)}`, ...keyboard(buttons) });
      }
    } else {
      message = await call(t.token, "sendMessage", { ...base, text: html, ...keyboard(buttons) });
    }
    write({ lastError: null, lastSentAt: new Date().toISOString() });
    return message;
  } catch (error) {
    write({ lastError: { at: new Date().toISOString(), message: error.message } });
    throw error;
  }
}

export async function sendTest() {
  const state = telegramState();
  if (!state.connected) throw new Error("Сначала подключите чат.");
  await send("Проверка уведомлений Cutroom. Если вы это видите, всё работает.", { link: state.publicUrl ? `${state.publicUrl}/#/` : null, button: "Открыть Cutroom" });
  return telegramState();
}

/**
 * Tells the author a video waits for them. Never throws: a notification must
 * not fail the job it reports on.
 */
export async function notifyVideo(videoId, event, { version = null, error = null, kind = "edit" } = {}) {
  try {
    const state = telegramState();
    if (!state.connected || !state.events[event]) return false;
    const video = getVideo(videoId);
    if (!video) return false;
    const title = `«${escape(video.title)}»`;
    const name = version ? `v${String(version).padStart(3, "0")}` : null;
    const text = {
      review: `<b>${title}</b> смонтирован. ${name ? `Версия ${name} ждёт` : "Ждёт"} вашего ревью.`,
      failed: `${kind === "final" ? "Рендер финала" : "Монтаж"} <b>${title}</b> не удался.${error ? `\n${escape(String(error).slice(0, 300))}` : ""}`,
      final: `Финальный файл <b>${title}</b>${name ? ` (${name})` : ""} готов, можно скачать.`,
    }[event];
    const link = videoLink(video.id);
    // A new version can be watched right in Telegram; replies to it become comments.
    const buttons = event === "review" && version ? [[{ text: "▶ Показать ролик", callback_data: `show:${video.id}:${version}` }]] : [];
    const message = await send(text, { link, buttons });
    if (message && event === "review" && version) rememberMessage(message, video.id, version);
    return Boolean(message);
  } catch (error) {
    console.log(`[notify] ${event} for video ${videoId} not sent: ${error.message}`);
    return false;
  }
}

/** Address of a video's page in Cutroom, or null when no public address is set. */
export function videoLink(videoId) {
  const base = telegramState().publicUrl;
  return base ? `${base}/#/video/${videoId}` : null;
}

/** Remembers that `message` is about this version, so a reply to it finds them. */
export function rememberMessage(message, videoId, version, fileId = null) {
  db.prepare("INSERT OR REPLACE INTO telegram_messages (chat_id, message_id, video_id, version, file_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(message.chat.id, message.message_id, videoId, version, fileId, new Date().toISOString());
}

/** The video and version a bot message was about, or null. */
export function messageTarget(chatId, messageId) {
  return db.prepare("SELECT video_id AS videoId, version FROM telegram_messages WHERE chat_id = ? AND message_id = ?").get(chatId, messageId) ?? null;
}

/** Telegram's id of a preview already uploaded: sending it again needs no upload. */
export function uploadedPreview(videoId, version) {
  return db.prepare("SELECT file_id FROM telegram_messages WHERE video_id = ? AND version = ? AND file_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").get(videoId, version)?.file_id ?? null;
}

/**
 * Sends a video file (or a Telegram file id) to the author's chat with a
 * caption and buttons. Returns the sent message.
 */
export async function sendVideoFile({ file = null, fileId = null, caption, buttons = [], width = null, height = null, duration = null }) {
  const t = read();
  if (!t.token || !t.chatId) throw new Error("Telegram не подключён.");
  const fields = {
    chat_id: t.chatId, caption, parse_mode: "HTML", supports_streaming: true,
    ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
    ...(width && height ? { width, height } : {}),
    ...(duration ? { duration: Math.round(duration) } : {}),
  };
  if (fileId) return call(t.token, "sendVideo", { ...fields, video: fileId }, { timeout: 60_000 });
  // A new upload goes as multipart: every field a string, objects as JSON.
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  form.append("video", await openAsBlob(file, { type: "video/mp4" }), "preview.mp4");
  return call(t.token, "sendVideo", form, { timeout: 300_000 });
}

export { escape as escapeHtml };
