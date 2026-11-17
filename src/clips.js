// Clips: full-frame motion scenes made on another engine and placed in the
// edit as a video insert. Each lives in the version folder:
//
//   clips/<name>/            the engine's project (HyperFrames: index.html;
//                            onetake: comp.html with motion.js and ui_kit.js)
//   clips/<name>/clip.json   engine, size, fps, duration
//   clips/<name>.mp4         the render; .webm when rendered with alpha
//
// graphics.json places it like the author's video: { "type": "video",
// "props": { "file": "clips/<name>.mp4" } }. Clips render at the final size
// (short side 1080), so the preview and the final use the same file.
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { exists, readJson, shortSideResolution } from "./cut.js";
import { enabledEngines, engineGuide, onetakeDir, runEngine } from "./engines.js";
import { versionPack } from "./packs.js";

export const CLIP_NAME = /^[a-z][a-z0-9-]{0,39}$/;
const MIN_SECONDS = 0.5;
const MAX_SECONDS = 60;

export const clipDir = (dir, name) => path.join(dir, "clips", name);

async function clipInfo(dir, name) {
  if (!CLIP_NAME.test(name)) throw new Error("Имя клипа: латиница в нижнем регистре, цифры и дефис, например intro или chat-demo.");
  const file = path.join(clipDir(dir, name), "clip.json");
  if (!(await exists(file))) throw new Error(`Нет клипа ${name}: сначала cutroom clip new ${name} --engine … --duration …`);
  return readJson(file);
}

/** Frame size and rate of the version's final render. */
async function finalFormat(dir) {
  const context = await readJson(path.join(dir, "context.json"));
  const size = shortSideResolution(context.media);
  const timeline = await readJson(path.join(dir, "timeline.json")).catch(() => null);
  const fps = timeline ? Math.round(timeline.frameRate.numerator / timeline.frameRate.denominator) : 30;
  return { width: size.width, height: size.height, fps: [24, 25, 30, 50, 60].includes(fps) ? fps : 30 };
}

const cssVar = (key) => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const FONT_FORMAT = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };

/**
 * The video's look inside the clip: the pack's fonts beside it and look.css
 * with @font-face rules and the theme as CSS variables (--background,
 * --accent, --display-font…), so the clip matches the rest of the graphics.
 */
