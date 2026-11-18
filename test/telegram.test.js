import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

// A fake Bot API: records every call, hands out queued updates.
const calls = [];
const queue = [];
let nextMessageId = 100;
const fake = http.createServer(async (req, res) => {
  const method = req.url.split("/").pop();
  const request = new Request(`http://fake${req.url}`, { method: "POST", headers: req.headers, body: req, duplex: "half" });
  let body;
  if (String(req.headers["content-type"]).startsWith("multipart/")) {
    const form = await request.formData();
    body = Object.fromEntries([...form.entries()].map(([key, value]) => [key, typeof value === "string" ? value : { file: value.name, size: value.size }]));
  } else {
    body = await request.json().catch(() => ({}));
  }
  let result = true;
  if (method === "getUpdates") {
    if (!queue.length) await new Promise((resolve) => setTimeout(resolve, 30));
    result = queue.splice(0);
  } else {
    calls.push({ method, body });
    if (method === "sendMessage" || method === "sendVideo") {
      result = { message_id: nextMessageId++, chat: { id: Number(body.chat_id) }, ...(method === "sendVideo" ? { video: { file_id: "FILE-1" } } : {}) };
    }
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, result }));
});
await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
process.env.CUTROOM_TELEGRAM_API = `http://127.0.0.1:${fake.address().port}`;
process.env.CUTROOM_DATA = await mkdtemp(path.join(tmpdir(), "cutroom-telegram-"));
await mkdir(path.join(process.env.CUTROOM_DATA, "db"), { recursive: true });

const { db, now, setSetting } = await import("../src/db.js");
const { videoDir } = await import("../src/config.js");
const { notifyVideo } = await import("../src/notify.js");
const { parseNotes, startTelegramBot } = await import("../src/telegram-bot.js");

const CHAT = 42;
let updateId = 1;
const push = (update) => queue.push({ update_id: updateId++, ...update });
const until = async (check, what) => {
  for (let i = 0; i < 200; i++) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
};
const callsOf = (method) => calls.filter((c) => c.method === method);
const userComments = (videoId) => db.prepare("SELECT body, ref_version, at_seconds, end_seconds FROM messages WHERE video_id = ? AND role = 'user' ORDER BY id").all(videoId).map((row) => ({ ...row }));

