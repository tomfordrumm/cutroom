// Taste packs: the look and taste of the edit, on top of the core mechanics.
//
//   <pack>/pack.json            manifest: id, version, theme, captions, fonts, replaced built-ins
//   <pack>/instructions/*.md    taste rules for the editing agent (README.md first)
//   <pack>/components/*.tsx     Remotion components: type "pack" or replacements of built-ins
//   <pack>/fonts/*              font files listed in pack.json
//   <pack>/assets/*             images the components import ("../assets/x.png")
//   <pack>/illustrations.json   ready pictures of things and characters, by id
//                               (files in illustrations/ or assets/), drawn by the
//                               built-in "sticker" and <Illustration> in components
//   <pack>/examples/*           reference stills for the agent (optional)
//
// Built-in packs ship in the image (packs/), installed ones live in /data/packs.
// A version keeps a snapshot of its pack in <version>/pack, so re-renders and
// the final cut do not change when a pack is updated or removed.
import { execFile } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "./config.js";
import { CAPTIONS_DEFAULTS, validateCaptions, validateTheme } from "./theme.js";

export const PACK_FORMAT = "cutroom-pack-v1";
/** Version of the pack API this core provides (components, layout hooks, manifest). */
export const PACK_API = 1;
export const DEFAULT_PACK = "base";
const REPLACEABLE = ["title", "fullscreen", "list", "stat", "lowerThird", "callout", "captions"];
const ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const COMPONENT = /^[A-Z][A-Za-z0-9]{0,47}$/;
const MAX_PACK_BYTES = 200 * 1024 * 1024;
const FONT_FILE = /\.(woff2?|ttf|otf)$/i;
const LOOK_ID = /^[a-z][a-z0-9-]{0,23}$/;
const ILLUSTRATION_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const IMAGE_FILE = /^(illustrations|assets)\/[^\0]+\.(png|webp|jpe?g)$/i;
export const ILLUSTRATIONS_FORMAT = "cutroom-illustrations-v1";

