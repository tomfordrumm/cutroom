// Runs the user's own editing agent (Claude Code or Codex CLI) headless in a
// version folder. Cutroom never reads the agents' credentials; it only checks
// whether the CLI has signed in, by the presence of its own auth file.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { usageCollector } from "./agent-usage.js";
import { config } from "./config.js";

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
  codex: ["minimal", "low", "medium", "high"],
};
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
    const child = spawn(command, args, { cwd, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
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
