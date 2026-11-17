// The scene map: a storyboard written before graphics.json.
//
// The agent first picks the video's visual thread (the recurring object the
// story happens to), then describes every scene: what is on screen (show),
// what the picture gives the viewer beyond the voice (adds), and the device
// (the thing itself, an example, the author's metaphor, before/after, a
// number, a process diagram, text). On-screen text is listed per scene.
// The check below keeps graphics from repeating what the voice already says:
//   - every graphic that builds a scene belongs to one in the map;
//   - one built-in template does not carry most of the video;
//   - a phrase of three or more content words mostly spoken in the same
//     moment is a retelling of the captions;
//   - a scene shows at most MAX_WORDS words;
//   - text in custom components must be declared in the map.
// Scenes where the captions are hidden (typing the spoken text) are exempt
// from the retelling and budget rules: there the text is the action.
//
// Flow: full-frame scenes that follow each other back to back must carry —
// name in `carry` what survives the boundary and grows into the next scene —
// or they read as slides however good each one is. Scene lengths that are all
// the same read as a metronome (a warning).
//
// Drawing: characters and objects are not drawn from SVG shapes in custom
// components; they come from the pack's illustrations, the interface kit or
// the author's material. A component named like a character that draws with
// many primitives fails the check.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadVersion } from "./cut.js";
import { isFullFrame } from "./graphics.js";
import { versionPack } from "./packs.js";

export const SCENES_FORMAT = "cutroom-scenes-v2";
const LEGACY_FORMAT = "cutroom-scenes-v1";
/** How a scene shows its idea, from the most to the least visual. */
export const DEVICES = {
  thing: "сам предмет: интерфейс, ответ, документ, о котором речь",
  example: "конкретный пример того, о чём говорит автор",
  metaphor: "образ, который использует автор",
  contrast: "было → стало, до → после",
  number: "число или масштаб",
  process: "схема процесса с несколькими участниками",
  text: "ключевое слово или термин",
};
// Built-in templates: easy to reach for, so they must not carry most of the video.
const TEMPLATE_TYPES = new Set(["action", "fullscreen", "list", "stat"]);
const TEMPLATE_SHARE = 0.5;
const TEMPLATE_RUN = 3;
export const MAX_WORDS = 10;
const RETELL_MIN_WORDS = 3;
const RETELL_SHARE = 0.6;
const SPEECH_MARGIN = 1.5;
// Back-to-back full-frame scenes closer than this (source seconds) need a carry.
const CARRY_GAP = 0.6;
// Coefficient of variation of scene lengths below this reads as a metronome.
const CADENCE_CV = 0.2;
const CADENCE_MIN_SCENES = 5;
// A custom component named like a character drawing this many shapes is a hand-drawn character.
const CHARACTER_SHAPES = 8;
const HEAVY_SHAPES = 70;
const CHARACTER_WORDS = /^(robot|person|people|human|man|woman|boy|girl|kid|child|student|teacher|pupil|character|mascot|face|head|body|hand|arm|leg|eye|mouth|cat|dog|bird|animal|creature|monster|figure|avatar|guy|bot|человек|робот)s?$/i;
const SHAPES = /<(circle|ellipse|rect|path|polygon|polyline|line)\b/g;

// Overlays that build a scene need one in the map: cards, lists, numbers,
// action scenes, custom components and anything over the whole frame. A hook
// plate, a callout, a pack accent, zooms and the author's media stay the
// pack's call.
const SCENE_TYPES = new Set(["fullscreen", "list", "stat", "action", "chat", "sticker", "custom"]);
// A clip rendered on another engine is the agent's graphic, not the author's footage.
const isClip = (overlay) => overlay.type === "video" && String(overlay.props?.file ?? "").startsWith("clips/");
const needsScene = (overlay, pack) => SCENE_TYPES.has(overlay.type) || isClip(overlay) || (overlay.type !== "image" && overlay.type !== "video" && isFullFrame(overlay, pack));
const TEXT_KEYS = ["text", "title", "kicker", "body", "label", "subtitle", "value", "caption", "items", "subject", "action", "object", "result"];