/** Pixel size of a PNG, JPEG or WebP from its header; null if unknown. */
export async function imageSize(file) {
  const data = await readFile(file).catch(() => null);
  if (!data) return null;
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  if (data.length > 30 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    const chunk = data.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { width: 1 + data.readUIntLE(24, 3), height: 1 + data.readUIntLE(27, 3) };
    if (chunk === "VP8 ") return { width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") { const b = data.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    for (let i = 2; i + 9 < data.length;) {
      if (data[i] !== 0xff) { i++; continue; }
      const marker = data[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: data.readUInt16BE(i + 7), height: data.readUInt16BE(i + 5) };
      i += 2 + data.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** Named looks of a pack: { id: { name, theme } }; the default one first. */
function readLooks(manifest, problems) {
  const looks = {};
  if (manifest.looks === undefined) return { looks, defaultLook: null };
  if (!manifest.looks || typeof manifest.looks !== "object" || Array.isArray(manifest.looks)) { problems.push("looks: объект { id: { name, theme } }."); return { looks, defaultLook: null }; }
  for (const [id, look] of Object.entries(manifest.looks)) {
    if (!LOOK_ID.test(id)) { problems.push(`looks.${id}: id латиницей в нижнем регистре, до 24 символов.`); continue; }
    if (typeof look?.name !== "string" || !look.name.trim()) { problems.push(`looks.${id}.name: название стиля.`); continue; }
    looks[id] = { name: look.name.trim(), description: String(look.description ?? "").trim(), theme: validateTheme(look.theme, problems, `looks.${id}.theme`) };
  }
  const ids = Object.keys(looks);
  let defaultLook = manifest.defaultLook ?? ids[0] ?? null;
  if (defaultLook !== null && !looks[defaultLook]) { problems.push(`defaultLook: нет стиля «${defaultLook}» (есть ${ids.join(", ")}).`); defaultLook = ids[0] ?? null; }
  return { looks, defaultLook };
}

/** illustrations.json: ready pictures, each with an id, a file and what it shows. */
async function readIllustrations(dir, problems) {
  let raw;
  try { raw = JSON.parse(await readFile(path.join(dir, "illustrations.json"), "utf8")); } catch (error) {
    if (error.code === "ENOENT") return [];
    problems.push(`illustrations.json не читается: ${error.message}`);
    return [];
  }
  if (raw?.format !== ILLUSTRATIONS_FORMAT || !Array.isArray(raw.items)) { problems.push(`illustrations.json: format "${ILLUSTRATIONS_FORMAT}" и массив items.`); return []; }
  const result = [];
  const ids = new Set();
  for (const [i, item] of raw.items.entries()) {
    const where = `illustrations.json items[${i}]${item?.id ? ` (${item.id})` : ""}`;
    if (!ILLUSTRATION_ID.test(String(item?.id ?? ""))) { problems.push(`${where}: id латиницей в нижнем регистре, цифры и дефис.`); continue; }
    if (ids.has(item.id)) { problems.push(`${where}: id повторяется.`); continue; }
    const file = String(item.file ?? "");
    if (!IMAGE_FILE.test(file) || file.includes("..")) { problems.push(`${where}: file — png, webp или jpg в illustrations/ или assets/.`); continue; }
    const size = Number(item.width) > 0 && Number(item.height) > 0 ? { width: Number(item.width), height: Number(item.height) } : await imageSize(path.join(dir, file));
    if (!size) { problems.push(`${where}: нет файла ${file} или не удаётся прочитать размер.`); continue; }
    if (typeof item.description !== "string" || !item.description.trim()) { problems.push(`${where}: description — что изображено, для агента.`); continue; }
    ids.add(item.id);
    const anchor = item.anchor && Number.isFinite(Number(item.anchor.x)) && Number.isFinite(Number(item.anchor.y)) ? { x: Number(item.anchor.x), y: Number(item.anchor.y) } : null;
    result.push({ id: item.id, file, ...size, description: item.description.trim(), group: String(item.group ?? "").trim() || null, ...(anchor ? { anchor } : {}) });
  }
  return { items: result, license: String(raw.license ?? ""), style: String(raw.style ?? "") };
}

export const packDirs = () => ({ builtin: path.join(config.root, "packs"), installed: path.join(config.data, "packs") });

async function walk(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    result.push({ entry, file: path.join(entry.parentPath ?? entry.path, entry.name) });
  }
  return result;
}

/** Read and check a pack folder. Throws with every problem listed. */
export async function readPack(dir) {
  const problems = [];
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(dir, "pack.json"), "utf8")); } catch (error) {
    throw new Error(`pack.json не читается: ${error.message}`);
  }
  if (manifest.format !== PACK_FORMAT) problems.push(`format должен быть "${PACK_FORMAT}".`);
  if (!ID.test(manifest.id ?? "")) problems.push("id: латиница в нижнем регистре, цифры и дефис, 2–40 символов.");
  if (typeof manifest.name !== "string" || !manifest.name.trim()) problems.push("name: название пакета.");
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+([-.+][\w.-]+)?$/.test(manifest.version)) problems.push("version: например 1.0.0.");
  if (manifest.cutroom !== PACK_API) problems.push(`cutroom: пакет для API ${manifest.cutroom ?? "?"}, это ядро поддерживает ${PACK_API}.`);
  const theme = validateTheme(manifest.theme, problems, "theme");
  const captions = manifest.captions === undefined ? null : { ...CAPTIONS_DEFAULTS, ...validateCaptions(manifest.captions, problems, "captions") };

  const components = (await readdir(path.join(dir, "components")).catch(() => []))
    .filter((name) => name.endsWith(".tsx")).map((name) => name.replace(/\.tsx$/, ""));
  for (const name of components) if (!COMPONENT.test(name)) problems.push(`components/${name}.tsx: имя с заглавной латинской буквы.`);
  const replaces = {};
  for (const [type, component] of Object.entries(manifest.replaces ?? {})) {
    if (!REPLACEABLE.includes(type)) problems.push(`replaces.${type}: заменить можно ${REPLACEABLE.join(", ")}.`);
    else if (!components.includes(component)) problems.push(`replaces.${type}: нет components/${component}.tsx.`);
    else replaces[type] = component;
  }
  const fonts = [];
  for (const [i, font] of (Array.isArray(manifest.fonts) ? manifest.fonts : []).entries()) {
    const file = String(font?.file ?? "");
    if (!file.startsWith("fonts/") || file.includes("..") || !FONT_FILE.test(file)) { problems.push(`fonts[${i}].file: файл в fonts/ (woff2, woff, ttf, otf).`); continue; }
    try { await lstat(path.join(dir, file)); } catch { problems.push(`fonts[${i}]: нет файла ${file}.`); continue; }
    if (typeof font.family !== "string" || !font.family.trim()) { problems.push(`fonts[${i}].family: название семейства.`); continue; }
    if (font.unicodeRange !== undefined && !/^[Uu+0-9A-Fa-f?, -]{1,2000}$/.test(String(font.unicodeRange))) { problems.push(`fonts[${i}].unicodeRange: например U+0400-045F.`); continue; }
    const weight = font.weight ?? 400;
    if (!/^\d{3}( \d{3})?$/.test(String(weight))) { problems.push(`fonts[${i}].weight: 400 или диапазон "400 900" для переменного шрифта.`); continue; }
    fonts.push({ family: font.family, file, weight, style: font.style === "italic" ? "italic" : "normal", ...(font.unicodeRange ? { unicodeRange: String(font.unicodeRange) } : {}) });
  }
  const fullFrame = [];
  for (const name of Array.isArray(manifest.fullFrame) ? manifest.fullFrame : []) {
    if (!components.includes(name)) problems.push(`fullFrame: нет components/${name}.tsx.`);
    else fullFrame.push(name);
  }
  const { looks, defaultLook } = readLooks(manifest, problems);
  const illustrationSet = await readIllustrations(dir, problems);
  const illustrations = Array.isArray(illustrationSet) ? [] : illustrationSet.items;
  const instructions = (await readdir(path.join(dir, "instructions")).catch(() => [])).filter((name) => name.endsWith(".md")).sort();
  if (!instructions.includes("README.md")) problems.push("instructions/README.md: правила вкуса для агента обязательны.");
  const examples = (await readdir(path.join(dir, "examples")).catch(() => [])).filter((name) => /\.(png|jpe?g|webp|mp4)$/i.test(name));

  let bytes = 0;
  for (const { entry, file } of await walk(dir)) {
    if (entry.isSymbolicLink()) problems.push(`${path.relative(dir, file)}: ссылки в пакете запрещены.`);
    else if (entry.isFile()) bytes += (await lstat(file)).size;
  }
  if (bytes > MAX_PACK_BYTES) problems.push(`пакет больше ${MAX_PACK_BYTES / 1024 / 1024} МБ.`);
  if (problems.length) throw new Error(`Пакет вкуса не прошёл проверку:\n- ${problems.join("\n- ")}`);
  return {
    id: manifest.id,
    name: manifest.name.trim(),
    version: manifest.version,
    description: String(manifest.description ?? ""),
    author: String(manifest.author ?? ""),
    license: String(manifest.license ?? ""),
    theme, captions, replaces, fonts, components, fullFrame, instructions, examples,
    looks, defaultLook, illustrations,
    illustrationsInfo: Array.isArray(illustrationSet) ? null : { license: illustrationSet.license, style: illustrationSet.style },
    dir,
  };
}

