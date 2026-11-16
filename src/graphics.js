// Motion graphics of a version: graphics.json (times in source seconds, so
// they survive a recut) drawn by the Remotion template in gfx/ over the cut.
//
//   graphics.json        theme, captions, overlays, audio — written by the agent
//   custom/<Name>.tsx    optional components written by the agent
//   graphics.placed.json overlays on program time (for the UI timeline)
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { config } from "./config.js";
import { exists, readJson, writeJson } from "./cut.js";
import { facesOnProgram } from "./faces.js";
import { versionPack } from "./packs.js";
import { CAPTIONS_DEFAULTS, validateCaptions, validateTheme } from "./theme.js";
import { MEDIA_MIME, resolveRef, versionVideoId } from "./library.js";
import { sourceRangeToProgram, sourceToProgram } from "./timeline.js";

export const GRAPHICS_FORMAT = "cutroom-graphics-v1";
export const OVERLAY_TYPES = ["title", "fullscreen", "list", "stat", "lowerThird", "callout", "zoom", "image", "video", "custom", "pack"];
export const AUDIO_TYPES = ["music", "sfx"];
// Linear volumes: the music bed under speech, the bed in pauses, a sound effect.
export const AUDIO_DEFAULTS = {
  // At 0.08 a mastered track sat about 10 dB under a talking-head voice in testing; 0.05 is 4 dB lower.
  music: { volume: 0.05, pauseVolume: 0.1, fadeIn: 0.5, fadeOut: 1.5, loop: true },
  sfx: { volume: 0.5, fadeIn: 0, fadeOut: 0.05 },
};
const TEMPLATE_SRC = path.join(config.root, "gfx", "src");
const NODE_MODULES = path.join(config.root, "node_modules");
const PYTHON = process.env.CUTROOM_PYTHON ?? "/opt/cutroom/py/bin/python3";
const VISION = path.join(config.root, "tools", "vision.py");
// Recorded at image build (Dockerfile); undefined lets Remotion find or fetch its own.
const BROWSER = (() => {
  try { return readFileSync(path.join(config.root, ".browser-path"), "utf8").trim() || undefined; } catch { return undefined; }
})();

export async function customComponents(dir) {
  const names = await readdir(path.join(dir, "custom")).catch(() => []);
  return names.filter((name) => /^[A-Za-z][\w-]*\.tsx$/.test(name)).map((name) => name.replace(/\.tsx$/, ""));
}

/** graphics.json of the version, or null. Throws on invalid JSON. */
export async function readGraphics(dir) {
  const file = path.join(dir, "graphics.json");
  if (!(await exists(file))) return null;
  try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { throw new Error(`graphics.json: неверный JSON (${error.message}).`); }
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** A file reference of graphics.json: problems are pushed, the resolved file returned. */
function checkFile(ref, kinds, where, problems, media) {
  if (typeof ref !== "string" || !ref.trim()) { problems.push(`${where}: нужен file — ссылка из media.md.`); return null; }
  if (!media) return { ref: ref.trim(), file: null };
  const resolved = resolveRef(ref, media);
  if (resolved.error) { problems.push(`${where}: ${resolved.error}.`); return null; }
  if (!kinds.includes(resolved.kind)) { problems.push(`${where}: «${resolved.ref}» — ${resolved.kind}, а нужен ${kinds.join(" или ")}.`); return null; }
  return resolved;
}

function validateAudio(list, { duration, problems, media, ids }) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { problems.push("audio должен быть массивом."); return []; }
  const result = [];
  list.forEach((a, i) => {
    const where = `audio[${i}]${a?.id ? ` (${a.id})` : ""}`;
    const id = typeof a?.id === "string" && a.id ? a.id : `a${i + 1}`;
    if (ids.has(id)) problems.push(`${where}: id ${id} повторяется.`);
    ids.add(id);
    if (!AUDIO_TYPES.includes(a?.type)) { problems.push(`${where}: type должен быть music или sfx.`); return; }
    const file = checkFile(a.file, ["audio"], where, problems, media);
    if (!file) return;
    const defaults = AUDIO_DEFAULTS[a.type];
    const level = (key, max = 1) => {
      if (a[key] === undefined) return defaults[key];
      if (!finite(a[key]) || a[key] < 0 || a[key] > max) { problems.push(`${where}: ${key} — число от 0 до ${max}.`); return defaults[key]; }
      return a[key];
    };
    const entry = { id, type: a.type, file: file.ref, volume: level("volume"), fadeIn: level("fadeIn", 10), fadeOut: level("fadeOut", 10), offset: level("offset", 36000) ?? 0 };
    if (a.type === "music") {
      const start = a.start === undefined ? 0 : Number(a.start);
      const end = a.end === undefined ? duration : Number(a.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start > duration) {
        problems.push(`${where}: start/end — секунды исходника, 0 ≤ start < end ≤ ${duration.toFixed(2)}; без них музыка идёт весь ролик.`);
        return;
      }
      Object.assign(entry, { start, end: Math.min(end, duration), pauseVolume: level("pauseVolume"), loop: a.loop === undefined ? defaults.loop : a.loop === true });
    } else {
      const at = Number(a.at);
      if (!Number.isFinite(at) || at < 0 || at > duration) { problems.push(`${where}: at — секунда исходника, где звучит эффект (0…${duration.toFixed(2)}).`); return; }
      if (a.duration !== undefined && (!finite(a.duration) || a.duration <= 0)) { problems.push(`${where}: duration — секунды, больше 0.`); return; }
      Object.assign(entry, { at, duration: a.duration ?? null });
    }
    result.push(entry);
  });
  return result;
}

