import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { placeGraphics, validateGraphics } from "../src/graphics.js";
import { builtinSounds, resolveRef } from "../src/library.js";
import { imageSize, readPack } from "../src/packs.js";
import { critiqueProblems, reviewDrawings, reviewScenes } from "../src/scenes.js";

const base = await readPack(path.resolve("packs/base"));
const graphics = (overlays, extra = {}) => ({ format: "cutroom-graphics-v1", overlays, ...extra });

test("the base pack has looks and ready illustrations", () => {
  assert.deepEqual(Object.keys(base.looks), ["night", "paper", "clean", "neon"]);
  assert.equal(base.defaultLook, "night");
  assert.ok(base.illustrations.length >= 150);
  const robot = base.illustrations.find((i) => i.id === "robot");
  assert.equal(robot.width, 256);
  assert.match(robot.description, /робот/);
});

test("a look sets the theme, graphics.json overrides single fields", () => {
  const paper = validateGraphics(graphics([], { look: "paper", theme: { accent: "#112233" } }), { duration: 10, pack: base });
  assert.equal(paper.look, "paper");
  assert.equal(paper.theme.background, "#F3EFE6");
  assert.equal(paper.theme.displayFont, "PT Serif");
  assert.equal(paper.theme.accent, "#112233");
  assert.equal(validateGraphics(graphics([]), { duration: 10, pack: base }).look, "night");
  assert.throws(() => validateGraphics(graphics([], { look: "sepia" }), { duration: 10, pack: base }), /стили night, paper, clean, neon/);
});

test("a sticker names an illustration of the pack", () => {
  assert.doesNotThrow(() => validateGraphics(graphics([{ id: "r", type: "sticker", start: 1, end: 3, props: { id: "robot" } }]), { duration: 10, pack: base }));
  assert.throws(() => validateGraphics(graphics([{ id: "r", type: "sticker", start: 1, end: 3, props: { id: "unicorn" } }]), { duration: 10, pack: base }), /illustrations.md/);
  assert.throws(() => validateGraphics(graphics([{ id: "r", type: "sticker", start: 1, end: 3, props: { id: "robot" } }]), { duration: 10, pack: null }), /нет иллюстраций/);
});

test("chat messages are checked and their source seconds become frames of the element", () => {
  const chat = { id: "c", type: "chat", start: 10, end: 20, props: { app: "ChatGPT", messages: [{ role: "user", text: "План на неделю", type: [11, 13] }, { role: "assistant", text: "Понедельник", at: 15 }] } };
  const valid = validateGraphics(graphics([chat]), { duration: 30, pack: base });
  // 12–14 s of the source are cut: what stays after them moves 2 s earlier.
  const timeline = { duration: 26, segments: [{ sourceStart: 0, sourceEnd: 12, programStart: 0, programEnd: 12 }, { sourceStart: 14, sourceEnd: 30, programStart: 12, programEnd: 28 }] };
  const { overlays, warnings } = placeGraphics(valid, timeline, 30);
  const [user, answer] = overlays[0].props.messages;
  assert.deepEqual(user.frames, { typeFrom: 30, typeTo: 60 });
  assert.deepEqual(answer.frames, { at: 90 });
  assert.match(warnings.join(" "), /внутри чата вырезан/);
  assert.throws(() => validateGraphics(graphics([{ ...chat, props: { messages: [{ role: "assistant", text: "x", type: [11, 12] }] } }]), { duration: 30, pack: base }), /только у user/);
  assert.throws(() => validateGraphics(graphics([{ ...chat, props: { messages: [{ role: "user", text: "x", at: 25 }] } }]), { duration: 30, pack: base }), /внутри элемента/);
});

const full = (id, start, end) => ({ id, type: "custom", component: "Scene", start, end, props: { fullFrame: true } });
const scene = (id, start, end, fields = {}) => ({ id, start, end, device: "thing", show: "экран", adds: "видно", text: [], overlays: [id], ...fields });
const map = (scenes) => ({ format: "cutroom-scenes-v2", thread: "экран приложения", scenes });

