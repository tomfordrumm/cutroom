// What the editing agent spent: one row per agent run (an attempt), summed
// per version, per video and overall. Rows go with their video on delete.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { runsFromLog, totalTokens } from "./agent-usage.js";
import { videoDir } from "./config.js";
import { db, getSetting, now, setSetting } from "./db.js";

db.exec(`
CREATE TABLE IF NOT EXISTS agent_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  version INTEGER,
  job_id INTEGER,
  attempt INTEGER,
  agent TEXT NOT NULL,
  model TEXT,
  effort TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  cost_basis TEXT,
  api_ms INTEGER,
  exit_code INTEGER,
  started_at TEXT,
  finished_at TEXT,
  source TEXT NOT NULL DEFAULT 'run'
);
CREATE INDEX IF NOT EXISTS agent_runs_video ON agent_runs(video_id, version);
`);

/** Stores one run. A run without usage (cancelled, crashed) is stored with zeros. */
export function recordRun({ videoId, version = null, jobId = null, attempt = null, agent, model = null, effort = null, usage = null, exitCode = null, startedAt = null, finishedAt = now(), source = "run" }) {
  const u = usage ?? {};
  db.prepare(`INSERT INTO agent_runs (video_id, version, job_id, attempt, agent, model, effort, input_tokens, cache_write_tokens, cache_read_tokens,
    output_tokens, thinking_tokens, cost_usd, cost_basis, api_ms, exit_code, started_at, finished_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(videoId, version, jobId, attempt, agent, model, effort || null, u.inputTokens ?? 0, u.cacheWriteTokens ?? 0, u.cacheReadTokens ?? 0,
      u.outputTokens ?? 0, u.thinkingTokens ?? 0, u.costUsd ?? null, u.costBasis ?? null, u.apiMs ?? null, exitCode, startedAt, finishedAt, source);
}

const SUMS = `COUNT(*) AS runs,
  SUM(input_tokens) AS inputTokens, SUM(cache_write_tokens) AS cacheWriteTokens, SUM(cache_read_tokens) AS cacheReadTokens,
  SUM(output_tokens) AS outputTokens, SUM(thinking_tokens) AS thinkingTokens,
  SUM(cost_usd) AS costUsd, SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpricedRuns`;

function totals(row) {
  if (!row || !row.runs) return { runs: 0, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0, tokens: 0, costUsd: null, unpricedRuns: 0 };
  const result = {
    runs: row.runs,
    inputTokens: row.inputTokens ?? 0,
    cacheWriteTokens: row.cacheWriteTokens ?? 0,
    cacheReadTokens: row.cacheReadTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    thinkingTokens: row.thinkingTokens ?? 0,
    costUsd: row.costUsd == null ? null : Math.round(row.costUsd * 10000) / 10000,
    unpricedRuns: row.unpricedRuns ?? 0,
  };
  return { ...result, tokens: totalTokens(result) };
}

/** Per version and in total for one video. */
export function videoUsage(videoId) {
  const versions = Object.fromEntries(db.prepare(`SELECT version, ${SUMS} FROM agent_runs WHERE video_id = ? AND version IS NOT NULL GROUP BY version`).all(videoId)
    .map((row) => [row.version, totals(row)]));
  return { total: totals(db.prepare(`SELECT ${SUMS} FROM agent_runs WHERE video_id = ?`).get(videoId)), versions };
}

/** Totals per video id, for the board. */
export function usageByVideo() {
  return new Map(db.prepare(`SELECT video_id, ${SUMS} FROM agent_runs GROUP BY video_id`).all().map((row) => [row.video_id, totals(row)]));
}

/** Everything: overall, per agent and model, per month and per video. */
export function usageSummary() {
  return {
    total: totals(db.prepare(`SELECT ${SUMS} FROM agent_runs`).get()),
    byModel: db.prepare(`SELECT agent, model, ${SUMS} FROM agent_runs GROUP BY agent, model ORDER BY SUM(cost_usd) DESC`).all()
      .map((row) => ({ agent: row.agent, model: row.model, ...totals(row) })),
    byMonth: db.prepare(`SELECT substr(COALESCE(started_at, finished_at), 1, 7) AS month, ${SUMS} FROM agent_runs GROUP BY month ORDER BY month DESC`).all()
      .map((row) => ({ month: row.month, ...totals(row) })),
    videos: db.prepare(`SELECT v.id, v.title, v.stage, v.latest_version AS latestVersion, MAX(r.finished_at) AS lastRunAt, ${SUMS}
      FROM videos v JOIN agent_runs r ON r.video_id = v.id GROUP BY v.id ORDER BY SUM(r.cost_usd) DESC`).all()
      .map(({ id, title, stage, latestVersion, lastRunAt, ...row }) => ({ id, title, stage, latestVersion, lastRunAt, ...totals(row) })),
  };
}

/**
 * Once: reads the agent.log of versions made before runs were recorded, so
 * the statistics start with what was already spent.
 */
export async function backfillUsage() {
  // Bump when the log reader learns a new format; versions already counted are skipped.
  const BACKFILL = 2;
  if (getSetting("usageBackfill", 0) >= BACKFILL) return 0;
  let added = 0;
  const videos = db.prepare("SELECT id FROM videos").all();
  for (const { id } of videos) {
    const dir = path.join(videoDir(id), "versions");
    for (const name of (await readdir(dir).catch(() => [])).filter((n) => /^v\d{3}$/.test(n))) {
      const number = Number(name.slice(1));
      if (db.prepare("SELECT 1 FROM agent_runs WHERE video_id = ? AND version = ?").get(id, number)) continue;
      const text = await readFile(path.join(dir, name, "agent.log"), "utf8").catch(() => "");
      runsFromLog(text).forEach((run, index) => {
        recordRun({ videoId: id, version: number, attempt: index + 1, agent: run.agent, model: run.model, effort: run.effort, usage: run.usage, startedAt: run.startedAt, finishedAt: run.startedAt, source: "log" });
        added++;
      });
    }
  }
  setSetting("usageBackfill", BACKFILL);
  return added;
}

