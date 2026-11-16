import assert from "node:assert/strict";
import test from "node:test";
import { runsFromLog, totalTokens, usageCollector } from "../src/agent-usage.js";

const claudeResult = {
  type: "result", total_cost_usd: 1.3067, duration_api_ms: 208243,
  usage: { input_tokens: 52, cache_creation_input_tokens: 76162, cache_read_input_tokens: 1408935, output_tokens: 20771 },
  modelUsage: { "claude-opus-5-5": { inputTokens: 52, outputTokens: 20771, cacheReadInputTokens: 1408935, cacheCreationInputTokens: 76162, thinkingTokens: 6723, costUSD: 1.3067, costBasis: "list" } },
};

test("a Claude Code run reports tokens per model and its cost at API prices", () => {
  const c = usageCollector("claude");
  c.add({ type: "system", subtype: "init" });
  c.add(claudeResult);
  const u = c.result();
  assert.deepEqual([u.inputTokens, u.cacheWriteTokens, u.cacheReadTokens, u.outputTokens, u.thinkingTokens], [52, 76162, 1408935, 20771, 6723]);
  assert.equal(u.costUsd, 1.3067);
  assert.equal(u.costBasis, "list");
  assert.deepEqual(u.models, ["claude-opus-5-5"]);
  assert.equal(totalTokens(u), 52 + 76162 + 1408935 + 20771);
});

test("a run without a result event reports nothing", () => {
  assert.equal(usageCollector("claude").result(), null);
});

test("Codex turns add up; cached input is counted apart and there is no cost", () => {
  const c = usageCollector("codex");
  c.add({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 50, reasoning_output_tokens: 20 } });
  c.add({ type: "turn.completed", usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 10 } });
  const u = c.result();
  assert.deepEqual([u.inputTokens, u.cacheReadTokens, u.outputTokens, u.thinkingTokens, u.costUsd], [700, 800, 60, 20, null]);
});

test("an agent log splits into runs with their own usage", () => {
  const log = [
    "",
    "=== 2026-11-16T15:00:00.000Z claude model=default effort=high ===",
    JSON.stringify({ type: "system", subtype: "init", model: "claude-opus-5-5" }),
    "not json",
    JSON.stringify(claudeResult),
    "=== 2026-11-16T15:05:00.000Z claude model=sonnet effort=default ===",
    JSON.stringify({ type: "assistant" }),
  ].join("\n");
  const runs = runsFromLog(log);
  assert.equal(runs.length, 2);
  assert.deepEqual([runs[0].model, runs[0].effort, runs[0].usage.costUsd], ["claude-opus-5-5", "high", 1.3067]);
  // The second run was cut off: no result, no usage.
  assert.deepEqual([runs[1].model, runs[1].effort, runs[1].usage], ["sonnet", null, null]);
});

test("older logs without model and effort in the header are read too", () => {
  const runs = runsFromLog(["=== 2026-11-14T11:41:32.507Z claude ===", JSON.stringify(claudeResult)].join("\n"));
  assert.deepEqual([runs.length, runs[0].model, runs[0].effort, runs[0].usage.costUsd], [1, null, null, 1.3067]);
});
