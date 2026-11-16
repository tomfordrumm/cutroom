import assert from "node:assert/strict";
import test from "node:test";
import { applyDictionary, validateEntry, whisperPrompt } from "../src/dictionary-text.js";

// "Попросил не рассеть поменять цвет кнопки, а она переделла пол страницы."
function transcript() {
  const text = "Не рассеть, говорю. Попросил не рассеть поменять цвет.";
  const words = [];
  let t = 1;
  for (const match of text.matchAll(/[\p{L}]+/gu)) {
    words.push({ startChar: match.index, endChar: match.index + match[0].length, start: t, end: t + 0.4, probability: 0.9 });
    t += 0.5;
  }
  return { language: "ru", text, segments: [{ start: 1, end: t, text, words }] };
}
const wordsOf = (segment) => segment.words.map((w) => segment.text.slice(w.startChar, w.endChar));

test("merges a misheard phrase into one word with the span of both", () => {
  const { transcript: fixed, applied } = applyDictionary(transcript(), [{ id: 1, from: "не рассеть", to: "нейросеть" }]);
  const segment = fixed.segments[0];
  assert.equal(segment.text, "Нейросеть, говорю. Попросил нейросеть поменять цвет.");
  assert.deepEqual(wordsOf(segment), ["Нейросеть", "говорю", "Попросил", "нейросеть", "поменять", "цвет"]);
  assert.equal(segment.words[0].start, 1);
  assert.equal(segment.words[0].end, 1.9);
  assert.equal(applied[0].count, 2);
  assert.deepEqual(applied[0].at, [1, 3]);
});

test("keeps word timing one to one and spelling with its own capitals", () => {
  const source = transcript();
  const { transcript: fixed } = applyDictionary(source, [{ id: 2, from: "рассеть", to: "Claude Code" }]);
  const segment = fixed.segments[0];
  assert.equal(segment.text, "Не Claude Code, говорю. Попросил не Claude Code поменять цвет.");
  assert.deepEqual(wordsOf(segment).slice(0, 3), ["Не", "Claude", "Code"]);
  assert.ok(segment.words[1].timingEstimated);
  assert.equal(segment.words[1].start, 1.5);
  assert.equal(segment.words[2].end, 1.9);
});

test("leaves the transcript alone when nothing matches", () => {
  const source = transcript();
  const result = applyDictionary(source, [{ id: 3, from: "ChatGPT", to: "ChatGPT" }, { id: 4, from: null, to: "Cursor" }]);
  assert.equal(result.transcript, source);
  assert.deepEqual(result.applied, []);
});

test("validates entries and builds a Whisper prompt", () => {
  assert.throws(() => validateEntry({ to: "  " }), /правильно/);
  assert.throws(() => validateEntry({ from: "a b c d e f g", to: "x" }), /до 6 слов/);
  assert.deepEqual(validateEntry({ from: " клод  код ", to: "Claude Code" }), { from: "клод код", to: "Claude Code" });
  assert.equal(whisperPrompt([{ to: "Claude Code" }, { to: "нейросеть" }, { to: "Claude Code" }]), "Claude Code, нейросеть.");
  assert.equal(whisperPrompt([]), "");
});
