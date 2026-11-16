import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// A database and taste profile of their own, before the modules open them.
process.env.CUTROOM_DATA = await mkdtemp(path.join(tmpdir(), "cutroom-proposals-"));
await mkdir(path.join(process.env.CUTROOM_DATA, "db"), { recursive: true });
const { db, now } = await import("../src/db.js");
const { addEntry } = await import("../src/dictionary.js");
const { decideProposal, ingestRemember, parseRemember, PROFILE_SECTION, rememberFromReply, videoProposals } = await import("../src/proposals.js");
const { config } = await import("../src/config.js");

const video = (title) => Number(db.prepare("INSERT INTO videos (title, created_at, updated_at) VALUES (?, ?, ?)").run(title, now(), now()).lastInsertRowid);
const profile = () => readFile(path.join(config.paths.taste, "profile.md"), "utf8").catch(() => "");

test("remember.json items and the reply's «Предлагаю запомнить» section are read", () => {
  assert.deepEqual(parseRemember({ items: [{ text: "  «Сквозной предмет в графике»  ", reason: "v003" }, { text: "" }, "Без эмодзи"] }), [
    { text: "Сквозной предмет в графике", reason: "v003" },
    { text: "Без эмодзи", reason: null },
  ]);
  const reply = "## Звук\n- музыка\n\n## Предлагаю запомнить\n- «Графика держится на одном предмете».\n- Паузы перед выводом оставлять\n\n## Словарь\n- нет";
  assert.deepEqual(rememberFromReply(reply).map((i) => i.text), ["Графика держится на одном предмете", "Паузы перед выводом оставлять"]);
  assert.deepEqual(rememberFromReply("## Звук\n- музыка"), []);
});

test("a yes appends the line to the taste profile, a no only records the answer", async () => {
  const id = video("A");
  await mkdir(config.paths.taste, { recursive: true });
  await writeFile(path.join(config.paths.taste, "profile.md"), "## Монтаж\n\n- Темп плотный\n");
  const dir = await mkdtemp(path.join(tmpdir(), "cutroom-version-"));
  await writeFile(path.join(dir, "remember.json"), JSON.stringify({ format: "cutroom-remember-v1", items: [{ text: "Сквозной предмет в графике" }, { text: "Без эмодзи" }, { text: "Темп плотный" }] }));
  const added = await ingestRemember(dir, { videoId: id, version: 3 });
  assert.deepEqual(added.map((i) => i.text), ["Сквозной предмет в графике", "Без эмодзи"], "lines already in the profile are not proposed");

  const [first, second] = videoProposals(id).filter((p) => p.kind === "taste");
  assert.equal((await decideProposal(id, "taste", first.id, true)).status, "accepted");
  assert.equal((await decideProposal(id, "taste", second.id, false)).status, "rejected");
  await decideProposal(id, "taste", first.id, true);
  const text = await profile();
  assert.match(text, new RegExp(`${PROFILE_SECTION}\\n\\n- Сквозной предмет в графике\\n$`));
  assert.equal(text.split("Сквозной предмет").length, 2, "a repeated yes does not add the line twice");
  assert.doesNotMatch(text, /Без эмодзи/);

  // Answered once, the same line is not proposed again, in this video or another.
  assert.equal((await ingestRemember(dir, { videoId: video("B"), version: 1 })).length, 0);
  // Another video cannot answer this one's proposal.
  assert.equal(await decideProposal(video("C"), "taste", first.id, false), null);
});

test("dictionary proposals of a video are answered from its chat", async () => {
  const id = video("D");
  const shared = addEntry({ from: "не рассеть", to: "нейросеть", status: "proposed", source: "agent", version: 1, originVideoId: id });
  const local = addEntry({ from: "клод", to: "Claude", videoId: id, status: "proposed", source: "agent", version: 1 });
  const list = videoProposals(id).filter((p) => p.kind === "dictionary");
  assert.deepEqual(list.map((p) => [p.id, p.scope, p.status]), [[shared.id, "all", "proposed"], [local.id, "video", "proposed"]]);
  assert.equal((await decideProposal(id, "dictionary", shared.id, true)).status, "accepted");
  assert.equal((await decideProposal(id, "dictionary", local.id, false)).status, "rejected");
  assert.equal(db.prepare("SELECT status FROM dictionary WHERE id = ?").get(shared.id).status, "active");
  // The author's own entries are not the agent's proposals.
  const own = addEntry({ from: "гпт", to: "GPT", source: "author" });
  assert.equal(await decideProposal(id, "dictionary", own.id, false), null);
});
