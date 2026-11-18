import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.CUTROOM_DATA = await mkdtemp(path.join(tmpdir(), "cutroom-release-"));
await mkdir(path.join(process.env.CUTROOM_DATA, "db"), { recursive: true });

const { compareVersions, newestTag, parseImage, pauseQueue, queueCounts, queuePause, registryTags, resetVersionCache, resumeQueue, VERSION, versionInfo } = await import("../src/release.js");
const { db, enqueueJob, now } = await import("../src/db.js");

test("versions compare as numbers, only x.y.z tags count", () => {
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
  assert.equal(compareVersions("latest", "0.1.0"), -1);
  assert.equal(newestTag(["latest", "0.2.0", "0.10.1", "0.10.0", "0.11.0-rc1", "main"]), "0.10.1");
  assert.equal(newestTag(["latest"]), null);
});

test("an image reference names its registry; a local build has none", () => {
  assert.deepEqual(parseImage("ghcr.io/tomfordrumm/cutroom:latest"), { registry: "ghcr.io", repository: "tomfordrumm/cutroom", tag: "latest" });
  assert.deepEqual(parseImage("ghcr.io/tomfordrumm/cutroom"), { registry: "ghcr.io", repository: "tomfordrumm/cutroom", tag: "latest" });
  assert.deepEqual(parseImage("someone/cutroom:0.2.0"), { registry: "registry-1.docker.io", repository: "someone/cutroom", tag: "0.2.0" });
  assert.deepEqual(parseImage("localhost:5000/cutroom:1.0.0"), { registry: "localhost:5000", repository: "cutroom", tag: "1.0.0" });
  assert.equal(parseImage("cutroom:local"), null);
  assert.equal(parseImage(""), null);
});

/** A registry that wants an anonymous token first, like ghcr.io. */
function fakeRegistry(tags, calls = []) {
  return async (url, options = {}) => {
    calls.push(url);
    const json = (status, body, headers = {}) => ({ ok: status < 400, status, headers: new Headers(headers), json: async () => body });
    if (url.startsWith("https://ghcr.io/token")) {
      assert.match(url, /scope=repository%3Atomfordrumm%2Fcutroom%3Apull/);
      return json(200, { token: "anon" });
    }
    if (options.headers?.authorization !== "Bearer anon") {
      return json(401, {}, { "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:tomfordrumm/cutroom:pull"' });
    }
    return json(200, { name: "tomfordrumm/cutroom", tags });
  };
}

test("tags are read with the token the registry's challenge asks for", async () => {
  const calls = [];
  const tags = await registryTags(parseImage("ghcr.io/tomfordrumm/cutroom:latest"), { fetch: fakeRegistry(["0.1.0", "latest"], calls) });
  assert.deepEqual(tags, ["0.1.0", "latest"]);
  assert.equal(calls.length, 3);
});

test("a published install learns about a newer version; a local build does not ask", async () => {
  resetVersionCache();
  const published = { CUTROOM_IMAGE: "ghcr.io/tomfordrumm/cutroom:latest", CUTROOM_INSTALL_DIR: "/opt/cutroom" };
  const newer = await versionInfo({ env: published, fetch: fakeRegistry(["99.0.0", VERSION, "latest"]) });
  assert.equal(newer.source, "published");
  assert.equal(newer.latest, "99.0.0");
  assert.equal(newer.updateAvailable, true);
  assert.equal(newer.installDir, "/opt/cutroom");
  // Cached: no second request within the check interval.
  const cached = await versionInfo({ env: published, fetch: () => { throw new Error("asked again"); } });
  assert.equal(cached.latest, "99.0.0");
  const same = await versionInfo({ env: published, refresh: true, fetch: fakeRegistry([VERSION]) });
  assert.equal(same.updateAvailable, false);
  const down = await versionInfo({ env: published, refresh: true, fetch: async () => { throw new Error("сеть недоступна"); } });
  assert.equal(down.updateAvailable, false);
  assert.match(down.checkError, /сеть/);
  const local = await versionInfo({ env: { CUTROOM_IMAGE: "cutroom:local" }, fetch: () => { throw new Error("must not ask"); } });
  assert.equal(local.source, "local");
  assert.equal(local.latest, null);
  const off = await versionInfo({ env: { ...published, CUTROOM_UPDATE_CHECK: "off" }, refresh: true, fetch: () => { throw new Error("must not ask"); } });
  assert.equal(off.latest, null);
});

test("the update pause holds the queue until the new worker starts", () => {
  const video = Number(db.prepare("INSERT INTO videos (title, brief, stage, created_at, updated_at) VALUES ('x', '', 'draft', ?, ?)").run(now(), now()).lastInsertRowid);
  enqueueJob(video, "edit");
  assert.deepEqual(queueCounts(), { running: 0, queued: 1 });
  assert.equal(queuePause(), null);
  pauseQueue();
  assert.equal(queuePause().reason, "Обновление Cutroom");
  const status = JSON.parse(execFileSync(process.execPath, [path.join(root, "src", "admin.js"), "status"], { env: process.env, encoding: "utf8" }));
  assert.equal(status.queued, 1);
  assert.equal(status.paused.reason, "Обновление Cutroom");
  execFileSync(process.execPath, [path.join(root, "src", "admin.js"), "resume"], { env: process.env });
  assert.equal(queuePause(), null);
  pauseQueue("тест");
  resumeQueue();
  assert.equal(queuePause(), null);
});

test("an install gets compose.yml, update.sh and install.sh from inside the image", async () => {
  const dockerfile = await readFile(path.join(root, "Dockerfile"), "utf8");
  assert.match(dockerfile, /COPY compose\.yml update\.sh install\.sh \.env\.example \.\/release\//);
  const workflow = await readFile(path.join(root, ".github", "workflows", "release.yml"), "utf8");
  assert.match(workflow, /does not match package\.json/);
  assert.match(workflow, /linux\/amd64,linux\/arm64/);
  assert.match(await readFile(path.join(root, "orc.ref"), "utf8"), /^[0-9a-f]{40}\s*$/);
  for (const script of ["install.sh", "update.sh"]) execFileSync("bash", ["-n", path.join(root, script)]);
});
