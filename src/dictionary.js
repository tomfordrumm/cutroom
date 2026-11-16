// The author's vocabulary for speech recognition, kept across videos.
//
// An entry is a correct spelling (`to`) and, optionally, what Whisper hears
// instead (`from`). Every `to` goes into Whisper's prompt for new recordings;
// entries with `from` rewrite the transcript of every version, keeping each
// word's timing, so captions and the agent see the corrected text.
//
// Entries come from the author (settings) or from the editing agent
// (`dictionary.json` in a version folder). An agent entry is active at once
// only when an author comment of that version names the correct spelling;
// otherwise it waits for the author as a proposal.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db, now } from "./db.js";
import { clean, tokens, validateEntry } from "./dictionary-text.js";

export { applyDictionary, dictionaryMarkdown, packetWithDictionary, whisperPrompt } from "./dictionary-text.js";

export const DICTIONARY_FORMAT = "cutroom-dictionary-v1";
const STATUSES = ["active", "proposed", "rejected"];

db.exec(`
CREATE TABLE IF NOT EXISTS dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_text TEXT,
  to_text TEXT NOT NULL,
  video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'author',
  note TEXT,
  version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);
// The video whose agent proposed an entry: a shared word has no video_id, but its card lives in that video's chat.
if (!db.prepare("PRAGMA table_info(dictionary)").all().some((column) => column.name === "origin_video_id")) {
  db.exec("ALTER TABLE dictionary ADD COLUMN origin_video_id INTEGER");
}

function row(entry) {
  return {
    id: entry.id,
    from: entry.from_text,
    to: entry.to_text,
    videoId: entry.video_id,
    originVideoId: entry.origin_video_id ?? null,
    status: entry.status,
    source: entry.source,
    note: entry.note,
    version: entry.version,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

export function listDictionary({ videoId = null, includeRejected = false } = {}) {
  const rows = db.prepare("SELECT * FROM dictionary ORDER BY id DESC").all().map(row);
  return rows.filter((entry) => (includeRejected || entry.status !== "rejected") && (videoId == null || entry.videoId == null || entry.videoId === videoId));
}

export function getEntry(id) {
  const entry = db.prepare("SELECT * FROM dictionary WHERE id = ?").get(id);
  return entry ? row(entry) : null;
}

function sameEntry({ from, to, videoId }) {
  return db.prepare("SELECT * FROM dictionary WHERE IFNULL(from_text, '') = ? AND to_text = ? AND IFNULL(video_id, 0) = ?")
    .get(from ?? "", to, videoId ?? 0);
}

export function addEntry({ from, to, videoId = null, status = "active", source = "author", note = null, version = null, originVideoId = null }) {
  const fields = validateEntry({ from, to });
  if (!STATUSES.includes(status)) throw new Error("Неизвестное состояние записи.");
  const existing = sameEntry({ ...fields, videoId });
  if (existing) {
    if (source === "author" && existing.status !== "active") updateEntry(existing.id, { status: "active" });
    return getEntry(existing.id);
  }
  const stamp = now();
  const result = db.prepare("INSERT INTO dictionary (from_text, to_text, video_id, status, source, note, version, origin_video_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(fields.from, fields.to, videoId, status, source, note, version, originVideoId, stamp, stamp);
  return getEntry(Number(result.lastInsertRowid));
}

export function updateEntry(id, changes) {
  const entry = getEntry(id);
  if (!entry) throw new Error("Записи нет.");
  const next = { ...entry, ...Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) };
  const fields = validateEntry(next);
  if (!STATUSES.includes(next.status)) throw new Error("Неизвестное состояние записи.");
  db.prepare("UPDATE dictionary SET from_text = ?, to_text = ?, video_id = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(fields.from, fields.to, next.videoId ?? null, next.status, now(), id);
  return getEntry(id);
}

/** Marks which video proposed an agent entry, for entries stored before that was recorded. */
export function setOrigin({ from, to, version }, videoId) {
  let fields;
  try { fields = validateEntry({ from, to }); } catch { return; }
  db.prepare("UPDATE dictionary SET origin_video_id = ? WHERE source = 'agent' AND origin_video_id IS NULL AND IFNULL(from_text, '') = ? AND to_text = ? AND (version IS NULL OR version = ?) AND (video_id IS NULL OR video_id = ?)")
    .run(videoId, fields.from ?? "", fields.to, version ?? null, videoId);
}

export function removeEntry(id) {
  db.prepare("DELETE FROM dictionary WHERE id = ?").run(id);
}

/** Active entries that apply to a video, as frozen into a version. */
export function activeEntries(videoId) {
  return listDictionary({ videoId }).filter((entry) => entry.status === "active")
    .map(({ id, from, to, videoId: scope }) => ({ id, from, to, videoId: scope }));
}

function commentMentions(comments, to) {
  const target = tokens(to).join(" ");
  return comments.find((comment) => tokens(comment.body).join(" ").includes(target)) ?? null;
}

/**
 * The agent's `dictionary.json`: new entries go to the author as proposals, or
 * straight into use when an author comment of this version spells the word.
 */
export async function ingestProposals(dir, { videoId, version, comments }) {
  let raw;
  try { raw = JSON.parse(await readFile(path.join(dir, "dictionary.json"), "utf8")); } catch { return { active: [], proposed: [], errors: [] }; }
  const list = Array.isArray(raw) ? raw : raw?.entries;
  const result = { active: [], proposed: [], errors: [] };
  if (!Array.isArray(list)) { result.errors.push("dictionary.json: нужен массив entries."); return result; }
  for (const [index, item] of list.slice(0, 30).entries()) {
    try {
      const fields = validateEntry({ from: item?.from, to: item?.to });
      if (!fields.from) throw new Error("нужно поле from — что слышит Whisper");
      const scope = item?.scope === "video" ? videoId : null;
      if (sameEntry({ ...fields, videoId: scope })) continue;
      const comment = commentMentions(comments, fields.to);
      const reason = clean(item?.reason).slice(0, 300) || null;
      const note = comment ? `По правке автора: «${clean(comment.body).slice(0, 160)}»` : reason;
      const entry = addEntry({ ...fields, videoId: scope, status: comment ? "active" : "proposed", source: "agent", note, version, originVideoId: videoId });
      (comment ? result.active : result.proposed).push(entry);
    } catch (error) {
      result.errors.push(`dictionary.json #${index + 1}: ${error.message}`);
    }
  }
  return result;
}

