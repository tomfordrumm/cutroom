// Runs the user's own editing agent (Claude Code or Codex CLI) headless in a
// version folder. Cutroom never reads the agents' credentials; it only checks
// whether the CLI has signed in, by the presence of its own auth file.
import { execFile, spawn } from "node:child_process";
import { createWriteStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { usageCollector } from "./agent-usage.js";
import { config } from "./config.js";
import { engineEnv } from "./engines.js";

export const AGENT_LABELS = { claude: "Claude Code", codex: "Codex CLI", none: "Без агента" };

export function agentStatus() {
  const home = config.paths.home;
  return {
    claude: existsSync(path.join(home, ".claude", ".credentials.json")) || Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
    codex: existsSync(path.join(home, ".codex", "auth.json")),
  };
}

// Model and reasoning effort per agent. Empty means the CLI's own default for
// the signed-in account. Claude takes an alias (opus, sonnet, haiku, fable) or
// a full model name; Codex takes a model name from its own list.
export const EFFORTS = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
};

const CLAUDE_MODELS = [
  { id: "opus", label: "Opus", description: "лучшее качество" },
  { id: "sonnet", label: "Sonnet", description: "быстрее и дешевле" },
  { id: "haiku", label: "Haiku", description: "самый быстрый" },
  { id: "fable", label: "Fable", description: "" },
].map((m) => ({ ...m, efforts: EFFORTS.claude, defaultEffort: null }));

// Codex publishes its model catalog for the signed-in account; it changes with
// the account and with Codex itself, so it is read from the CLI, not hard-coded.
let codexCatalog = null;
export function parseCodexModels(json) {
  const models = Array.isArray(json?.models) ? json.models : [];
  return models
    .filter((m) => m && typeof m.slug === "string" && m.visibility !== "hide")
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((m) => ({
      id: m.slug,
      label: m.display_name || m.slug,
      description: m.description ?? "",
      efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter((e) => EFFORTS.codex.includes(e)),
      defaultEffort: m.default_reasoning_level ?? null,
    }));
}

/** Models the agent can run on: a fixed list for Claude, the account's catalog for Codex. */
export async function agentModels(agent) {
  if (agent === "claude") return { models: CLAUDE_MODELS, error: null };
  if (agent !== "codex") return { models: [], error: null };
  if (!agentStatus().codex) return { models: [], error: "Codex CLI не подключён" };
  const auth = path.join(config.paths.home, ".codex", "auth.json");
  const stamp = statSync(auth).mtimeMs;
  if (codexCatalog && codexCatalog.stamp === stamp && Date.now() - codexCatalog.at < 10 * 60_000) return codexCatalog.value;
  try {
    const { stdout } = await promisify(execFile)("codex", ["debug", "models"], { env: { ...process.env, HOME: config.paths.home }, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    const value = { models: parseCodexModels(JSON.parse(stdout)), error: null };
    codexCatalog = { stamp, at: Date.now(), value };
    return value;
  } catch (error) {
    return { models: [], error: `Не удалось получить список моделей Codex: ${String(error.stderr || error.message).trim().split("\n")[0]}` };
  }
}
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:\/\[\]-]{0,79}$/;

export function normalizeAgentModels(value = {}) {
  const result = {};
  for (const agent of Object.keys(EFFORTS)) {
    const entry = value[agent] ?? {};
    const model = String(entry.model ?? "").trim();
    const effort = String(entry.effort ?? "").trim();
    if (model && !MODEL_PATTERN.test(model)) throw new Error(`Недопустимое имя модели: ${model}`);
    if (effort && !EFFORTS[agent].includes(effort)) throw new Error(`Недопустимый уровень рассуждений: ${effort}`);
    result[agent] = { model, effort };
  }
  return result;
}

function commandFor(agent, prompt, cwd, { model = "", effort = "" } = {}) {
  if (agent === "claude") {
    const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    return ["claude", args];
  }
  if (agent === "codex") {
    const args = ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-C", cwd];
    if (model) args.push("-m", model);
    if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
    return ["codex", [...args, prompt]];
  }
  throw new Error(`Unknown agent ${agent}`);
}

function trim(text, length = 140) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

/** One short line describing an agent event, for the job's live status. */
function describe(agent, event) {
  if (agent === "claude") {
    if (event.type === "assistant") {
      for (const part of event.message?.content ?? []) {
        if (part.type === "tool_use") {
          const input = part.input ?? {};
          return `${part.name}: ${trim(input.command ?? input.file_path ?? input.description ?? input.pattern ?? "")}`;
        }
        if (part.type === "text" && part.text.trim()) return trim(part.text);
      }
    }
    if (event.type === "result") return event.is_error ? `Ошибка агента: ${trim(event.result)}` : "Агент закончил";
    return null;
  }
  const item = event.item ?? event.msg ?? {};
  if (item.type === "command_execution" && item.command) return `Bash: ${trim(item.command)}`;
  if (item.type === "agent_message" && item.text) return trim(item.text);
  if (item.type === "file_change") return "Пишет файлы";
  if (event.type === "turn.failed" || event.type === "error") return `Ошибка агента: ${trim(event.error?.message ?? event.message)}`;
  return null;
}

/**
 * Run the agent until it exits. Resolves with { exitCode, model, usage },
 * rejects on spawn failure or abort (a cancelled run reports no usage). Every output line is appended to logPath.
 */
export function runAgent(agent, { prompt, cwd, logPath, signal, model = "", effort = "", onActivity = () => {} }) {
  const [command, args] = commandFor(agent, prompt, cwd, { model, effort });
  const log = createWriteStream(logPath, { flags: "a" });
  log.write(`\n=== ${new Date().toISOString()} ${command} model=${model || "default"} effort=${effort || "default"} ===\n`);
  return new Promise((resolve, reject) => {
    // The clip engines' browser, Python and no-telemetry settings, for the engines' own commands.
    const child = spawn(command, args, { cwd, env: { ...process.env, ...engineEnv(), CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "";
    let lastError = "";
    let usedModel = null;
    const usage = usageCollector(agent);
    const onLine = (line) => {
      log.write(`${line}\n`);
      try {
        const event = JSON.parse(line);
        if (event.type === "system" && event.subtype === "init" && event.model) usedModel = event.model;
        if (!usedModel && typeof event.model === "string") usedModel = event.model;
        usage.add(event);
        const activity = describe(agent, event);
        if (activity) onActivity(activity);
        if (activity?.startsWith("Ошибка агента")) lastError = activity;
      } catch { /* not JSON */ }
    };
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        onLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      log.write(text);
      if (text.trim()) lastError = trim(text, 300);
    });
    const abort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => { log.end(); reject(error); });
    child.on("close", (code) => {
      if (buffer) onLine(buffer);
      signal?.removeEventListener("abort", abort);
      log.end();
      if (signal?.aborted) reject(new Error("Отменено"));
      else resolve({ exitCode: code, lastError, model: usedModel ?? (model || null), usage: usage.result() });
    });
  });
}
