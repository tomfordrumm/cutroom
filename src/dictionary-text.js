// Dictionary text operations with no storage: validation, the Whisper prompt
// and transcript replacements. Used by the worker and by `cutroom cut`.
import { buildReviewPacket } from "@openroughcut/core/agent-review.js";

const MAX_TEXT = 80;
const MAX_WORDS = 6;
const PROMPT_CHARS = 400;

export const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
/** Lower case, ё → е, no punctuation around words: how spoken words are compared. */
export const normalizeWord = (word) => clean(word).toLowerCase().replace(/ё/g, "е").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
export const tokens = (text) => clean(text).split(" ").map(normalizeWord).filter(Boolean);

/** Throws a readable message for a bad entry; returns the cleaned fields. */
export function validateEntry({ from, to }) {
  const target = clean(to);
  const heard = clean(from) || null;
  if (!target) throw new Error("Укажите, как слово пишется правильно.");
  if (target.length > MAX_TEXT || (heard && heard.length > MAX_TEXT)) throw new Error(`Не длиннее ${MAX_TEXT} символов.`);
  if (!tokens(target).length) throw new Error("В написании нет букв или цифр.");
  if (heard) {
    const count = tokens(heard).length;
    if (!count) throw new Error("В том, что слышит Whisper, нет букв или цифр.");
    if (count > MAX_WORDS || tokens(target).length > MAX_WORDS) throw new Error(`Замена — до ${MAX_WORDS} слов.`);
    if (tokens(heard).join(" ") === tokens(target).join(" ") && heard === target) throw new Error("Слышит и пишется одинаково.");
  }
  return { from: heard, to: target };
}

/** Whisper's initial prompt: the author's spellings, newest first, within its context budget. */
export function whisperPrompt(entries) {
  const words = [];
  let length = 0;
  for (const { to } of entries) {
    if (words.includes(to)) continue;
    if (length + to.length + 2 > PROMPT_CHARS) break;
    words.push(to);
    length += to.length + 2;
  }
  return words.length ? `${words.join(", ")}.` : "";
}

/** Keep the capital letter of a sentence start when the spelling has none of its own. */
function matchCase(original, replacement) {
  const first = original.match(/\p{L}/u)?.[0];
  if (!first || first === first.toLowerCase()) return replacement;
  if (/\p{Lu}/u.test(replacement)) return replacement;
  return replacement.replace(/\p{L}/u, (letter) => letter.toUpperCase());
}

/** New word timings for `parts` spoken over the original `words` (each keeps its own time when the counts match). */
function retime(words, parts) {
  if (parts.length === words.length) return words.map(({ start, end }) => ({ start, end, estimated: false }));
  const timed = [];
  if (parts.length < words.length) {
    for (let k = 0; k < parts.length - 1; k++) timed.push({ start: words[k].start, end: words[k].end, estimated: false });
    timed.push({ start: words[parts.length - 1].start, end: words.at(-1).end, estimated: false });
    return timed;
  }
  for (let k = 0; k < words.length - 1; k++) timed.push({ start: words[k].start, end: words[k].end, estimated: false });
  // More words than were heard: the last heard word's time is shared by length.
  const rest = parts.slice(words.length - 1);
  const { start, end } = words.at(-1);
  const total = rest.reduce((sum, part) => sum + part.length, 0) || rest.length;
  let cursor = start;
  for (const part of rest) {
    const next = cursor + (end - start) * (part.length || 1) / total;
    timed.push({ start: cursor, end: next, estimated: true });
    cursor = next;
  }
  return timed;
}

