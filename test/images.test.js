import assert from "node:assert/strict";
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = path.join(root, "packs", "base", "illustrations", "1st-place-medal.png");

// A home with a signed-in Codex, and a fake `codex` that "generates" by copying a fixture to the asked path.
const home = await mkdtemp(path.join(tmpdir(), "cutroom-images-home-"));
await mkdir(path.join(home, ".codex"), { recursive: true });
await writeFile(path.join(home, ".codex", "auth.json"), "{}");
const bin = await mkdtemp(path.join(tmpdir(), "cutroom-images-bin-"));
await writeFile(path.join(bin, "codex"), `#!/bin/sh
for last; do :; done
printf '%s' "$last" > "$HOME/last-prompt.txt"
out=$(printf '%s' "$last" | sed -n 's/^Save the result as a PNG file at exactly this path: //p')
cp "${fixture}" "$out"
echo '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}'
`);
await chmod(path.join(bin, "codex"), 0o755);
process.env.HOME = home;
process.env.PATH = `${bin}:${process.env.PATH}`;
process.env.CUTROOM_DATA = await mkdtemp(path.join(tmpdir(), "cutroom-images-"));
await mkdir(path.join(process.env.CUTROOM_DATA, "db"), { recursive: true });

const { generateImage, imagePrompt, imagesSnapshot, listImages, setImageSettings } = await import("../src/images.js");
const { resolveRef } = await import("../src/library.js");
const { validateGraphics, graphicsMediaRefs } = await import("../src/graphics.js");
const { parseCodexModels } = await import("../src/agent.js");

test("the prompt carries the pack style and the hard rules", () => {
  const prompt = imagePrompt({ subject: "a server rack", style: "Fluent 3D", shape: "square", background: "transparent", output: "/x/a.png" });
  assert.match(prompt, /Subject: a server rack/);
  assert.match(prompt, /Style: Fluent 3D/);
  assert.match(prompt, /transparent/);
  assert.match(prompt, /No text, letters/);
  assert.match(prompt, /real, recognizable people/);
  assert.match(prompt, /exactly this path: \/x\/a\.png/);
});

test("generation is on by default while Codex is signed in, and has a limit", () => {
  const snapshot = imagesSnapshot();
  assert.equal(snapshot.codexSignedIn, true);
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.limit, 3);
  assert.throws(() => setImageSettings({ limit: 0 }), /Лимит/);
  assert.equal(setImageSettings({ limit: 2 }).limit, 2);
});

test("a generated picture lands in images/, counts towards the limit and can be redone twice", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cutroom-images-version-"));
  await assert.rejects(generateImage(dir, "Server", { prompt: "a server rack" }), /латиница/);
  await assert.rejects(generateImage(dir, "server", { prompt: "rack" }), /Опишите/);
  const entry = await generateImage(dir, "server", { prompt: "a server rack with lights" });
  assert.equal(entry.file, "images/server.png");
  assert.ok(entry.width > 0 && entry.height > 0);
  assert.deepEqual(await readFile(path.join(dir, "images", "server.png")), await readFile(fixture));
  // Without a pack in the version the neutral style is used.
  assert.match(await readFile(path.join(home, "last-prompt.txt"), "utf8"), /Style: Glossy 3D icon/);
  await assert.rejects(generateImage(dir, "server", { prompt: "a server rack with lights" }), /--again/);
  await generateImage(dir, "server", { prompt: "a taller server rack", again: true });
  await generateImage(dir, "server", { prompt: "a blue server rack", again: true });
  await assert.rejects(generateImage(dir, "server", { prompt: "one more server rack", again: true }), /перегенерировали/);
  await generateImage(dir, "tax-form", { prompt: "a blank paper form with a pen", background: "scene" });
  await assert.rejects(generateImage(dir, "cat", { prompt: "a cat at a laptop" }), /Лимит ролика — 2/);
  const images = await listImages(dir);
  assert.deepEqual(images.map((i) => i.name).sort(), ["server", "tax-form"]);
  assert.equal(images.find((i) => i.name === "server").redone, 2);
});

test("switched off, the agent is told to use the pack", async () => {
  setImageSettings({ enabled: false });
  const dir = await mkdtemp(path.join(tmpdir(), "cutroom-images-off-"));
  await assert.rejects(generateImage(dir, "server", { prompt: "a server rack" }), /выключена/);
  setImageSettings({ enabled: true });
});

test("a sticker can show a generated picture of the version", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cutroom-images-sticker-"));
  await mkdir(path.join(dir, "images"), { recursive: true });
  await cp(fixture, path.join(dir, "images", "server.png"));
  assert.equal(resolveRef("images/server.png", { versionDir: dir }).file, path.join(dir, "images", "server.png"));
  assert.match(resolveRef("images/server.png", {}).error, /images\//);
  const media = { videoId: 1, versionDir: dir };
  const graphics = validateGraphics({ format: "cutroom-graphics-v1", overlays: [{ id: "srv", type: "sticker", start: 1, end: 3, props: { file: "images/server.png" } }] }, { duration: 10, media });
  assert.deepEqual(graphicsMediaRefs(graphics), ["images/server.png"]);
  assert.throws(() => validateGraphics({ format: "cutroom-graphics-v1", overlays: [{ id: "x", type: "sticker", start: 1, end: 3, props: { file: "assets/x.png" } }] }, { duration: 10, media }), /images\/<имя>\.png/);
});

test("Codex models come from its catalog, hidden ones left out", () => {
  const models = parseCodexModels({ models: [
    { slug: "b", display_name: "B", priority: 2, visibility: "list", supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }], default_reasoning_level: "low" },
    { slug: "a", display_name: "A", priority: 1, visibility: "list", supported_reasoning_levels: [{ effort: "high" }, { effort: "weird" }] },
    { slug: "hidden", priority: 0, visibility: "hide" },
  ] });
  assert.deepEqual(models.map((m) => m.id), ["a", "b"]);
  assert.deepEqual(models[0].efforts, ["high"]);
  assert.deepEqual(models[1].efforts, ["low", "ultra"]);
  assert.equal(models[1].defaultEffort, "low");
});