// A video with one version: its preview and a 30-second timeline of one kept piece.
const videoId = Number(db.prepare("INSERT INTO videos (title, stage, latest_version, created_at, updated_at) VALUES (?, 'review', 1, ?, ?)").run("Тофу", now(), now()).lastInsertRowid);
const out = path.join(videoDir(videoId), "versions", "v001", "out");
await mkdir(out, { recursive: true });
await mkdir(path.join(videoDir(videoId), "sources"), { recursive: true });
await writeFile(path.join(videoDir(videoId), "sources", "take.mp4"), "source");
await writeFile(path.join(out, "preview.mp4"), "not really a video");
await writeFile(path.join(videoDir(videoId), "versions", "v001", "timeline.json"), JSON.stringify({
  duration: 30, segments: [{ programStart: 0, programEnd: 30, sourceStart: 2, sourceEnd: 32 }], words: [{ start: 5, end: 5.4, text: "кашель", source: 7 }],
}));
setSetting("telegram", { token: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ", bot: "cutroom_bot", chatId: CHAT, chatName: "Автор" });

const stop = startTelegramBot({ idleMs: 20, errorMs: 20 });
after(() => { stop(); fake.close(); });

test("timecodes at the start of a line pin the lines after them", () => {
  assert.deepEqual(parseNotes("Общее замечание\n0:05 убери кашель\nи паузу\n0:10–0:20 — покажи скриншот\n1:02.5-0:58: наоборот"), [
    { body: "Общее замечание", at: null, end: null },
    { body: "убери кашель\nи паузу", at: 5, end: null },
    { body: "покажи скриншот", at: 10, end: 20 },
    { body: "наоборот", at: 58, end: 62.5 },
  ]);
  assert.deepEqual(parseNotes("в 0:15 слишком тихо"), [{ body: "в 0:15 слишком тихо", at: null, end: null }]);
  assert.deepEqual(parseNotes("0:15"), []);
});

test("a new version's notification has a button that sends the preview", async () => {
  assert.equal(await notifyVideo(videoId, "review", { version: 1 }), true);
  const note = callsOf("sendMessage").at(-1).body;
  assert.equal(note.reply_markup.inline_keyboard[0][0].callback_data, `show:${videoId}:1`);

  push({ callback_query: { id: "q1", data: `show:${videoId}:1`, message: { message_id: 100, chat: { id: CHAT } } } });
  const sent = await until(() => callsOf("sendVideo")[0], "sendVideo");
  assert.equal(sent.body.video.file, "preview.mp4");
  assert.equal(sent.body.duration, "30");
  assert.match(sent.body.caption, /Тофу.*v001/);
  const buttons = JSON.parse(sent.body.reply_markup).inline_keyboard[0].map((b) => b.callback_data);
  assert.deepEqual(buttons, [`edit:${videoId}`, `accept:${videoId}:1`]);
  assert.ok(callsOf("answerCallbackQuery").some((c) => c.body.callback_query_id === "q1"));
});

test("a second press reuses the uploaded file", async () => {
  push({ callback_query: { id: "q2", data: `show:${videoId}:1`, message: { message_id: 100, chat: { id: CHAT } } } });
  const again = await until(() => callsOf("sendVideo")[1], "second sendVideo");
  assert.equal(again.body.video, "FILE-1");
});

test("a reply to the video becomes comments, pinned where a timecode says", async () => {
  const videoMessage = 101;
  push({ message: { message_id: 7, chat: { id: CHAT, type: "private" }, text: "Сделай динамичнее\n0:05 убери кашель\n0:10–0:20 покажи скриншот\n0:45 за концом", reply_to_message: { message_id: videoMessage } } });
  await until(() => userComments(videoId).length === 4, "four comments");
  assert.deepEqual(userComments(videoId), [
    { body: "Сделай динамичнее", ref_version: null, at_seconds: null, end_seconds: null },
    { body: "убери кашель", ref_version: 1, at_seconds: 5, end_seconds: null },
    { body: "покажи скриншот", ref_version: 1, at_seconds: 10, end_seconds: 20 },
    { body: "за концом", ref_version: 1, at_seconds: 30, end_seconds: null },
  ]);
  const confirm = await until(() => callsOf("sendMessage").find((c) => /Правок добавлено: 4/.test(c.body.text)), "confirmation");
  assert.match(confirm.body.text, /0:10–0:20 — покажи скриншот/);
  assert.equal(confirm.body.reply_parameters.message_id, 7);
  assert.equal(confirm.body.reply_markup.inline_keyboard[0][0].callback_data, `edit:${videoId}`);
});

test("strangers and replies to nothing are not taken as comments", async () => {
  const before = calls.length;
  push({ message: { message_id: 8, chat: { id: 999, type: "private" }, text: "0:01 взлом", reply_to_message: { message_id: 101 } } });
  push({ message: { message_id: 9, chat: { id: CHAT, type: "private" }, text: "просто текст" } });
  await until(() => callsOf("sendMessage").some((c) => /Не понял, к какому ролику/.test(c.body.text)), "hint");
  assert.equal(userComments(videoId).length, 4);
  assert.ok(calls.slice(before).every((c) => Number(c.body.chat_id) === CHAT));
});

test("«Перемонтировать» queues an edit; «Принять» then refuses while it runs", async () => {
  push({ callback_query: { id: "q3", data: `edit:${videoId}`, message: { message_id: 101, chat: { id: CHAT } } } });
  await until(() => db.prepare("SELECT id FROM jobs WHERE video_id = ? AND kind = 'edit'").get(videoId), "edit job");
  assert.equal(db.prepare("SELECT stage FROM videos WHERE id = ?").get(videoId).stage, "editing");

  db.prepare("UPDATE videos SET stage = 'review' WHERE id = ?").run(videoId);
  push({ callback_query: { id: "q4", data: `accept:${videoId}:1`, message: { message_id: 101, chat: { id: CHAT } } } });
  const alert = await until(() => callsOf("answerCallbackQuery").find((c) => c.body.callback_query_id === "q4"), "accept answer");
  assert.equal(alert.body.show_alert, true);
  assert.match(alert.body.text, /Дождитесь/);
});

test("«Принять» accepts the latest version and queues the final", async () => {
  db.prepare("DELETE FROM jobs WHERE video_id = ?").run(videoId);
  push({ callback_query: { id: "q5", data: `accept:${videoId}:1`, message: { message_id: 101, chat: { id: CHAT } } } });
  await until(() => db.prepare("SELECT id FROM jobs WHERE video_id = ? AND kind = 'final' AND version = 1").get(videoId), "final job");
  assert.equal(db.prepare("SELECT stage, accepted_version FROM videos WHERE id = ?").get(videoId).accepted_version, 1);
});