function correctSegment(segment, rules, applied) {
  const words = segment.words;
  if (!Array.isArray(words) || !words.length) return segment;
  let text = String(segment.text ?? "");
  const spoken = words.map((word) => normalizeWord(text.slice(word.startChar, word.endChar)));
  const out = [];
  let shift = 0;
  let changed = false;
  for (let i = 0; i < words.length;) {
    const rule = rules.find((r) => r.heard.length && r.heard.every((token, k) => spoken[i + k] === token));
    if (!rule) {
      out.push({ ...words[i], startChar: words[i].startChar + shift, endChar: words[i].endChar + shift });
      i += 1;
      continue;
    }
    const span = words.slice(i, i + rule.heard.length);
    const from = span[0].startChar + shift;
    const to = span.at(-1).endChar + shift;
    const original = text.slice(from, to);
    const replacement = matchCase(original, rule.to);
    text = `${text.slice(0, from)}${replacement}${text.slice(to)}`;
    const parts = replacement.split(" ");
    const timing = retime(span, parts);
    let cursor = from;
    parts.forEach((part, k) => {
      const { estimated, ...times } = timing[k];
      out.push({ ...span[Math.min(k, span.length - 1)], ...times, startChar: cursor, endChar: cursor + part.length, ...(estimated ? { timingEstimated: true } : {}) });
      cursor += part.length + 1;
    });
    shift += replacement.length - original.length;
    const record = applied.get(rule.id) ?? { id: rule.id, from: rule.from, to: rule.to, count: 0, at: [] };
    record.count += 1;
    if (record.at.length < 10) record.at.push(Math.round(span[0].start * 100) / 100);
    applied.set(rule.id, record);
    changed = true;
    i += rule.heard.length;
  }
  return changed ? { ...segment, text, words: out } : segment;
}

/** The transcript with dictionary replacements; untouched when nothing matches. */
export function applyDictionary(transcript, entries) {
  const rules = (entries ?? []).filter((entry) => entry.from)
    .map((entry) => ({ ...entry, heard: tokens(entry.from) }))
    // Longer phrases first, so "не рассеть" wins over a rule for "рассеть".
    .sort((a, b) => b.heard.length - a.heard.length);
  const applied = new Map();
  if (!rules.length || !transcript?.segments) return { transcript, applied: [] };
  const segments = transcript.segments.map((segment) => correctSegment(segment, rules, applied));
  if (!applied.size) return { transcript, applied: [] };
  return {
    transcript: { ...transcript, segments, text: segments.map((segment) => segment.text).join(" "), dictionary: [...applied.values()] },
    applied: [...applied.values()],
  };
}

/** The review packet rebuilt over the corrected transcript. Unit ids stay the same, so decisions carry over. */
export function packetWithDictionary(packet, entries) {
  const { transcript, applied } = applyDictionary(packet.transcript, entries);
  if (!applied.length) return { packet, applied };
  const sources = packet.candidateSources ?? [];
  const { path: inputPath, durationSeconds, ...fingerprint } = packet.input;
  const rebuilt = buildReviewPacket({
    inputPath,
    fingerprint,
    media: { duration: durationSeconds },
    transcript,
    textEdits: { candidates: sources, summary: { reviewPolicy: packet.reviewPolicy } },
    applied: sources.filter((_, index) => packet.candidates[index]?.applied),
    settings: packet.settings,
    reviewPath: packet.decisionsTemplate?.review ?? "review.json",
    outputPath: packet.output,
    applyCommand: packet.applyCommand,
  });
  const sameUnits = rebuilt.units.length === packet.units.length
    && rebuilt.units.every((unit, index) => unit.start === packet.units[index].start && unit.end === packet.units[index].end);
  // Should the words regroup into different units, keep the old ones: decisions name units by id.
  return { packet: sameUnits ? rebuilt : { ...packet, transcript }, applied };
}

/** What the agent reads: the vocabulary in force and how to add to it. */
export function dictionaryMarkdown(entries, applied, prompt) {
  const lines = ["# Словарь распознавания", ""];
  if (!entries.length) lines.push("Словарь пока пуст.");
  for (const entry of entries) {
    lines.push(`- ${entry.from ? `«${entry.from}» → ` : ""}**${entry.to}**${entry.videoId ? " (только этот ролик)" : ""}`);
  }
  lines.push("", "## Применено к этой расшифровке", "");
  if (!applied.length) lines.push("Замен не было.");
  for (const item of applied) lines.push(`- «${item.from}» → «${item.to}»: ${item.count} раз (${item.at.map((t) => `${t.toFixed(2)} с`).join(", ")})`);
  lines.push("", `Подсказка Whisper для новых записей: ${prompt ? `«${prompt}»` : "нет"}.`, "");
  return `${lines.join("\n")}\n`;
}