/**
 * Normalized graphics or an Error listing every problem. `pack` is the
 * version's taste pack: its components (type "pack") and default captions.
 * `media` ({ videoId, versionDir }) resolves file references; without it they are not checked.
 */
export function validateGraphics(raw, { duration, custom = [], pack = null, media = null }) {
  const problems = [];
  if (raw?.format !== GRAPHICS_FORMAT) problems.push(`format должен быть "${GRAPHICS_FORMAT}".`);
  const theme = validateTheme(raw?.theme, problems, "theme");
  // No "captions" key: the pack's captions. null/false or style "off": none.
  let captions = null;
  if (raw?.captions === undefined) captions = pack?.captions ? { ...pack.captions } : null;
  else if (raw.captions && raw.captions !== false) captions = { ...CAPTIONS_DEFAULTS, ...(pack?.captions ?? {}), ...validateCaptions(raw.captions, problems, "captions") };
  if (captions?.style === "off") captions = null;
  const packComponents = pack?.components ?? [];
  const overlays = [];
  const ids = new Set();
  (Array.isArray(raw?.overlays) ? raw.overlays : raw?.overlays === undefined ? [] : (problems.push("overlays должен быть массивом."), [])).forEach((o, i) => {
    const where = `overlays[${i}]${o?.id ? ` (${o.id})` : ""}`;
    const id = typeof o?.id === "string" && o.id ? o.id : `o${i + 1}`;
    if (ids.has(id)) problems.push(`${where}: id ${id} повторяется.`);
    ids.add(id);
    if (!OVERLAY_TYPES.includes(o?.type)) { problems.push(`${where}: type должен быть одним из ${OVERLAY_TYPES.join(", ")}.`); return; }
    if (o.type === "custom" && !custom.includes(o.component)) {
      problems.push(`${where}: нет custom/${o.component ?? "?"}.tsx (есть: ${custom.join(", ") || "ничего"}).`);
      return;
    }
    if (o.type === "pack" && !packComponents.includes(o.component)) {
      problems.push(`${where}: в пакете вкуса нет компонента ${o.component ?? "?"} (есть: ${packComponents.join(", ") || "ничего"}).`);
      return;
    }
    const start = Number(o.start), end = Number(o.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start > duration) {
      problems.push(`${where}: start/end — секунды исходника, 0 ≤ start < end ≤ ${duration.toFixed(2)}.`);
      return;
    }
    if (o.props !== undefined && (typeof o.props !== "object" || Array.isArray(o.props))) { problems.push(`${where}: props должен быть объектом.`); return; }
    if (o.type === "image" || o.type === "video") {
      const file = checkFile(o.props?.file, [o.type], `${where}.props`, problems, media);
      if (!file) return;
      o = { ...o, props: { ...o.props, file: file.ref } };
    }
    overlays.push({ id, type: o.type, component: o.type === "custom" || o.type === "pack" ? o.component : undefined, start, end: Math.min(end, duration), props: o.props ?? {} });
  });
  const audio = validateAudio(raw?.audio, { duration, problems, media, ids });
  if (problems.length) throw new Error(`graphics.json не прошёл проверку:\n- ${problems.join("\n- ")}`);
  return { format: GRAPHICS_FORMAT, theme, captions, overlays, audio };
}

