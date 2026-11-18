// SQLite through Node's built-in driver. Holds the queue, chat and settings;
// the editing projects themselves are files under /data/videos.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

mkdirSync(path.dirname(config.paths.db), { recursive: true });
export const db = new DatabaseSync(config.paths.db);
db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'draft',
  latest_version INTEGER,
  accepted_version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  version INTEGER,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  version INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  step TEXT,
  progress REAL,
  error TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Comments pinned to a moment or a stretch of a version: program time (what the
// author watched), source time (what the agent edits) and the words spoken there.
// A stretch also has an end; a point comment leaves the end columns empty.
// `attachments` is a JSON list of file names in the video's assets/ folder.
const messageColumns = db.prepare("PRAGMA table_info(messages)").all().map((column) => column.name);
for (const [name, type] of [
  ["ref_version", "INTEGER"], ["at_seconds", "REAL"], ["source_seconds", "REAL"], ["context", "TEXT"],
  ["end_seconds", "REAL"], ["source_end_seconds", "REAL"], ["attachments", "TEXT"],
]) {
  if (!messageColumns.includes(name)) db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`);
}

export const now = () => new Date().toISOString();

export function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

export function getVideo(id) {
  return db.prepare("SELECT * FROM videos WHERE id = ?").get(id) ?? null;
}

export function updateVideo(id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.prepare(`UPDATE videos SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), now(), id);
}

export function addMessage(videoId, role, body, version = null, pin = {}, attachments = []) {
  db.prepare(`INSERT INTO messages (video_id, version, role, body, created_at, ref_version, at_seconds, source_seconds, context, end_seconds, source_end_seconds, attachments)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(videoId, version, role, body, now(), pin.refVersion ?? null, pin.atSeconds ?? null, pin.sourceSeconds ?? null, pin.context ?? null,
      pin.endSeconds ?? null, pin.sourceEndSeconds ?? null, attachments.length ? JSON.stringify(attachments) : null);
}

/** File names a message has attached, from its JSON column. */
export function messageAttachments(row) {
  try {
    const list = JSON.parse(row.attachments ?? "[]");
    return Array.isArray(list) ? list.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

export function activeJob(videoId) {
  return db.prepare("SELECT * FROM jobs WHERE video_id = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1").get(videoId) ?? null;
}

export function enqueueJob(videoId, kind, version = null) {
  const result = db.prepare("INSERT INTO jobs (video_id, kind, version, status, created_at) VALUES (?, ?, ?, 'queued', ?)")
    .run(videoId, kind, version, now());
  return Number(result.lastInsertRowid);
}

export function updateJob(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
}

export function getJob(id) {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) ?? null;
}