/** Every pack: built-in first. Broken installed packs are listed with their error. */
export async function listPacks() {
  const { builtin, installed } = packDirs();
  const result = [];
  for (const [root, isBuiltin] of [[builtin, true], [installed, false]]) {
    const entries = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !e.name.startsWith("."));
    for (const name of entries.map((e) => e.name).sort()) {
      try { result.push({ ...(await readPack(path.join(root, name))), builtin: isBuiltin }); } catch (error) {
        result.push({ id: name, name, version: "?", builtin: isBuiltin, error: error.message, dir: path.join(root, name) });
      }
    }
  }
  return result;
}

/** The pack to use: the chosen one if it is installed and valid, else the built-in default. */
export async function resolvePack(id) {
  const packs = (await listPacks()).filter((pack) => !pack.error);
  return packs.find((pack) => pack.id === id) ?? packs.find((pack) => pack.id === DEFAULT_PACK) ?? null;
}

/** Copy the pack into the version folder: <version>/pack. */
export async function snapshotPack(pack, versionDir) {
  const target = path.join(versionDir, "pack");
  await rm(target, { recursive: true, force: true });
  if (!pack) return null;
  await cp(pack.dir, target, { recursive: true });
  return { id: pack.id, name: pack.name, version: pack.version };
}

/** The version's own pack snapshot, or null. */
export async function versionPack(versionDir) {
  try { return await readPack(path.join(versionDir, "pack")); } catch { return null; }
}

/** Install a pack from a .zip; replaces an installed pack with the same id. */
export async function installPackZip(zipPath) {
  const { builtin, installed } = packDirs();
  await mkdir(installed, { recursive: true });
  const work = await mkdtemp(path.join(installed, ".install-"));
  try {
    const listing = (await promisify(execFile)("unzip", ["-Z1", zipPath], { maxBuffer: 16 * 1024 * 1024 })).stdout.split("\n").filter(Boolean);
    if (listing.some((name) => name.startsWith("/") || name.split("/").includes(".."))) throw new Error("Архив содержит пути за пределами пакета.");
    await promisify(execFile)("unzip", ["-q", zipPath, "-d", path.join(work, "x")]);
    let root = path.join(work, "x");
    const top = (await readdir(root)).filter((name) => !name.startsWith(".") && name !== "__MACOSX");
    if (!(await lstat(path.join(root, "pack.json")).catch(() => null)) && top.length === 1) root = path.join(root, top[0]);
    const pack = await readPack(root);
    if ((await readdir(builtin, { withFileTypes: true }).catch(() => [])).some((e) => e.isDirectory() && e.name === pack.id)) throw new Error(`id «${pack.id}» занят встроенным пакетом.`);
    await rm(path.join(root, "__MACOSX"), { recursive: true, force: true });
    const target = path.join(installed, pack.id);
    await rm(target, { recursive: true, force: true });
    await rename(root, target);
    return readPack(target);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function removePack(id) {
  if (!ID.test(id)) throw new Error("Неверный id пакета.");
  const target = path.join(packDirs().installed, id);
  if (!(await lstat(target).catch(() => null))) throw new Error("Пакет не установлен или встроенный.");
  await rm(target, { recursive: true, force: true });
}

/** Public view of a pack for the API. */
export function packSummary(pack) {
  if (!pack) return null;
  const { dir, ...rest } = pack;
  void dir;
  return rest;
}
