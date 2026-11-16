// Telegram notifications: the author's own bot writes to the author's chat when
// a video waits for them (a new version to review, a failed edit, a final file).
//
// Setup in Settings: paste the bot token from @BotFather, open the bot by the
// link Cutroom shows and press Start. The link carries a one-time code, so a
// stranger who finds the bot cannot bind their chat. The token stays in the
// settings table and never goes back to the browser.
import { randomBytes } from "node:crypto";
import { getSetting, getVideo, setSetting } from "./db.js";

const API = (process.env.CUTROOM_TELEGRAM_API || "https://api.telegram.org").replace(/\/$/, "");
export const NOTIFY_EVENTS = {
  review: "Новая версия ждёт ревью",
  failed: "Монтаж не удался",
  final: "Финальный файл готов",
};
const DEFAULT_EVENTS = { review: true, failed: true, final: true };

const read = () => getSetting("telegram", {}) ?? {};
const write = (changes) => setSetting("telegram", { ...read(), ...changes });

async function call(token, method, body = {}) {
  let res;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
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

/** Looks for "/start <code>" sent to the bot; binds that chat. */
export async function bindChat() {
  const t = read();
  if (!t.token) throw new Error("Сначала добавьте токен бота.");
  if (t.chatId) return telegramState();
  let updates;
  try {
    updates = await call(t.token, "getUpdates", { allowed_updates: ["message"], timeout: 0 });
  } catch (error) {
    if (error.status === 409) throw new Error("У этого бота настроен webhook, поэтому Cutroom не видит сообщения. Отключите webhook или создайте для Cutroom отдельного бота.");
    throw error;
  }
  const match = [...updates].reverse().find((u) => u.message?.chat?.type === "private" && String(u.message.text ?? "").trim() === `/start ${t.code}`);
  if (!match) return telegramState();
  const chat = match.message.chat;
  const chatName = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || (chat.username ? `@${chat.username}` : String(chat.id));
  write({ chatId: chat.id, chatName, code: null, lastError: null });
  // Acknowledge the updates so the next binding does not see old /start messages.
  await call(t.token, "getUpdates", { offset: match.update_id + 1, timeout: 0 }).catch(() => {});
  await send("Cutroom подключён. Сюда будут приходить уведомления, когда ролик ждёт вас.").catch(() => {});
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

// Telegram refuses buttons that point to localhost or a bare IP, so a local
// install gets the address as text instead.
async function send(html, link = null, button = "Открыть ролик") {
  const t = read();
  if (!t.token || !t.chatId) return false;
  const base = { chat_id: t.chatId, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
  try {
    if (link) {
      try {
        await call(t.token, "sendMessage", { ...base, text: html, reply_markup: { inline_keyboard: [[{ text: button, url: link }]] } });
      } catch (error) {
        if (error.status !== 400) throw error;
        await call(t.token, "sendMessage", { ...base, text: `${html}\n\n${escape(link)}` });
      }
    } else {
      await call(t.token, "sendMessage", { ...base, text: html });
    }
    write({ lastError: null, lastSentAt: new Date().toISOString() });
    return true;
  } catch (error) {
    write({ lastError: { at: new Date().toISOString(), message: error.message } });
    throw error;
  }
}

export async function sendTest() {
  const state = telegramState();
  if (!state.connected) throw new Error("Сначала подключите чат.");
  await send("Проверка уведомлений Cutroom. Если вы это видите, всё работает.", state.publicUrl ? `${state.publicUrl}/#/` : null, "Открыть Cutroom");
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
    const link = state.publicUrl ? `${state.publicUrl}/#/video/${video.id}` : null;
    return await send(text, link);
  } catch (error) {
    console.log(`[notify] ${event} for video ${videoId} not sent: ${error.message}`);
    return false;
  }
}