const label = (o) => String(o.props.text ?? o.props.title ?? o.props.value ?? (o.props.file ? path.basename(String(o.props.file)) : null) ?? o.component ?? o.type).slice(0, 60);

/** Files a graphics.json uses (references), for freezing into the version. */
export function graphicsMediaRefs(graphics) {
  return [
    ...graphics.overlays.filter((o) => o.type === "image" || o.type === "video").map((o) => o.props.file),
    ...(graphics.audio ?? []).map((a) => a.file),
  ];
}

/** Overlays on program time and frames; overlays lying wholly in cut parts are dropped with a warning. */
export function placeGraphics(graphics, timeline, fps) {
  const warnings = [];
  const overlays = graphics.overlays.flatMap((o) => {
    const range = sourceRangeToProgram(timeline.segments, o.start, o.end);
    if (!range) { warnings.push(`${o.id}: ${o.start}–${o.end} с исходника целиком вырезано, элемент не показан.`); return []; }
    const from = Math.round(range.start * fps), to = Math.round(range.end * fps);
    if (to - from < 3) { warnings.push(`${o.id}: после склейки остаётся меньше 0,1 с.`); return []; }
    return [{ ...o, from, to, programStart: range.start, programEnd: range.end, label: label(o) }];
  });
  // Music plays on without cuts from where its source interval begins; a sound effect sits on its source second.
  const total = Math.round(timeline.duration * fps);
  const audio = (graphics.audio ?? []).flatMap((a) => {
    if (a.type === "music") {
      const range = sourceRangeToProgram(timeline.segments, a.start, a.end);
      if (!range) { warnings.push(`${a.id}: музыка целиком в вырезанной части.`); return []; }
      return [{ ...a, from: Math.round(range.start * fps), to: Math.round(range.end * fps), programStart: range.start, programEnd: range.end }];
    }
    const at = sourceToProgram(timeline.segments, a.at);
    if (at === null) { warnings.push(`${a.id}: момент ${a.at} с исходника вырезан, эффект не звучит.`); return []; }
    const from = Math.round(at * fps);
    const to = a.duration ? Math.min(total, from + Math.max(1, Math.round(a.duration * fps))) : total;
    return to > from ? [{ ...a, from, to, programStart: at, programEnd: to / fps }] : [];
  });
  return { overlays, audio, warnings };
}

export const timelineFps = (timeline) => Math.round(timeline.frameRate.numerator / timeline.frameRate.denominator);

async function filesUnder(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) result.push(path.join(entry.parentPath ?? entry.path, entry.name));
  }
  return result.sort();
}

