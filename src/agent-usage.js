// Tokens and cost of one agent run, read from the CLI's own JSON events.
//
// Claude Code ends a run with a `result` event: tokens per model and
// `total_cost_usd`, priced at API list prices (`costBasis: "list"`). On a
// subscription that is what the run would cost through the API, not money
// charged. Codex reports tokens per turn (`turn.completed`) and no cost.

const EMPTY = { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, thinkingTokens: 0 };
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/** Accumulates usage from a run's events. `add(event)` per event, `result()` at the end. */
export function usageCollector(agent) {
  let claude = null;
  const codex = { ...EMPTY };
  let codexTurns = 0;
  return {
    add(event) {
      if (!event || typeof event !== "object") return;
      if (agent === "claude" && event.type === "result") claude = event;
      if (agent === "codex" && event.type === "turn.completed" && event.usage) {
        const u = event.usage;
        const cached = num(u.cached_input_tokens);
        codex.inputTokens += Math.max(0, num(u.input_tokens) - cached);
        codex.cacheReadTokens += cached;
        codex.outputTokens += num(u.output_tokens);
        codex.thinkingTokens += num(u.reasoning_output_tokens);
        codexTurns++;
      }
    },
    result() {
      if (agent === "claude") return claude ? claudeUsage(claude) : null;
      if (agent === "codex") return codexTurns ? { ...codex, costUsd: null, costBasis: null, apiMs: null, models: [] } : null;
      return null;
    },
  };
}

function claudeUsage(event) {
  const models = event.modelUsage && typeof event.modelUsage === "object" ? event.modelUsage : null;
  const totals = { ...EMPTY };
  if (models && Object.keys(models).length) {
    // Per model, so a run that also used a helper model counts it.
    for (const m of Object.values(models)) {
      totals.inputTokens += num(m.inputTokens);
      totals.cacheWriteTokens += num(m.cacheCreationInputTokens);
      totals.cacheReadTokens += num(m.cacheReadInputTokens);
      totals.outputTokens += num(m.outputTokens);
      totals.thinkingTokens += num(m.thinkingTokens);
    }
  } else if (event.usage) {
    const u = event.usage;
    Object.assign(totals, {
      inputTokens: num(u.input_tokens),
      cacheWriteTokens: num(u.cache_creation_input_tokens),
      cacheReadTokens: num(u.cache_read_input_tokens),
      outputTokens: num(u.output_tokens),
      thinkingTokens: num(u.output_tokens_details?.thinking_tokens),
    });
  }
  const basis = models ? Object.values(models).map((m) => m.costBasis).find(Boolean) : null;
  return {
    ...totals,
    costUsd: Number.isFinite(Number(event.total_cost_usd)) ? Number(event.total_cost_usd) : null,
    costBasis: basis ?? null,
    apiMs: Number.isFinite(Number(event.duration_api_ms)) ? Number(event.duration_api_ms) : null,
    models: models ? Object.keys(models) : [],
  };
}

/** All tokens a run moved: input, cache writes and reads, output (thinking is part of output). */
export const totalTokens = (u) => num(u?.inputTokens) + num(u?.cacheWriteTokens) + num(u?.cacheReadTokens) + num(u?.outputTokens);

/**
 * Splits an agent.log into runs by its "=== <time> <command> model=… effort=… ===" headers
 * and reads each run's usage. For versions made before usage was recorded.
 */
export function runsFromLog(text) {
  const runs = [];
  let current = null;
  for (const line of String(text).split("\n")) {
    // Logs written before model choice have no model= and effort=.
    const header = /^=== (\S+) (claude|codex)(?: model=(\S+) effort=(\S+))? ===$/.exec(line);
    if (header) {
      const setting = (value) => (!value || value === "default" ? null : value);
      current = { startedAt: header[1], agent: header[2], model: setting(header[3]), effort: setting(header[4]), collector: usageCollector(header[2]), usedModel: null };
      runs.push(current);
      continue;
    }
    if (!current || !line.startsWith("{")) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "system" && event.subtype === "init" && event.model) current.usedModel = event.model;
      current.collector.add(event);
    } catch { /* not JSON */ }
  }
  return runs.map(({ collector, usedModel, model, ...run }) => ({ ...run, model: usedModel ?? model, usage: collector.result() }));
}
