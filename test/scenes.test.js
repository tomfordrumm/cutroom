import assert from "node:assert/strict";
import test from "node:test";
import { reviewScenes, speechWords } from "../src/scenes.js";

const packet = { transcript: { segments: [
  { start: 6, end: 9, text: "У нейросетей есть что-то типа синдрома отличника." },
  { start: 49, end: 55, text: "И вот ChatGPT придумывает факты, которых не существует." },
] } };
const speech = speechWords(packet);
const graphics = (overlays) => ({ overlays });
const card = (id, start, end, props = {}) => ({ id, type: "custom", component: "Scene", start, end, props });
const scene = (fields) => ({ id: "s1", start: 49, end: 55, device: "example", show: "в чате вопрос и уверенный выдуманный ответ, на ссылке штамп", adds: "видно, как правдоподобна выдумка", text: [], overlays: ["facts"], ...fields });
const map = (scenes, extra = {}) => ({ format: "cutroom-scenes-v2", thread: "окно чата", scenes, ...extra });
const action = (id, start, end) => ({ id, type: "action", start, end, props: { subject: "A", action: "b", object: "C", fullFrame: true } });

test("graphics without a scene map are sent back", () => {
  const { problems } = reviewScenes({ graphics: graphics([card("facts", 49, 55)]), scenes: null, speech });
  assert.match(problems[0], /Нет scenes.json/);
});

test("zooms, hook plates and the author's media need no scene", () => {
  const { problems } = reviewScenes({ graphics: graphics([{ id: "z", type: "zoom", start: 1, end: 2, props: {} }, { id: "h", type: "title", start: 0, end: 2, props: { text: "Хук" } }, { id: "p", type: "image", start: 3, end: 4, props: { fullFrame: true } }]), scenes: null, speech });
  assert.deepEqual(problems, []);
});

test("a phrase the author says at that moment is a retelling of the captions", () => {
  const { problems } = reviewScenes({ graphics: graphics([card("facts", 49, 55)]), scenes: map([scene({ text: ["ChatGPT придумывает факты"] })]), speech });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /повторяет то, что автор говорит/);
});

test("names and a short key phrase pass", () => {
  const { problems } = reviewScenes({ graphics: graphics([card("facts", 49, 55)]), scenes: map([scene({ text: ["ChatGPT", "не существует"] })]), speech });
  assert.deepEqual(problems, []);
});

test("the same words at another moment are not a retelling", () => {
  const { problems } = reviewScenes({ graphics: graphics([card("facts", 6, 9)]), scenes: map([scene({ start: 6, end: 9, text: ["ChatGPT придумывает факты"] })]), speech });
  assert.deepEqual(problems, []);
});

test("too many words, missing fields, unknown and unmapped overlays are reported", () => {
  const { problems } = reviewScenes({
    graphics: graphics([card("facts", 49, 55), card("other", 60, 62)]),
    scenes: map([scene({ show: "", device: "icons", text: ["один два три четыре пять шесть", "семь восемь девять десять одиннадцать"], overlays: ["facts", "ghost"] })]),
    speech,
  });
  assert.ok(problems.some((p) => /заполни show/.test(p)));
  assert.ok(problems.some((p) => /device — один из/.test(p)));
  assert.ok(problems.some((p) => /на экране 11 слов/.test(p)));
  assert.ok(problems.some((p) => /ghost нет в graphics.json/.test(p)));
  assert.ok(problems.some((p) => /other: не входит ни в одну сцену/.test(p)));
});

test("typing the spoken text with captions hidden is the action, not a retelling", () => {
  const { problems } = reviewScenes({ graphics: graphics([card("facts", 49, 55, { hideCaptions: true })]), scenes: map([scene({ text: ["И вот ChatGPT придумывает факты, которых не существует"] })]), speech });
  assert.deepEqual(problems, []);
});

