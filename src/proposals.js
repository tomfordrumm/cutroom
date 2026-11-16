// What the agent proposes to keep beyond one version, answered by the author
// with yes or no in the video's chat:
//   - dictionary words (dictionary.json), stored in the dictionary as "proposed";
//   - lasting preferences for the taste profile (remember.json). A yes appends
//     the line to the profile, so every next edit reads it in taste.md.
// Older versions wrote preferences only in reply.md under «Предлагаю запомнить»;
// that section is read as a fallback.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config, videoDir } from "./config.js";
import { db, getSetting, now, setSetting } from "./db.js";
import { getEntry, setOrigin, updateEntry } from "./dictionary.js";

export const REMEMBER_FORMAT = "cutroom-remember-v1";
export const PROFILE_SECTION = "## Запомнено из правок";
const MAX_ITEMS = 5;
const MAX_TEXT = 300;

db.exec(`
CREATE TABLE IF NOT EXISTS taste_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  version INTEGER,
  text TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
`);

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
// «…», "…" and „…" around a whole line are quoting, not content.
const unquote = (text) => text.replace(/^[«"„“](.*)[»"“”]\.?$/u, "$1").trim();
const key = (text) => clean(text).toLowerCase().replaceAll("ё", "е").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Items of a remember.json: [{ text, reason }]. */
export function parseRemember(raw) {
  const list = Array.isArray(raw) ? raw : raw?.items;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => (typeof item === "string" ? { text: item } : item))
    .map((item) => ({ text: unquote(clean(item?.text)).slice(0, MAX_TEXT), reason: clean(item?.reason).slice(0, MAX_TEXT) || null }))
    .filter((item) => item.text);
}

/** Bullets under a «Предлагаю запомнить» heading of reply.md. */
export function rememberFromReply(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s*Предлагаю запомнить/i.test(line.trim()));
  if (start < 0) return [];
  const items = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) items.push({ text: unquote(clean(bullet[1])).slice(0, MAX_TEXT), reason: null });
  }
  return items.filter((item) => item.text);
}

const profilePath = () => path.join(config.paths.taste, "profile.md");
const readProfile = () => readFile(profilePath(), "utf8").catch(() => "");

/** Reads the agent's preferences of a version and stores the new ones as proposals. */
export async function ingestRemember(dir, { videoId, version }) {
  let items;
  try {
    items = parseRemember(JSON.parse(await readFile(path.join(dir, "remember.json"), "utf8")));
  } catch {
    items = rememberFromReply(await readFile(path.join(dir, "reply.md"), "utf8").catch(() => ""));
  }
  const profile = key(await readProfile());
  const known = new Set(db.prepare("SELECT text FROM taste_proposals").all().map((row) => key(row.text)));
  const added = [];
  for (const item of items.slice(0, MAX_ITEMS)) {
    const k = key(item.text);
    if (!k || known.has(k) || profile.includes(k)) continue;
    known.add(k);
    const result = db.prepare("INSERT INTO taste_proposals (video_id, version, text, reason, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(videoId, version, item.text, item.reason, now());
    added.push({ id: Number(result.lastInsertRowid), ...item });
  }
  return added;
}

/** Everything the agent proposed in this video, for the chat. */
export function videoProposals(videoId) {
  const words = db.prepare("SELECT * FROM dictionary WHERE source = 'agent' AND (video_id = ? OR origin_video_id = ?) ORDER BY id").all(videoId, videoId)
    .map((row) => ({
      kind: "dictionary",
      id: row.id,
      version: row.version,
      status: row.status === "active" ? "accepted" : row.status,
      from: row.from_text,
      to: row.to_text,
      scope: row.video_id == null ? "all" : "video",
      reason: row.note,
    }));
  const taste = db.prepare("SELECT * FROM taste_proposals WHERE video_id = ? ORDER BY id").all(videoId)
    .map((row) => ({ kind: "taste", id: row.id, version: row.version, status: row.status, text: row.text, reason: row.reason }));
  return [...words, ...taste];
}

/** Adds a line to the taste profile under its own section. */
export async function appendToProfile(text) {
  const line = `- ${clean(text)}`;
  const profile = (await readProfile()).replace(/\s+$/, "");
  let next;
  if (profile.includes(PROFILE_SECTION)) {
    // Append at the end of the section: before the next heading or at the end.
    const at = profile.indexOf(PROFILE_SECTION) + PROFILE_SECTION.length;
    const rest = profile.slice(at);
    const nextHeading = rest.search(/\n#{1,2} /);
    const end = nextHeading < 0 ? profile.length : at + nextHeading;
    next = `${profile.slice(0, end).replace(/\s+$/, "")}\n${line}${profile.slice(end) ? `\n${profile.slice(end)}` : ""}`;
  } else {
    next = `${profile ? `${profile}\n\n` : ""}${PROFILE_SECTION}\n\n${line}`;
  }
  await mkdir(config.paths.taste, { recursive: true });
  await writeFile(profilePath(), `${next}\n`);
}

/** The author's yes or no. Returns the proposal as stored, or null if it is not this video's. */
export async function decideProposal(videoId, kind, id, accept) {
  if (kind === "dictionary") {
    const entry = getEntry(id);
    if (!entry || entry.source !== "agent" || (entry.videoId !== videoId && entry.originVideoId !== videoId)) return null;
    updateEntry(id, { status: accept ? "active" : "rejected" });
    return videoProposals(videoId).find((p) => p.kind === kind && p.id === id) ?? null;
  }
  if (kind === "taste") {
    const row = db.prepare("SELECT * FROM taste_proposals WHERE id = ? AND video_id = ?").get(id, videoId);
    if (!row) return null;
    const status = accept ? "accepted" : "rejected";
    if (row.status !== status) {
      if (accept) await appendToProfile(row.text);
      db.prepare("UPDATE taste_proposals SET status = ?, decided_at = ? WHERE id = ?").run(status, now(), id);
    }
    return videoProposals(videoId).find((p) => p.kind === kind && p.id === id) ?? null;
  }
  return null;
}

/**
 * Versions made before proposals reached the chat: preferences from reply.md,
 * and which video proposed each shared dictionary word.
 */
export async function backfillProposals() {
  const BACKFILL = 1;
  if (getSetting("proposalsBackfill", 0) >= BACKFILL) return 0;
  let added = 0;
  for (const { id } of db.prepare("SELECT id FROM videos").all()) {
    const dir = path.join(videoDir(id), "versions");
    for (const name of (await readdir(dir).catch(() => [])).filter((n) => /^v\d{3}$/.test(n)).sort()) {
      const number = Number(name.slice(1));
      if (!db.prepare("SELECT 1 FROM taste_proposals WHERE video_id = ? AND version = ?").get(id, number)) {
        added += (await ingestRemember(path.join(dir, name), { videoId: id, version: number })).length;
      }
      try {
        const raw = JSON.parse(await readFile(path.join(dir, name, "dictionary.json"), "utf8"));
        for (const item of (Array.isArray(raw) ? raw : raw?.entries) ?? []) setOrigin({ from: item?.from, to: item?.to, version: number }, id);
      } catch { /* no proposals in this version */ }
    }
  }
  setSetting("proposalsBackfill", BACKFILL);
  return added;
}
