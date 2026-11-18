import assert from "node:assert/strict";
import test from "node:test";
import { programRangeToSource, wordsAround } from "../src/timeline.js";

// Two kept pieces: source 10–14 plays as 0–4, source 20–26 plays as 4–10.
const segments = [
  { programStart: 0, programEnd: 4, sourceStart: 10, sourceEnd: 14 },
  { programStart: 4, programEnd: 10, sourceStart: 20, sourceEnd: 26 },
];

test("a stretch inside one kept piece is one source interval", () => {
  assert.deepEqual(programRangeToSource(segments, 1, 3), [{ start: 11, end: 13 }]);
});

test("a stretch across a cut is split at the cut", () => {
  assert.deepEqual(programRangeToSource(segments, 2, 7), [{ start: 12, end: 14 }, { start: 20, end: 23 }]);
});

test("a stretch ending on a cut leaves no empty piece", () => {
  assert.deepEqual(programRangeToSource(segments, 1, 4), [{ start: 11, end: 14 }]);
});

test("words of a stretch are all words inside it, a point gets the words around it", () => {
  const timeline = { words: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => ({ start: t, end: t + 0.5, text: `w${t}` })) };
  assert.equal(wordsAround(timeline, 2, 2.5, 6), "w2 w3 w4 w5 w6");
  assert.equal(wordsAround(timeline, 5, 1), "w4 w5 w6");
});