test("text in custom components must be declared in the map", () => {
  const { problems } = reviewScenes({ graphics: graphics([card("facts", 49, 55)]), scenes: map([scene({ text: ["ChatGPT"] })]), speech, custom: [{ file: "custom/Scene.tsx", text: "Как её учили" }, { file: "custom/Scene.tsx", text: "ChatGPT" }] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /«Как её учили» \(custom\/Scene.tsx\)/);
});

test("a spoken sentence split into short lines is still a retelling", () => {
  const split = reviewScenes({ graphics: graphics([card("s", 6, 9)]), scenes: map([scene({ id: "s1", start: 6, end: 9, overlays: ["s"], text: ["У нейросетей", "что-то типа", "синдрома отличника"] })]), speech });
  assert.match(split.problems[0], /вместе повторяют/);
  // Labels made of names do not add up to a sentence.
  const labels = reviewScenes({ graphics: graphics([card("facts", 49, 55)]), scenes: map([scene({ text: ["ChatGPT", "факт", "выдумывает", "не существует"] })]), speech });
  assert.deepEqual(labels.problems, []);
});

test("one built-in template for most scenes or three in a row is sent back", () => {
  const overlays = [0, 1, 2, 3, 4].map((i) => action(`a${i}`, 10 + i * 5, 14 + i * 5));
  const scenes = overlays.map((o, i) => scene({ id: `s${i}`, start: o.start, end: o.end, device: "process", overlays: [o.id] }));
  const { problems } = reviewScenes({ graphics: graphics(overlays), scenes: map(scenes), speech });
  assert.ok(problems.some((p) => /Шаблон action в 5 сценах из 5/.test(p)));
  assert.equal(problems.filter((p) => /3 сцены подряд/.test(p)).length, 1);
});

test("a thread drawn by one custom component through many scenes is not a template", () => {
  const overlays = [0, 1, 2, 3].map((i) => ({ ...card(`c${i}`, 10 + i * 5, 14 + i * 5), component: "Chat" }));
  const scenes = overlays.map((o, i) => scene({ id: `s${i}`, start: o.start, end: o.end, overlays: [o.id] }));
  const mixed = [action("a1", 40, 44)];
  const { problems } = reviewScenes({ graphics: graphics([...overlays, ...mixed]), scenes: map([...scenes, scene({ id: "s9", start: 40, end: 44, device: "process", overlays: ["a1"] })]), speech });
  assert.deepEqual(problems, []);
});

test("three or more scenes need a visual thread", () => {
  const overlays = [0, 1, 2].map((i) => card(`c${i}`, 10 + i * 5, 14 + i * 5));
  const scenes = overlays.map((o, i) => scene({ id: `s${i}`, start: o.start, end: o.end, overlays: [o.id] }));
  const { problems } = reviewScenes({ graphics: graphics(overlays), scenes: map(scenes, { thread: "" }), speech });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /заполни thread/);
});

test("maps written before v2 keep passing", () => {
  const old = { format: "cutroom-scenes-v1", scenes: [{ id: "s1", start: 49, end: 55, subject: "ChatGPT", action: "выдумывает", object: "факт", visual: "бот штампует документ", text: ["ChatGPT"], overlays: ["facts"] }] };
  const { problems, scenes } = reviewScenes({ graphics: graphics([card("facts", 49, 55)]), scenes: old, speech });
  assert.deepEqual(problems, []);
  assert.equal(scenes[0].show, "бот штампует документ");
});

test("a click before the typing does not take the exemption away", () => {
  const overlays = [card("open", 49, 51), card("type", 51, 55, { hideCaptions: true })];
  const { problems } = reviewScenes({ graphics: graphics(overlays), scenes: map([scene({ overlays: ["open", "type"], device: "thing", text: ["Инструкция", "И вот ChatGPT придумывает факты, которых не существует, и ещё больше слов сверх лимита"] })]), speech });
  assert.deepEqual(problems, []);
});
