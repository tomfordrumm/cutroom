import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.CUTROOM_DATA = await mkdtemp(path.join(tmpdir(), "cutroom-engines-"));
await mkdir(path.join(process.env.CUTROOM_DATA, "db"), { recursive: true });
const { enabledEngines, enginesSnapshot, engineEnv, installOnetake, setEngineEnabled } = await import("../src/engines.js");
const { newClip, CLIP_NAME } = await import("../src/clips.js");
const { resolveRef } = await import("../src/library.js");
const { validateGraphics } = await import("../src/graphics.js");
const { reviewScenes } = await import("../src/scenes.js");

test("onetake is not installed by default and asks for the licence", () => {
  const onetake = enginesSnapshot().engines.find((e) => e.id === "onetake");
  assert.equal(onetake.installed, false);
  assert.equal(onetake.enabled, false);
  assert.equal(onetake.license, "PolyForm Noncommercial 1.0.0");
  assert.match(onetake.proUrl, /onetakemotion\.com/);
  assert.throws(() => installOnetake({ acceptLicense: false }), /условия лицензии/);
  assert.throws(() => setEngineEnabled("onetake", true), /не установлен/);
  assert.ok(!enabledEngines().includes("onetake"));
});

test("HyperFrames can be switched off, engines get no telemetry", () => {
  setEngineEnabled("hyperframes", false);
  assert.equal(enginesSnapshot().engines.find((e) => e.id === "hyperframes").enabled, false);
  setEngineEnabled("hyperframes", true);
  const env = engineEnv();
  assert.equal(env.HYPERFRAMES_NO_TELEMETRY, "1");
  assert.equal(env.DO_NOT_TRACK, "1");
  assert.match(env.PLAYWRIGHT_BROWSERS_PATH, /engines\/onetake\/browsers$/);
});

test("a clip needs a known name and an enabled engine", async () => {
  assert.ok(CLIP_NAME.test("chat-demo"));
  assert.ok(!CLIP_NAME.test("Chat Demo"));
  const dir = await mkdtemp(path.join(tmpdir(), "cutroom-clip-"));
  await assert.rejects(newClip(dir, "intro", { engine: "onetake", duration: 4 }), /выключен или не установлен/);
  await assert.rejects(newClip(dir, "intro", { engine: "flash", duration: 4 }), /неизвестен/);
  await assert.rejects(newClip(dir, "Intro", { engine: "hyperframes", duration: 4 }), /латиница/);
});

test("a rendered clip is the version's own file; with alpha it is drawn transparent", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cutroom-version-"));
  await mkdir(path.join(dir, "clips"), { recursive: true });
  await writeFile(path.join(dir, "clips", "promo.webm"), "x");
  const resolved = resolveRef("clips/promo.webm", { versionDir: dir });
  assert.equal(resolved.file, path.join(dir, "clips", "promo.webm"));
  assert.match(resolveRef("clips/promo.webm", {}).error, /clips\//);
  const graphics = validateGraphics({ format: "cutroom-graphics-v1", overlays: [{ id: "promo", type: "video", start: 1, end: 3, props: { file: "clips/promo.webm" } }] }, { duration: 10, media: { videoId: 1, versionDir: dir } });
  assert.equal(graphics.overlays[0].props.transparent, true);
});

test("a clip is a scene of the agent, the author's video is not", () => {
  const clip = { id: "promo", type: "video", start: 1, end: 3, props: { file: "clips/promo.mp4" } };
  const author = { id: "broll", type: "video", start: 4, end: 6, props: { file: "assets/broll.mp4" } };
  const { problems } = reviewScenes({ graphics: { overlays: [clip, author] }, scenes: null, speech: [] });
  assert.match(problems[0], /Нет scenes.json.*promo/);
  assert.doesNotMatch(problems[0], /broll/);
});