const fontFormat = (file) => ({ woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" })[path.extname(file).slice(1).toLowerCase()];

/** Write the version's pack into the bundle source: info.json, fonts.css, components/, fonts/. */
async function writePackSource(srcDir, pack) {
  const target = path.join(srcDir, "pack");
  if (!pack) return;
  for (const sub of ["components", "fonts", "assets"]) {
    if (await exists(path.join(pack.dir, sub))) await cp(path.join(pack.dir, sub), path.join(target, sub), { recursive: true });
  }
  await writeFile(path.join(target, "info.json"), JSON.stringify({
    id: pack.id, name: pack.name, version: pack.version, theme: pack.theme, captions: pack.captions, replaces: pack.replaces, fullFrame: pack.fullFrame,
    fonts: pack.fonts.map(({ family, weight, style }) => ({ family, weight, style })),
  }));
  await writeFile(path.join(target, "fonts.css"), pack.fonts.map((font) =>
    `@font-face { font-family: ${JSON.stringify(font.family)}; src: url(${JSON.stringify(`./${font.file}`)}) format("${fontFormat(font.file)}"); font-weight: ${font.weight}; font-style: ${font.style}; font-display: block;${font.unicodeRange ? ` unicode-range: ${font.unicodeRange};` : ""} }`).join("\n"));
}

/** Remotion bundle of the template plus this version's pack and custom components, cached by content. */
async function bundleFor(dir, onProgress = () => {}) {
  const gfxDir = path.join(dir, ".gfx");
  const bundleDir = path.join(gfxDir, "bundle");
  const hash = createHash("sha256");
  for (const file of await filesUnder(TEMPLATE_SRC)) hash.update(file).update(await readFile(file));
  const custom = await customComponents(dir);
  for (const name of custom) hash.update(name).update(await readFile(path.join(dir, "custom", `${name}.tsx`)));
  const pack = await versionPack(dir);
  if (pack) for (const file of await filesUnder(pack.dir)) hash.update(path.relative(pack.dir, file)).update(await readFile(file));
  const key = hash.digest("hex");
  const stampFile = path.join(gfxDir, "bundle.hash");
  if ((await exists(path.join(bundleDir, "index.html"))) && (await readFile(stampFile, "utf8").catch(() => "")) === key) return bundleDir;

  onProgress("Собираю графику");
  await rm(gfxDir, { recursive: true, force: true });
  await mkdir(gfxDir, { recursive: true });
  const srcDir = path.join(gfxDir, "src");
  await cp(TEMPLATE_SRC, srcDir, { recursive: true });
  for (const name of custom) await cp(path.join(dir, "custom", `${name}.tsx`), path.join(srcDir, "custom", `${name}.tsx`));
  await writePackSource(srcDir, pack);
  await bundle({
    entryPoint: path.join(srcDir, "index.tsx"),
    outDir: bundleDir,
    rootDir: gfxDir,
    enableCaching: false,
    webpackOverride: (webpackConfig) => ({
      ...webpackConfig,
      resolve: {
        ...webpackConfig.resolve,
        alias: { ...(webpackConfig.resolve?.alias ?? {}), cutroom$: path.join(srcDir, "api.ts") },
        modules: [...(webpackConfig.resolve?.modules ?? ["node_modules"]), NODE_MODULES],
      },
    }),
  });
  await writeFile(stampFile, key);
  return bundleDir;
}

/** Serve files over HTTP with Range support for the renderer's decoders: { name: path } → { urls, close }. */
async function serveFiles(files) {
  const names = Object.keys(files);
  const sizes = Object.fromEntries(await Promise.all(names.map(async (name) => [name, (await stat(files[name])).size])));
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname.slice(1));
    if (!Object.hasOwn(files, name)) { res.writeHead(404); res.end(); return; }
    const file = files[name];
    const size = sizes[name];
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    const headers = { "content-type": MEDIA_MIME[path.extname(file).toLowerCase()] ?? "video/mp4", "accept-ranges": "bytes" };
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, "content-length": size });
      createReadStream(file).pipe(res);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  return {
    urls: Object.fromEntries(names.map((name) => [name, base + encodeURIComponent(name)])),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Everything a render needs: validated graphics placed on the version's timeline. */
export async function prepareGraphics(dir, duration) {
  const raw = await readGraphics(dir);
  if (!raw) return null;
  const pack = await versionPack(dir);
  const media = { videoId: await versionVideoId(dir), versionDir: dir };
  const graphics = validateGraphics(raw, { duration, custom: await customComponents(dir), pack, media });
  const timeline = await readJson(path.join(dir, "timeline.json"));
  const fps = timelineFps(timeline);
  const { overlays, audio, warnings } = placeGraphics(graphics, timeline, fps);
  const mediaFiles = Object.fromEntries(graphicsMediaRefs(graphics).map((ref) => [ref, resolveRef(ref, media).file]));
  const faces = facesOnProgram(await readJson(path.join(dir, "faces.json")).catch(() => null), timeline.segments);
  await writeJson(path.join(dir, "graphics.placed.json"), {
    fps,
    warnings,
    overlays: overlays.map(({ id, type, component, label: text, programStart, programEnd, start, end }) => ({
      id, type, component, label: text, start: programStart, end: programEnd, sourceStart: start, sourceEnd: end,
    })),
    audio: audio.map(({ id, type, file, programStart, programEnd }) => ({ id, type, file, start: programStart, end: programEnd })),
  });
  return { graphics, timeline, fps, overlays, audio, warnings, faces, pack, mediaFiles };
}

function inputProps(prepared, { videoUrl, mediaUrls = {}, width, height, isolate = null }) {
  const { graphics, timeline, fps, overlays, faces, audio } = prepared;
  return {
    videoUrl,
    width,
    height,
    fps,
    durationInFrames: Math.max(1, Math.round(timeline.duration * fps)),
    theme: graphics.theme,
    captions: graphics.captions,
    words: timeline.words.map(({ start, end, text }) => ({ start, end, text })),
    overlays: overlays.map(({ id, type, component, from, to, props }) => ({ id, type, component, from, to, props: props.file ? { ...props, src: mediaUrls[props.file] } : props })),
    faces: faces.map(({ t, box }) => ({ t, box })),
    audio: audio.map(({ id, type, file, from, to, volume, pauseVolume, fadeIn, fadeOut, offset, loop }) => ({ id, type, src: mediaUrls[file], from, to, volume, pauseVolume, fadeIn, fadeOut, offset, loop })),
    isolate,
  };
}

async function withComposition(dir, prepared, baseVideo, size, onProgress, fn) {
  const serveUrl = await bundleFor(dir, onProgress);
  // The cut and every file graphics.json uses, under names the renderer can fetch.
  const server = await serveFiles({ "video.mp4": baseVideo, ...prepared.mediaFiles });
  try {
    const { "video.mp4": videoUrl, ...mediaUrls } = server.urls;
    const props = inputProps(prepared, { videoUrl, mediaUrls, ...size });
    const composition = await selectComposition({ serveUrl, id: "Cutroom", inputProps: props, logLevel: "error", browserExecutable: BROWSER });
    return await fn({ serveUrl, composition, props });
  } finally {
    await server.close();
  }
}

/** Many stills with one browser. `still(frame, output, isolate)` renders one PNG. */
async function withStills(dir, prepared, size, onProgress, fn) {
  return withComposition(dir, prepared, path.join(dir, "out", "cut.mp4"), size, onProgress, async ({ serveUrl, composition, props }) => {
    const browser = await openBrowser("chrome", { browserExecutable: BROWSER, logLevel: "error" });
    try {
      // The component receives composition.props, so the layer to isolate goes there too.
      const still = (frame, output, isolate = null) => renderStill({
        composition: { ...composition, props: { ...composition.props, isolate } },
        serveUrl, output, imageFormat: "png", logLevel: "error", browserExecutable: BROWSER, puppeteerInstance: browser,
        frame: Math.min(composition.durationInFrames - 1, Math.max(0, frame)),
        inputProps: { ...props, isolate },
      });
      return await fn({ still, composition });
    } finally {
      await browser.close({ silent: true }).catch(() => {});
    }
  });
}

/** PNG frames at program seconds, over out/cut.mp4. Returns the written paths. */
export async function renderStills(dir, seconds, { duration, size, onProgress } = {}) {
  const prepared = await prepareGraphics(dir, duration);
  if (!prepared) throw new Error("Нет graphics.json.");
  const framesDir = path.join(dir, "frames");
  await mkdir(framesDir, { recursive: true });
  return withStills(dir, prepared, size, onProgress, async ({ still }) => {
    const written = [];
    for (const t of seconds) {
      const output = path.join(framesDir, `gfx-${t.toFixed(2)}.png`);
      await still(Math.round(t * prepared.fps), output);
      written.push(output);
    }
    return { written, warnings: prepared.warnings };
  });
}

// ---------- layout review ----------------------------------------------------

/** Same insets as gfx/src/layout.ts safeArea. */
export function safeArea(width, height) {
  if (height > width * 1.2) return { top: height * 0.13, bottom: height * 0.198, left: width * 0.111, right: width * 0.111 };
  if (width > height * 1.2) return { top: height * 0.05, bottom: height * 0.05, left: width * 0.05, right: width * 0.05 };
  return { top: height * 0.06, bottom: height * 0.06, left: width * 0.06, right: width * 0.06 };
}

function zoomFor(prepared, frame) {
  const zoom = prepared.overlays.find((o) => o.type === "zoom" && frame >= o.from && frame < o.to);
  if (!zoom) return { scale: 1, x: 0.5, y: 0.5 };
  const target = typeof zoom.props.scale === "number" ? zoom.props.scale : 1.15;
  const ease = Math.min(10, Math.floor((zoom.to - zoom.from) / 3));
  const k = Math.max(0, Math.min(1, (frame - zoom.from) / Math.max(1, ease), (zoom.to - frame) / Math.max(1, ease)));
  return { scale: 1 + (target - 1) * k, x: typeof zoom.props.x === "number" ? zoom.props.x : 0.5, y: typeof zoom.props.y === "number" ? zoom.props.y : 0.4 };
}

/** Face box in pixels at a program frame (nearest sample within 0.4 s), zoom applied. */
function faceBox(prepared, frame, { width, height }) {
  const t = frame / prepared.fps;
  let best = null;
  for (const sample of prepared.faces) if (Math.abs(sample.t - t) < 0.4 && (!best || Math.abs(sample.t - t) < Math.abs(best.t - t))) best = sample;
  if (!best?.box) return null;
  const zoom = zoomFor(prepared, frame);
  const ox = zoom.x * width, oy = zoom.y * height;
  const [x, y, w, h] = best.box;
  const x0 = ox + (x * width - ox) * zoom.scale, y0 = oy + (y * height - oy) * zoom.scale;
  return [x0, y0, x0 + w * width * zoom.scale, y0 + h * height * zoom.scale];
}

/** A graphic meant to cover the whole frame: built-in fullscreen, a pack's full-frame component or props.fullFrame. */
export const isFullFrame = (o, pack) => o.type === "fullscreen" || o.props?.fullFrame === true
  || ((o.type === "image" || o.type === "video") && (o.props?.position ?? "full") === "full")
  || (o.type === "pack" && (pack?.fullFrame ?? []).includes(o.component))
  || (pack?.replaces?.[o.type] && (pack?.fullFrame ?? []).includes(pack.replaces[o.type]));

const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const intersect = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];