async function writeLook(dir, target) {
  const pack = await versionPack(dir);
  const raw = await readJson(path.join(dir, "graphics.json")).catch(() => ({}));
  const lookId = raw?.look && pack?.looks?.[raw.look] ? raw.look : pack?.defaultLook ?? null;
  const theme = { ...(pack?.theme ?? {}), ...(lookId ? pack.looks[lookId].theme : {}), ...(raw?.theme ?? {}) };
  const faces = [];
  for (const font of pack?.fonts ?? []) {
    await mkdir(path.join(target, "fonts"), { recursive: true });
    await copyFile(path.join(pack.dir, font.file), path.join(target, "fonts", path.basename(font.file)));
    const ext = path.extname(font.file).slice(1).toLowerCase();
    faces.push(`@font-face { font-family: ${JSON.stringify(font.family)}; src: url("fonts/${path.basename(font.file)}") format("${FONT_FORMAT[ext]}"); font-weight: ${font.weight}; font-style: ${font.style};${font.unicodeRange ? ` unicode-range: ${font.unicodeRange};` : ""} }`);
  }
  // Inter Variable comes with Cutroom's own template, not with the pack: give the clip its file too.
  if (Object.values(theme).includes("Inter Variable")) {
    const files = path.join(config.root, "node_modules", "@fontsource-variable", "inter", "files");
    for (const [subset, range] of [["cyrillic", "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"], ["latin", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"]]) {
      const name = `inter-${subset}-wght-normal.woff2`;
      if (!existsSync(path.join(files, name))) continue;
      await mkdir(path.join(target, "fonts"), { recursive: true });
      await copyFile(path.join(files, name), path.join(target, "fonts", name));
      faces.push(`@font-face { font-family: "Inter Variable"; src: url("fonts/${name}") format("woff2"); font-weight: 100 900; font-style: normal; unicode-range: ${range}; }`);
    }
  }
  const vars = Object.entries(theme).map(([key, value]) => `  ${cssVar(key)}: ${typeof value === "number" ? `${value}px` : /Font$|^font$/.test(key) ? `"${value}", sans-serif` : value};`);
  await writeFile(path.join(target, "look.css"), [
    `/* The video's look${lookId ? ` «${lookId}»` : ""} from the taste pack: fonts and colours. Written by cutroom clip new. */`,
    ...faces,
    ":root {",
    ...vars,
    "}",
    "",
  ].join("\n"));
  return lookId;
}

const linkLook = (html) => (html.includes("look.css") ? html : html.replace(/<head>/i, '<head>\n    <link rel="stylesheet" href="look.css" />'));

const resolutionPreset = ({ width, height }) => (height > width * 1.2 ? "portrait" : width > height * 1.2 ? "landscape" : "square");

/** A new clip project from the engine's own starting point. */
export async function newClip(dir, name, { engine, duration }) {
  if (!CLIP_NAME.test(name)) throw new Error("Имя клипа: латиница в нижнем регистре, цифры и дефис, например intro или chat-demo.");
  const enabled = enabledEngines();
  if (!enabled.includes(engine)) throw new Error(`Движок ${engine} ${["hyperframes", "onetake"].includes(engine) ? "выключен или не установлен в этом Cutroom" : "неизвестен"}. Доступны: ${enabled.join(", ") || "ничего"}.`);
  const seconds = Number(duration);
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) throw new Error(`--duration: секунды от ${MIN_SECONDS} до ${MAX_SECONDS} — сколько клип идёт в склейке.`);
  const target = clipDir(dir, name);
  if (await exists(target)) throw new Error(`Клип ${name} уже есть: правь его файлы или выбери другое имя.`);
  const format = await finalFormat(dir);
  await mkdir(path.dirname(target), { recursive: true });

  if (engine === "hyperframes") {
    const result = await runEngine("hyperframes", ["init", name, "--example", "blank", "--resolution", resolutionPreset(format), "--non-interactive", "--skip-skills"], { cwd: path.dirname(target), out: null, err: null });
    if (result.code !== 0 || !(await exists(path.join(target, "index.html")))) throw new Error(`hyperframes init: ${(result.stderr || result.stdout).trim().split("\n").slice(-4).join("\n")}`);
    const html = await readFile(path.join(target, "index.html"), "utf8");
    await writeFile(path.join(target, "index.html"), linkLook(html)
      .replaceAll(/data-duration="[\d.]+"/g, `data-duration="${seconds}"`)
      .replace(/data-width="\d+"/, `data-width="${format.width}"`).replace(/data-height="\d+"/, `data-height="${format.height}"`));
    // The engine's own agent notes would point at commands Cutroom runs for the agent.
    await rm(path.join(target, "AGENTS.md"), { force: true });
    await rm(path.join(target, "CLAUDE.md"), { force: true });
  } else {
    const source = path.join(onetakeDir(), "current");
    await mkdir(target, { recursive: true });
    await copyFile(path.join(source, "templates", "comp.html"), path.join(target, "comp.html"));
    for (const lib of ["motion.js", "ui_kit.js"]) await copyFile(path.join(source, "lib", lib), path.join(target, lib));
    // The template loads ../../lib/motion.js in its own repository; here the library sits beside it.
    const html = await readFile(path.join(target, "comp.html"), "utf8");
    await writeFile(path.join(target, "comp.html"), linkLook(html).replaceAll(/(["'])(?:\.\.\/)+lib\/(motion|ui_kit)\.js\1/g, "$1$2.js$1"));
  }
  const look = await writeLook(dir, target);
  const info = { engine, duration: seconds, ...format, look, createdAt: new Date().toISOString() };
  await writeFile(path.join(target, "clip.json"), `${JSON.stringify(info, null, 2)}\n`);
  return { name, dir: target, ...info, guide: engineGuide(engine) };
}

/** Rewrite look.css after the video's look changed (graphics.json → look). */
export async function refreshLook(dir, name) {
  await clipInfo(dir, name);
  return writeLook(dir, clipDir(dir, name));
}

/** Every clip of the version with its render. */
export async function listClips(dir) {
  const root = path.join(dir, "clips");
  const names = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && CLIP_NAME.test(e.name)).map((e) => e.name).sort();
  const result = [];
  for (const name of names) {
    const info = await readJson(path.join(root, name, "clip.json")).catch(() => null);
    if (!info) continue;
    const rendered = ["mp4", "webm"].map((ext) => `clips/${name}.${ext}`).filter((ref) => existsSync(path.join(dir, ref)));
    result.push({ name, ...info, rendered });
  }
  return result;
}

const entry = (info) => (info.engine === "hyperframes" ? "index.html" : "comp.html");

/** The engine's own check of the composition. */
export async function checkClip(dir, name, io) {
  const info = await clipInfo(dir, name);
  const cwd = clipDir(dir, name);
  if (info.engine === "hyperframes") return runEngine("hyperframes", ["check"], { cwd, ...io });
  // onetake reads the composition itself: what carries each boundary and each move's curve.
  return runEngine("python3", [path.join(onetakeDir(), "current", "scripts", "probe.py"), entry(info)], { cwd, ...io });
}

/** PNG frames of the clip at its own seconds → clips/<name>/stills/. */
export async function clipStills(dir, name, times, io) {
  const info = await clipInfo(dir, name);
  const cwd = clipDir(dir, name);
  const list = times.map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t <= info.duration);
  if (!list.length) throw new Error(`Укажите секунды клипа от 0 до ${info.duration}.`);
  await mkdir(path.join(cwd, "stills"), { recursive: true });
  if (info.engine === "hyperframes") return runEngine("hyperframes", ["snapshot", "--at", list.join(","), "--output", "stills", "--no-end"], { cwd, ...io });
  return runEngine("python3", [path.join(onetakeDir(), "current", "scripts", "stills.py"), entry(info), "--times", list.join(","), "--out", "stills/sheet.png", "--width", String(info.width), "--height", String(info.height)], { cwd, ...io });
}

/**
 * Render the clip at the final size → clips/<name>.mp4 (or .webm with alpha,
 * HyperFrames only: a graphic over the presenter instead of a full frame).
 */
export async function renderClip(dir, name, { alpha = false, ...io } = {}) {
  const info = await clipInfo(dir, name);
  const cwd = clipDir(dir, name);
  if (alpha && info.engine !== "hyperframes") throw new Error("Прозрачный фон умеет только HyperFrames; клип onetake — на весь кадр.");
  const out = path.join(dir, "clips", `${name}.${alpha ? "webm" : "mp4"}`);
  await rm(path.join(dir, "clips", `${name}.${alpha ? "mp4" : "webm"}`), { force: true });
  const result = info.engine === "hyperframes"
    ? await runEngine("hyperframes", ["render", "-o", out, "--quality", "looks", "--fps", String(info.fps), "--workers", "2", ...(alpha ? ["--format", "webm"] : [])], { cwd, ...io })
    : await runEngine("python3", [path.join(onetakeDir(), "current", "scripts", "render.py"), entry(info), "--out", out, "--width", String(info.width), "--height", String(info.height), "--fps", String(info.fps), "--dur", String(info.duration), "--workers", "2"], { cwd, ...io });
  if (result.code !== 0 || !(await exists(out))) throw new Error(`Рендер клипа ${name} не удался (код ${result.code}).`);
  return { file: path.relative(dir, out), ...info };
}

/** Any command of the engine in the clip's folder, with the engines' environment (paths, browser, no telemetry). */
export async function runInClip(dir, name, command, io) {
  await clipInfo(dir, name);
  if (!command.length) throw new Error("Укажите команду после --.");
  return runEngine(command[0], command.slice(1), { cwd: clipDir(dir, name), ...io });
}
