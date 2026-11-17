// The agent is told not to read Cutroom's sources: everything it may import or
// write has to be in instructions/guide. These tests keep the guide in step
// with the code.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFile(path.join(root, ...parts), "utf8");

/** Names a module exports: functions, consts, types and `export { … }` lists. */
function exportsOf(source) {
  const names = new Set();
  for (const m of source.matchAll(/^export (?:async )?(?:function|const|type|let|class) ([A-Za-z_]\w*)/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^export (?:type )?\{([^}]*)\}(?! from)/gm)) for (const n of m[1].split(",")) if (n.trim()) names.add(n.trim().split(/\s+as\s+/).pop());
  return names;
}

test("every export of the cutroom module is described in the guide", async () => {
  const guide = (await read("instructions", "guide", "kit.md")) + (await read("instructions", "guide", "motion.md"));
  const api = await read("gfx", "src", "api.ts");
  const names = new Set();
  for (const file of ["layout.ts", "motion.ts", "moves.ts", "kit.tsx"]) for (const n of exportsOf(await read("gfx", "src", file))) names.add(n);
  for (const m of api.matchAll(/^export (?:type )?\{([^}]*)\} from/gm)) for (const n of m[1].split(",")) if (n.trim()) names.add(n.trim());
  const moves = (await read("gfx", "src", "moves.ts")).match(/export const moves = \{([^}]*)\}/)[1].split(",").map((n) => n.trim()).filter(Boolean);
  for (const n of moves) names.add(n);
  const missing = [...names].filter((n) => !guide.includes(`\`${n}`) && !guide.includes(`${n}(`));
  assert.deepEqual(missing, [], `нет в guide/kit.md и guide/motion.md: ${missing.join(", ")}`);
});

test("every built-in element and its type is in guide/elements.md", async () => {
  const elements = await read("instructions", "guide", "elements.md");
  const { OVERLAY_TYPES, AUDIO_TYPES } = await import("../src/graphics.js");
  const missing = [...OVERLAY_TYPES, ...AUDIO_TYPES].filter((t) => !elements.includes(`\`${t}\``));
  assert.deepEqual(missing, []);
});

test("AGENTS.md keeps rules, references live in guide", async () => {
  const agents = await read("instructions", "AGENTS.md");
  assert.ok(Buffer.byteLength(agents) < 44_000, `AGENTS.md ${Buffer.byteLength(agents)} байт: справочники — в guide/`);
  for (const name of ["elements.md", "kit.md", "motion.md", "storyboard.md", "clips.md", "images.md", "revisions.md"]) assert.match(agents, new RegExp(`guide/${name.replace(".", "\\.")}`));
  assert.match(agents, /\/opt\/cutroom/);
});
