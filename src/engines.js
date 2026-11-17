// Clip engines: other renderers the agent may use for a full-frame motion
// scene. The clip is rendered to a video file in the version (clips/<name>.mp4)
// and placed in the edit like any video insert; the cut, captions, layout and
// sound stay in Remotion.
//
//   hyperframes  HTML + GSAP compositions (HeyGen, Apache 2.0). Ships in the
//                image: the CLI is installed globally at a pinned version, its
//                agent skills live in /opt/cutroom/engines/hyperframes/skills.
//   onetake      motion films from one HTML composition with a move library
//                and a continuity oracle (PolyForm Noncommercial 1.0.0).
//                Never shipped by Cutroom: the author installs it from the
//                official repository in Settings, after reading the licence.
//                Commercial use needs onetake Pro, which the author buys and
//                uploads themselves.
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";
import { getSetting, now, setSetting } from "./db.js";

const run = promisify(execFile);

export const ENGINES_DIR = path.join(config.data, "engines");
const BROWSER = (() => {
  try { return readFileSync(path.join(config.root, ".browser-path"), "utf8").trim() || null; } catch { return null; }
})();

export const HYPERFRAMES = {
  id: "hyperframes",
  name: "HyperFrames",
  version: "0.9.34",
  license: "Apache 2.0",
  homepage: "https://hyperframes.heygen.com",
  skills: path.join(config.root, "engines", "hyperframes", "skills"),
};

export const ONETAKE = {
  id: "onetake",
  name: "onetake",
  repo: "feitangyuan/onetake",
  // Checked with Cutroom; the agent works against this exact revision.
  commit: "abb6d17279cdc749e27e99aa534a062d8fd01ced",
  license: "PolyForm Noncommercial 1.0.0",
  licenseUrl: "https://polyformproject.org/licenses/noncommercial/1.0.0",
  proUrl: "https://onetakemotion.com",
  python: ["playwright==1.52.0", "numpy==2.1.3", "scipy==1.14.1", "pillow==11.0.0", "matplotlib==3.9.2", "fonttools==4.55.0", "brotli==1.1.0"],
};

export const onetakeDir = () => path.join(ENGINES_DIR, "onetake");
const onetakeSource = () => path.join(onetakeDir(), "current");
const onetakePython = () => path.join(onetakeDir(), "venv", "bin", "python3");

/** Saved state: { hyperframes: { enabled }, onetake: { enabled, acceptedAt, edition, revision, installedAt, error } }. */
function stored() {
  const value = getSetting("clipEngines", null);
  return { hyperframes: { enabled: true, ...(value?.hyperframes ?? {}) }, onetake: { enabled: false, ...(value?.onetake ?? {}) } };
}
function save(id, patch) {
  const all = stored();
  all[id] = { ...all[id], ...patch };
  setSetting("clipEngines", all);
  return all[id];
}

let installing = null; // { step, startedAt } while onetake installs

export const hyperframesInstalled = () => existsSync(path.join(HYPERFRAMES.skills, "hyperframes", "SKILL.md"));
export const onetakeInstalled = () => existsSync(path.join(onetakeSource(), "SKILL.md")) && existsSync(onetakePython());

/** What Settings shows. */
export function enginesSnapshot() {
  const state = stored();
  return {
    engines: [
      { id: "hyperframes", name: HYPERFRAMES.name, version: HYPERFRAMES.version, license: HYPERFRAMES.license, homepage: HYPERFRAMES.homepage, bundled: true, installed: hyperframesInstalled(), enabled: state.hyperframes.enabled !== false && hyperframesInstalled() },
      {
        id: "onetake", name: ONETAKE.name, license: ONETAKE.license, licenseUrl: ONETAKE.licenseUrl, proUrl: ONETAKE.proUrl, homepage: `https://github.com/${ONETAKE.repo}`,
        bundled: false, installed: onetakeInstalled(), enabled: state.onetake.enabled === true && onetakeInstalled(),
        edition: state.onetake.edition ?? null, acceptedAt: state.onetake.acceptedAt ?? null, installedAt: state.onetake.installedAt ?? null,
        revision: state.onetake.revision ?? null, installing: installing ? { ...installing } : null, error: state.onetake.error ?? null,
      },
    ],
  };
}

/** Engines the agent may use in this version. */
export function enabledEngines() {
  return enginesSnapshot().engines.filter((e) => e.enabled).map((e) => e.id);
}

export function setEngineEnabled(id, enabled) {
  if (id === "hyperframes") return save("hyperframes", { enabled: Boolean(enabled) });
  if (id === "onetake") {
    if (enabled && !onetakeInstalled()) throw new Error("onetake не установлен.");
    return save("onetake", { enabled: Boolean(enabled) });
  }
  throw new Error("Нет такого движка.");
}