test("back-to-back full-frame scenes need a carry", () => {
  const overlays = [full("a", 0, 3), full("b", 3, 6), full("c", 9, 12)];
  const slides = reviewScenes({ graphics: graphics(overlays), scenes: map([scene("a", 0, 3), scene("b", 3, 6), scene("c", 9, 12)]), speech: [] });
  assert.equal(slides.problems.filter((p) => /встык/.test(p)).length, 1, "only a → b: c comes after the presenter");
  assert.match(slides.problems.find((p) => /встык/.test(p)), /^a → b/);
  const carried = reviewScenes({ graphics: graphics(overlays), scenes: map([scene("a", 0, 3, { carry: "сумма становится заголовком" }), scene("b", 3, 6), scene("c", 9, 12)]), speech: [] });
  assert.ok(!carried.problems.some((p) => /встык/.test(p)));
  // One component across both scenes carries by itself.
  const shared = reviewScenes({ graphics: graphics([full("a", 0, 6)]), scenes: map([scene("a", 0, 3), scene("b", 3, 6, { overlays: ["a"] })]), speech: [] });
  assert.ok(!shared.problems.some((p) => /встык/.test(p)));
});

test("scenes of one length are a metronome warning", () => {
  const overlays = [0, 1, 2, 3, 4].map((i) => full(`s${i}`, i * 5, i * 5 + 3));
  const even = reviewScenes({ graphics: graphics(overlays), scenes: map(overlays.map((o) => scene(o.id, o.start, o.end))), speech: [] });
  assert.match(even.warnings.join(" "), /метроном/);
  const varied = [full("v0", 0, 1), full("v1", 5, 9), full("v2", 12, 12.6), full("v3", 15, 18), full("v4", 22, 23)];
  assert.deepEqual(reviewScenes({ graphics: graphics(varied), scenes: map(varied.map((o) => scene(o.id, o.start, o.end))), speech: [] }).warnings, []);
});

test("characters drawn from SVG shapes are sent back, interfaces and illustrations pass", () => {
  const robot = `function Robot() { return <svg>${"<rect/><circle/>".repeat(6)}</svg> }\nexport default function Story() { return <Robot /> }`;
  const { problems } = reviewDrawings([{ file: "custom/Story.tsx", code: robot }], { illustrations: 195 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Robot нарисован из 12 фигур SVG/);
  assert.match(problems[0], /иллюстрацию пакета/);
  const card = `function RobotCard() { return <Illustration id="robot" /> }\nfunction Header() { return <svg>${"<rect/>".repeat(10)}</svg> }`;
  assert.deepEqual(reviewDrawings([{ file: "custom/Card.tsx", code: card }]).problems, []);
  const heavy = reviewDrawings([{ file: "custom/Chart.tsx", code: `function Chart() { return <svg>${"<path/>".repeat(80)}</svg> }` }]);
  assert.deepEqual(heavy.problems, []);
  assert.match(heavy.warnings[0], /80 фигур/);
});

test("the critic's note is required when there are scenes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cutroom-critique-"));
  assert.deepEqual(await critiqueProblems(dir, 0), []);
  assert.match((await critiqueProblems(dir, 2))[0], /Нет critique.md/);
  await writeFile(path.join(dir, "critique.md"), "Всё хорошо.");
  assert.match((await critiqueProblems(dir, 2))[0], /списком/);
  await writeFile(path.join(dir, "critique.md"), "# Критик\n\n- s2: текст мелкий для телефона, увеличил до 64 px.\n");
  assert.deepEqual(await critiqueProblems(dir, 2), []);
});

test("built-in sounds are listed by role and resolve as sounds/<role>/<file>", () => {
  const { roles } = builtinSounds();
  for (const role of ["click", "key", "pop", "success", "error", "paper"]) assert.ok(roles[role]?.files.length, role);
  const file = roles.click.files[0].file;
  const resolved = resolveRef(`sounds/click/${file}`);
  assert.equal(resolved.kind, "audio");
  assert.match(resolved.file, /sounds\/click\//);
  assert.match(resolveRef("sounds/none/x.ogg").error, /sounds\//);
});

test("image sizes are read from PNG headers", async () => {
  assert.deepEqual(await imageSize(path.resolve("packs/base/illustrations/robot.png")), { width: 256, height: 256 });
  assert.equal(await imageSize(path.resolve("packs/base/pack.json")), null);
});