const FUNCTION_WORDS = new Set(`
  и а но ну вот так то это ведь же да нет или либо в во на с со к ко по о об от до из за для при про у над под без через
  что чтобы как который которая которое которые если когда где там тут здесь уже еще тоже очень просто даже бы ли
  этот эта эти тот та те я ты мы вы он она оно они меня мне нас вас его ее их ему ей им был была было были быть есть будет не ни
  the a an and or but so to of in on at for with from by is are was were be it this that you we they i not
`.split(/\s+/).filter(Boolean));

const words = (text) => [...String(text ?? "").toLowerCase().replaceAll("ё", "е").matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0]);
const stem = (word) => (word.length > 5 ? word.slice(0, 5) : word);
const contentStems = (text) => words(text).filter((w) => !FUNCTION_WORDS.has(w) && !/^\d+$/.test(w)).map(stem);
const clean = (value) => String(value ?? "").trim();

export async function readScenes(dir) {
  try { return JSON.parse(await readFile(path.join(dir, "scenes.json"), "utf8")); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`scenes.json: ${error.message}`);
  }
}

/** Strings a built-in or pack overlay puts on screen. */
export function overlayText(overlay) {
  const props = overlay.props ?? {};
  const messages = overlay.type === "chat" && Array.isArray(props.messages) ? props.messages.map((m) => clean(m?.text)).filter(Boolean) : [];
  return [...messages, ...TEXT_KEYS.flatMap((key) => {
    const value = props[key];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
    if (value && typeof value === "object" && typeof value.label === "string") return [value.label];
    return [];
  }).map(clean).filter(Boolean)];
}

/** Text a scene shows as its own words, not as the content of a drawn interface (a chat's messages). */
const budgetText = (overlay) => (overlay.type === "chat" ? overlayText({ ...overlay, props: { ...overlay.props, messages: [] } }) : overlayText(overlay));