async function sh(command, args, { cwd, env, timeout = 30 * 60_000 } = {}) {
  try {
    return await run(command, args, { cwd, env: { ...process.env, ...env }, timeout, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const tail = String(error.stderr || error.stdout || error.message).trim().split("\n").slice(-6).join("\n");
    throw new Error(`${path.basename(command)} ${args.slice(0, 3).join(" ")}: ${tail}`);
  }
}

/**
 * Download onetake from its official repository at the pinned revision, make a
 * Python environment with its dependencies and Playwright's Chromium. Runs in
 * the background; enginesSnapshot() shows the step. `acceptLicense` must be
 * the author's explicit yes to the noncommercial terms.
 */
export function installOnetake({ acceptLicense }) {
  if (acceptLicense !== true) throw new Error("Нужно подтвердить условия лицензии onetake.");
  if (installing) throw new Error("onetake уже устанавливается.");
  save("onetake", { acceptedAt: now(), error: null });
  installing = { step: "Скачиваю onetake", startedAt: now() };
  (async () => {
    const dir = onetakeDir();
    await mkdir(dir, { recursive: true });
    const work = await mkdtemp(path.join(dir, ".install-"));
    try {
      const archive = path.join(work, "onetake.tar.gz");
      await sh("curl", ["-fsSL", "-o", archive, `https://codeload.github.com/${ONETAKE.repo}/tar.gz/${ONETAKE.commit}`], { timeout: 10 * 60_000 });
      await sh("tar", ["-xzf", archive, "-C", work]);
      const top = (await readdir(work, { withFileTypes: true })).find((e) => e.isDirectory() && e.name.startsWith("onetake"));
      if (!top || !existsSync(path.join(work, top.name, "SKILL.md"))) throw new Error("в архиве нет SKILL.md");
      // Films and gallery recordings are not needed to work: keep the engine light.
      for (const heavy of ["cases", "assets", "gallery/sheets"]) await rm(path.join(work, top.name, heavy), { recursive: true, force: true }).catch(() => {});
      installing.step = "Ставлю Python и библиотеки";
      if (!existsSync(onetakePython())) await sh("python3", ["-m", "venv", path.join(dir, "venv")]);
      await sh(onetakePython(), ["-m", "pip", "install", "--no-cache-dir", "--disable-pip-version-check", ...ONETAKE.python]);
      installing.step = "Скачиваю браузер для рендера";
      await sh(onetakePython(), ["-m", "playwright", "install", "chromium-headless-shell"], { env: { PLAYWRIGHT_BROWSERS_PATH: path.join(dir, "browsers") } });
      installing.step = "Проверяю";
      await rm(onetakeSource(), { recursive: true, force: true });
      await rename(path.join(work, top.name), onetakeSource());
      await sh(onetakePython(), ["-c", "import playwright, numpy, scipy, PIL, fontTools"]);
      await sh("node", [path.join(onetakeSource(), "scripts", "test_motion.js")], { cwd: onetakeSource() }).catch(() => null);
      save("onetake", { enabled: true, edition: stored().onetake.edition === "pro" ? "pro" : "free", revision: ONETAKE.commit.slice(0, 12), installedAt: now(), error: null });
    } catch (error) {
      save("onetake", { error: error.message.slice(0, 1000) });
    } finally {
      installing = null;
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  })();
  return enginesSnapshot();
}

/**
 * onetake Pro from the archive the author bought: its files go over the free
 * version (same layout: SKILL.md, lib/, scripts/…). The archive is not kept
 * and never leaves this installation.
 */
export async function installOnetakePro(zipPath) {
  if (!onetakeInstalled()) throw new Error("Сначала установите бесплатную версию onetake: Pro ставится поверх неё.");
  const work = await mkdtemp(path.join(onetakeDir(), ".pro-"));
  try {
    const listing = (await run("unzip", ["-Z1", zipPath], { maxBuffer: 16 * 1024 * 1024 })).stdout.split("\n").filter(Boolean);
    if (listing.some((name) => name.startsWith("/") || name.split("/").includes(".."))) throw new Error("Архив содержит пути за пределами onetake.");
    await run("unzip", ["-q", zipPath, "-d", work]);
    const roots = [];
    for (const entry of await readdir(work, { withFileTypes: true, recursive: true })) {
      if (entry.isFile() && entry.name === "SKILL.md") roots.push(entry.parentPath ?? entry.path);
    }
    const root = roots.sort((a, b) => a.length - b.length)[0];
    if (!root || !existsSync(path.join(root, "lib", "motion.js"))) throw new Error("Это не похоже на архив onetake Pro: нет SKILL.md и lib/motion.js.");
    await cp(root, onetakeSource(), { recursive: true, force: true });
    save("onetake", { edition: "pro", error: null, enabled: true });
    return enginesSnapshot();
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

export async function removeOnetake() {
  if (installing) throw new Error("onetake сейчас устанавливается.");
  await rm(onetakeDir(), { recursive: true, force: true });
  save("onetake", { enabled: false, edition: null, revision: null, installedAt: null, error: null });
  return enginesSnapshot();
}

/** Environment for engine commands: the browser, no telemetry, onetake's Python. */
export function engineEnv() {
  return {
    ...(BROWSER ? { HYPERFRAMES_BROWSER_PATH: BROWSER } : {}),
    HYPERFRAMES_NO_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
    HYPERFRAMES_NO_UPDATE_CHECK: "1",
    HYPERFRAMES_NO_AUTO_INSTALL: "1",
    HYPERFRAMES_SKIP_SKILLS: "1",
    ONETAKE: onetakeSource(),
    PLAYWRIGHT_BROWSERS_PATH: path.join(onetakeDir(), "browsers"),
    PATH: `${path.join(onetakeDir(), "venv", "bin")}:${process.env.PATH}`,
  };
}

/** Where an engine's own guide lives, for the agent. */
export const engineGuide = (id) => (id === "onetake" ? onetakeSource() : HYPERFRAMES.skills);

/** Run a command with the engines' environment; resolves { code, stdout, stderr }. Streams to the given writers. */
export function runEngine(command, args, { cwd, out = process.stdout, err = process.stderr, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...engineEnv() }, stdio: ["ignore", "pipe", "pipe"], signal });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; out?.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; err?.write(chunk); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