async function measure(files) {
  const { stdout } = await promisify(execFile)(PYTHON, [VISION, "bbox", ...files], { maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout).map((item) => item?.box ?? null);
}

/**
 * Check where every graphic actually lands: render it alone on a transparent
 * frame, measure it, and compare with the face, the captions and the platform
 * safe zone. Also renders a contact sheet of the graphics over the video.
 */
export async function reviewGraphics(dir, { duration, size, onProgress = () => {} }) {
  const prepared = await prepareGraphics(dir, duration);
  if (!prepared) throw new Error("Нет graphics.json.");
  const { width, height } = size;
  const u = Math.min(width, height) / 1080;
  const safe = safeArea(width, height);
  const work = path.join(dir, "frames", "review");
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const checked = prepared.overlays.filter((o) => o.type !== "zoom");
  const report = { checkedAt: new Date().toISOString(), size, faces: prepared.faces.length > 0, overlays: [], sheets: [] };

  await withStills(dir, prepared, size, onProgress, async ({ still }) => {
    let n = 0;
    for (const o of checked) {
      const length = o.to - o.from;
      const frames = [...new Set([o.from + Math.round(length * 0.35), o.to - Math.max(6, Math.round(length * 0.15))])].filter((f) => f > o.from && f < o.to);
      if (!frames.length) frames.push(o.from + Math.floor(length / 2));
      const entry = { id: o.id, type: o.type, component: o.component ?? null, samples: [] };
      for (const frame of frames) {
        const base = path.join(work, `${o.id}-${frame}`);
        onProgress(`Проверяю ${o.id}`);
        await still(frame, `${base}-layer.png`, { layer: "overlay", id: o.id });
        if (prepared.graphics.captions) await still(frame, `${base}-captions.png`, { layer: "captions" });
        const [box, captions] = await measure([`${base}-layer.png`, ...(prepared.graphics.captions ? [`${base}-captions.png`] : [])]);
        const face = faceBox(prepared, frame, size);
        const problems = [];
        let status = "pass";
        const fail = (text) => { problems.push(text); status = "fail"; };
        const warn = (text) => { problems.push(text); if (status === "pass") status = "warn"; };
        if (!box) warn("элемент не виден в этом кадре");
        else if (area(box) > width * height * 0.8) {
          if (!isFullFrame(o, prepared.pack) && o.props.hideCaptions !== true) warn("элемент на весь кадр: закрывает автора, субтитры поверх — так задумано?");
        } else {
          const underFull = prepared.overlays.some((x) => x !== o && isFullFrame(x, prepared.pack) && frame >= x.from && frame < x.to);
          if (underFull) { /* a full-frame graphic hides the presenter here */ }
          else if (face) {
            const covered = area(intersect(box, face)) / Math.max(1, area(face));
            if (covered > 0.04) fail(`закрывает лицо на ${Math.round(covered * 100)}%`);
          } else if (prepared.faces.length) warn("лицо в этот момент не найдено — проверь кадр глазами");
          if (captions && area(intersect(box, [captions[0] - 8 * u, captions[1] - 8 * u, captions[2] + 8 * u, captions[3] + 8 * u])) > 0) fail("наезжает на субтитры");
          const out = [];
          const slack = 12 * u;
          if (box[1] < safe.top - slack) out.push("сверху");
          if (box[3] > height - safe.bottom + slack) out.push("снизу");
          if (box[0] < safe.left - slack) out.push("слева");
          if (box[2] > width - safe.right + slack) out.push("справа");
          if (out.length) warn(`выходит за безопасную зону площадки ${out.join(", ")}`);
        }
        entry.samples.push({ seconds: Math.round((frame / prepared.fps) * 100) / 100, status, problems, box, face: face?.map(Math.round) ?? null, captions });
      }
      entry.status = entry.samples.some((s) => s.status === "fail") ? "fail" : entry.samples.some((s) => s.status === "warn") ? "warn" : "pass";
      n += 1;
      entry.still = `frames/review/full-${String(n).padStart(2, "0")}.png`;
      await still(o.from + Math.round(length * 0.5), path.join(dir, entry.still));
      report.overlays.push(entry);
    }
  });

  if (report.overlays.length) {
    const portrait = height > width;
    const cols = Math.min(portrait ? 4 : 2, report.overlays.length);
    const rows = Math.min(3, Math.ceil(report.overlays.length / cols));
    const sheet = path.join(dir, "frames", "review-sheet-%d.jpg");
    await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(work, "full-%02d.png"),
      "-vf", `scale=${portrait ? -2 : 640}:${portrait ? 640 : -2},tile=${cols}x${rows}:padding=12:margin=12:color=white`, "-q:v", "3", sheet]);
    report.sheets = (await readdir(path.join(dir, "frames"))).filter((name) => /^review-sheet-\d+\.jpg$/.test(name)).sort().map((name) => `frames/${name}`);
  }
  report.status = report.overlays.some((o) => o.status === "fail") ? "fail" : report.overlays.some((o) => o.status === "warn") ? "warn" : "pass";
  await writeJson(path.join(dir, "gfx-review.json"), report);
  return report;
}

/** The cut with graphics as MP4. `baseVideo` is the cut at the output size. */
export async function renderGraphicsVideo(dir, { baseVideo, outPath, size, duration, signal, onProgress = () => {} }) {
  const prepared = await prepareGraphics(dir, duration);
  if (!prepared) throw new Error("Нет graphics.json.");
  const partial = path.join(path.dirname(outPath), `.${path.basename(outPath)}.partial.mp4`);
  const cancel = makeCancelSignal();
  const abort = () => cancel.cancel();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await withComposition(dir, prepared, baseVideo, size, onProgress, ({ serveUrl, composition, props }) => renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      crf: 20,
      outputLocation: partial,
      inputProps: props,
      cancelSignal: cancel.cancelSignal,
      logLevel: "error",
      browserExecutable: BROWSER,
      onProgress: ({ progress }) => onProgress("Рендер графики", Math.round(progress * 100)),
    }));
    await rename(partial, outPath);
    return { warnings: prepared.warnings, overlays: prepared.overlays.length };
  } finally {
    signal?.removeEventListener("abort", abort);
    await unlink(partial).catch(() => {});
  }
}