/** Cyrillic text in custom components: string literals and JSX text. */
export async function customText(dir) {
  const folder = path.join(dir, "custom");
  const names = (await readdir(folder).catch(() => [])).filter((n) => n.endsWith(".tsx"));
  const found = [];
  for (const name of names) {
    const code = (await readFile(path.join(folder, name), "utf8")).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const literals = [...code.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`|>([^<>{}]+)</g)].map((m) => clean(m[1] ?? m[2] ?? m[3] ?? m[4]));
    for (const text of literals) if (/[а-яё]/i.test(text)) found.push({ file: `custom/${name}`, text });
  }
  return found;
}

/** Words spoken in source seconds, from the review packet's transcript. */
export function speechWords(packet) {
  const out = [];
  for (const segment of packet?.transcript?.segments ?? []) {
    const timed = Array.isArray(segment.words) && segment.words.length ? segment.words : null;
    if (timed) {
      for (const w of timed) {
        const text = typeof w.text === "string" ? w.text : String(segment.text ?? "").slice(w.startChar, w.endChar);
        for (const s of contentStems(text)) out.push({ stem: s, start: w.start, end: w.end });
      }
    } else {
      const stems = contentStems(segment.text);
      const step = (segment.end - segment.start) / Math.max(stems.length, 1);
      stems.forEach((s, i) => out.push({ stem: s, start: segment.start + i * step, end: segment.start + (i + 1) * step }));
    }
  }
  return out;
}

const FIELD_HINTS = {
  show: "что конкретно на экране",
  adds: "что картинка даёт зрителю сверх того, что он слышит",
};

function validScene(raw, index, problems, legacy) {
  const where = `scenes[${index}]${raw?.id ? ` (${raw.id})` : ""}`;
  const scene = {
    id: clean(raw?.id) || `s${index + 1}`,
    start: Number(raw?.start),
    end: Number(raw?.end),
    idea: clean(raw?.idea),
    // Maps written before v2 described the drawing in `visual`.
    show: clean(raw?.show) || clean(raw?.visual),
    adds: clean(raw?.adds),
    device: clean(raw?.device),
    text: Array.isArray(raw?.text) ? raw.text.map(clean).filter(Boolean) : [],
    overlays: Array.isArray(raw?.overlays) ? raw.overlays.map(clean).filter(Boolean) : [],
    carry: clean(raw?.carry),
  };
  if (!Number.isFinite(scene.start) || !Number.isFinite(scene.end) || scene.end <= scene.start) problems.push(`${where}: start/end — секунды исходника, start < end.`);
  if (!legacy) {
    for (const key of ["show", "adds"]) if (!scene[key]) problems.push(`${where}: заполни ${key} — ${FIELD_HINTS[key]}.`);
    if (!DEVICES[scene.device]) problems.push(`${where}: device — один из: ${Object.keys(DEVICES).join(", ")}.`);
  }
  if (!scene.overlays.length) problems.push(`${where}: overlays — id элементов graphics.json, которые показывают эту сцену.`);
  return scene;
}

/** The built-in template a scene is drawn with, when all its graphics are one. */
function templateOf(overlays) {
  const types = new Set(overlays.map((o) => o.type));
  const [type] = types;
  return types.size === 1 && TEMPLATE_TYPES.has(type) ? type : null;
}

/** One template for most scenes, or several in a row, means the video is a slideshow of one diagram. */
function reviewVariety(scenes, overlaysOf) {
  const problems = [];
  const ordered = [...scenes].sort((a, b) => a.start - b.start).map((s) => ({ id: s.id, template: templateOf(overlaysOf(s)) }));
  const counts = new Map();
  for (const { template } of ordered) if (template) counts.set(template, (counts.get(template) ?? 0) + 1);
  for (const [template, count] of counts) {
    if (ordered.length >= 4 && count / ordered.length > TEMPLATE_SHARE) {
      problems.push(`Шаблон ${template} в ${count} сценах из ${ordered.length}. Так ролик превращается в одну и ту же схему, а не в картинку к каждой мысли. Для каждой сцены подбери свой приём (device): сам предмет, пример, образ автора, было/стало; ${template} оставь там, где он правда лучше.`);
    }
  }
  for (let i = 0; i + TEMPLATE_RUN <= ordered.length; i++) {
    const run = ordered.slice(i, i + TEMPLATE_RUN);
    if (run[0].template && run.every((s) => s.template === run[0].template) && !(i > 0 && ordered[i - 1].template === run[0].template)) {
      problems.push(`${run.map((s) => s.id).join(", ")}: ${TEMPLATE_RUN} сцены подряд одним шаблоном ${run[0].template}. Смени приём хотя бы в одной.`);
    }
  }
  return problems;
}

/**
 * Back-to-back full-frame scenes must carry something across the boundary;
 * scene lengths must not all be the same. Returns { problems, warnings }.
 */
export function reviewFlow(scenes, overlaysOf, pack) {
  const problems = [], warnings = [];
  const ordered = [...scenes].sort((a, b) => a.start - b.start);
  const full = (scene) => overlaysOf(scene).some((o) => isFullFrame(o, pack));
  for (let i = 0; i + 1 < ordered.length; i++) {
    const a = ordered[i], b = ordered[i + 1];
    if (b.start - a.end > CARRY_GAP || !full(a) || !full(b)) continue;
    const shared = a.overlays.some((id) => b.overlays.includes(id));
    if (shared || a.carry) continue;
    problems.push(`${a.id} → ${b.id}: две полноэкранные сцены встык, одна просто сменяет другую, как слайд. Реши, что переживает границу и становится следующей сценой: тот же предмет меняет состояние, карточка вырастает в экран (morph), камера влетает в деталь (zoomThrough), сцена раскрывается из предмета (iris). Запиши это в carry сцены ${a.id} и сделай так в графике. Или верни автора в кадр между ними.`);
  }
  if (ordered.length >= CADENCE_MIN_SCENES) {
    const lengths = ordered.map((s) => s.end - s.start);
    const mean = lengths.reduce((x, y) => x + y, 0) / lengths.length;
    const cv = Math.sqrt(lengths.reduce((x, y) => x + (y - mean) ** 2, 0) / lengths.length) / Math.max(mean, 1e-6);
    if (cv < CADENCE_CV) warnings.push(`Сцены почти одной длины (${lengths.map((l) => l.toFixed(1)).join(", ")} с): это читается как метроном. Чередуй короткие удары и длинные удержания, длины должны отличаться в разы.`);
  }
  return { problems, warnings };
}

/**
 * Characters and objects drawn from SVG shapes in custom components. `sources`:
 * [{ file, code }]. Returns { problems, warnings }.
 */
export function reviewDrawings(sources, { illustrations = 0 } = {}) {
  const problems = [], warnings = [];
  for (const { file, code } of sources) {
    const plain = code.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const shapes = (plain.match(SHAPES) ?? []).length;
    // Each component's body runs from its definition to the next one.
    const defs = [...plain.matchAll(/\b(?:function|const|let)\s+([A-Z][A-Za-z0-9]*)/g)].map((m) => ({ name: m[1], at: m.index }));
    const drawn = defs.map((d, i) => ({ name: d.name, shapes: (plain.slice(d.at, defs[i + 1]?.at ?? plain.length).match(SHAPES) ?? []).length }));
    const characters = drawn.filter((d) => d.shapes >= CHARACTER_SHAPES && d.name.split(/(?=[A-Z])/).some((part) => CHARACTER_WORDS.test(part)));
    if (characters.length) {
      const count = characters.reduce((sum, d) => sum + d.shapes, 0);
      problems.push(`${file}: ${characters.map((d) => d.name).join(", ")} нарисован${characters.length > 1 ? "ы" : ""} из ${count} фигур SVG. Персонажей, людей, животных и предметы кодом не рисуй: так выходит любительская анимация. ${illustrations ? "Возьми готовую иллюстрацию пакета (sticker или <Illustration id> в компоненте, список в illustrations.md)" : "Покажи сам интерфейс из набора (окно, чат, документ), материал автора"} или реши сцену без персонажа: типографикой, одним предметом, который меняет состояние.`);
    } else if (shapes > HEAVY_SHAPES) {
      warnings.push(`${file}: ${shapes} фигур SVG. Если это рисунок предмета или персонажа, замени его иллюстрацией пакета или набором интерфейса; схемы, стрелки и выделения рисовать можно.`);
    }
  }
  return { problems, warnings };
}

/**
 * Checks graphics against the scene map and the speech. `graphics` is the
 * validated graphics.json. Returns { problems, scenes }.
 */
export function reviewScenes({ graphics, scenes: raw, speech, custom = [], pack = null, sources = [] }) {
  const problems = [];
  const warnings = [];
  const drawings = reviewDrawings(sources, { illustrations: pack?.illustrations?.length ?? 0 });
  problems.push(...drawings.problems);
  warnings.push(...drawings.warnings);
  const needing = (graphics?.overlays ?? []).filter((o) => needsScene(o, pack));
  if (!needing.length) return { problems, warnings, scenes: [] };
  if (!raw) {
    problems.push(`Нет scenes.json, а в graphics.json есть графика (${needing.map((o) => o.id).join(", ")}). Сначала напиши раскадровку: сквозной образ ролика, затем для каждой сцены — что на экране, что это даёт сверх голоса, приём и текст на экране.`);
    return { problems, warnings, scenes: [] };
  }
  const list = Array.isArray(raw) ? raw : raw.scenes;
  if (!Array.isArray(list)) { problems.push("scenes.json: нужен массив scenes."); return { problems, warnings, scenes: [] }; }
  const legacy = !Array.isArray(raw) && raw.format === LEGACY_FORMAT;
  const scenes = list.map((s, i) => validScene(s, i, problems, legacy));
  if (!legacy && scenes.length >= 3 && !clean(raw?.thread)) {
    problems.push("scenes.json: заполни thread — сквозной образ ролика (предмет или персонаж, с которым происходит история, и как он меняется). Если его правда нет, напиши почему.");
  }
  const sceneOf = new Map();
  for (const scene of scenes) for (const id of scene.overlays) sceneOf.set(id, scene);
  const known = new Set((graphics.overlays ?? []).map((o) => o.id));
  for (const scene of scenes) for (const id of scene.overlays) if (!known.has(id)) problems.push(`${scene.id}: элемента ${id} нет в graphics.json.`);
  for (const overlay of needing) if (!sceneOf.has(overlay.id)) problems.push(`${overlay.id}: не входит ни в одну сцену scenes.json.`);
  const overlaysOf = (scene) => (graphics.overlays ?? []).filter((o) => scene.overlays.includes(o.id));
  if (!legacy) {
    problems.push(...reviewVariety(scenes, overlaysOf));
    const flow = reviewFlow(scenes, overlaysOf, pack);
    problems.push(...flow.problems);
    warnings.push(...flow.warnings);
  }

  for (const scene of scenes) {
    const overlays = overlaysOf(scene);
    // Typing the spoken text with the captions hidden: there the text is the action.
    // The scene may also open the field or click a button before the typing starts.
    const typing = overlays.some((o) => o.props?.hideCaptions === true);
    const shown = [...new Set([...scene.text, ...overlays.flatMap(overlayText)])];
    if (typing) continue;
    // A chat's messages are the interface itself: they count for the retelling check, not for the budget.
    const chatLines = new Set(overlays.filter((o) => o.type === "chat").flatMap((o) => (o.props?.messages ?? []).map((m) => clean(m?.text))));
    const own = [...new Set([...scene.text.filter((t) => !chatLines.has(t)), ...overlays.flatMap(budgetText)])];
    const count = own.reduce((sum, text) => sum + words(text).length, 0);
    if (count > MAX_WORDS) problems.push(`${scene.id}: на экране ${count} слов, можно до ${MAX_WORDS}. Покажи это картинкой, а слова оставь голосу и субтитрам.`);
    const from = Math.min(scene.start, ...overlays.map((o) => o.start)) - SPEECH_MARGIN;
    const to = Math.max(scene.end, ...overlays.map((o) => o.end)) + SPEECH_MARGIN;
    const spoken = new Set(speech.filter((w) => w.end >= from && w.start <= to).map((w) => w.stem));
    const retells = (stems) => stems.length >= RETELL_MIN_WORDS && stems.filter((s) => spoken.has(s)).length / stems.length >= RETELL_SHARE;
    let flagged = false;
    for (const text of shown) {
      if (!retells(contentStems(text))) continue;
      flagged = true;
      problems.push(`${scene.id}: «${text}» повторяет то, что автор говорит в этот момент, и это уже есть в субтитрах. Покажи это картинкой или оставь одно-два ключевых слова.`);
    }
    // A sentence split into short lines is still the sentence; single-word labels are names.
    const phrases = shown.filter((text) => words(text).length >= 2);
    if (!flagged && phrases.length >= 2 && retells(phrases.flatMap(contentStems))) {
      problems.push(`${scene.id}: строки ${phrases.map((t) => `«${t}»`).join(", ")} вместе повторяют то, что автор говорит в этот момент. Покажи это картинкой или оставь одно-два ключевых слова.`);
    }
  }

  // Text drawn by custom components must be in the map, so the check sees it.
  const declared = new Set(scenes.flatMap((s) => s.text).map((t) => words(t).join(" ")));
  const undeclared = [...new Map(custom.filter(({ text }) => !declared.has(words(text).join(" "))).map((c) => [c.text, c])).values()];
  if (undeclared.length) {
    problems.push(`В компонентах есть текст, которого нет в scenes.json (поле text сцены): ${undeclared.slice(0, 6).map((c) => `«${c.text}» (${c.file})`).join(", ")}${undeclared.length > 6 ? ` и ещё ${undeclared.length - 6}` : ""}.`);
  }
  return { problems, warnings, scenes };
}

/** Source of the custom components: [{ file, code }]. */
export async function customSources(dir) {
  const folder = path.join(dir, "custom");
  const names = (await readdir(folder).catch(() => [])).filter((n) => n.endsWith(".tsx")).sort();
  return Promise.all(names.map(async (name) => ({ file: `custom/${name}`, code: await readFile(path.join(folder, name), "utf8") })));
}

/**
 * The critic's note: critique.md names at least one weak spot the agent found
 * on the review sheets and what it changed. Required when there are scenes.
 */
export async function critiqueProblems(dir, sceneCount) {
  if (!sceneCount) return [];
  const text = await readFile(path.join(dir, "critique.md"), "utf8").catch(() => "");
  const bullets = text.split("\n").filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line));
  if (!text.trim()) return ["Нет critique.md. После cutroom gfx review посмотри листы кадров как придирчивый зритель, который видит ролик впервые на телефоне, найди хотя бы одно слабое место, исправь его и запиши в critique.md (см. «Строгий критик» в AGENTS.md)."];
  if (!bullets.length) return ["critique.md: запиши слабые места списком, по пункту на каждое: что не так, в какой сцене и что исправил."];
  return [];
}

/** The scene check for a version folder, given its validated graphics. */
export async function checkScenes(dir, graphics) {
  const { packet } = await loadVersion(dir);
  let scenes;
  try { scenes = await readScenes(dir); } catch (error) { return { problems: [error.message], warnings: [], scenes: [] }; }
  return reviewScenes({ graphics, scenes, speech: speechWords(packet), custom: await customText(dir), pack: await versionPack(dir), sources: await customSources(dir) });
}
