#!/usr/bin/env node
// `cutroom` — the editing agent's tools inside a version folder.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildCut, exists, loadVersion, readJson } from "./cut.js";
import { prepareGraphics, readGraphics, renderIllustrationsSheet, renderMovesSheet, renderStills, reviewGraphics } from "./graphics.js";
import { checkScenes } from "./scenes.js";
import { checkClip, clipStills, listClips, newClip, refreshLook, renderClip, runInClip } from "./clips.js";
import { enabledEngines } from "./engines.js";
import { generateImage, imagesSnapshot, listImages, REDO_LIMIT } from "./images.js";

const HELP = `Инструменты монтажёра Cutroom. Запускать в папке версии.

  cutroom cut                 собрать склейку из decisions.json и overrides.json:
                              out/cut.mp4 и timeline.json; печатает, что осталось
  cutroom frame <t> [t…]      кадры склейки без графики → frames/frame-<t>.jpg
  cutroom gfx check           проверить graphics.json и показать, где окажется графика
  cutroom gfx still <t> [t…]  кадры с графикой → frames/gfx-<t>.png
  cutroom gfx review          проверить раскладку каждого элемента: лицо, субтитры,
                              безопасная зона площадки → gfx-review.json, лист
                              элементов frames/review-sheet-1.jpg и лист сцен
                              frames/scenes-sheet-1.jpg (начало, середина, конец);
                              код 2 при ошибках
  cutroom gfx moves           лист библиотеки движений → frames/moves-sheet.jpg
  cutroom gfx illustrations   листы иллюстраций пакета с id → frames/illustrations-*.jpg

Клипы на других движках (полноэкранная сцена отдельным видео, guide/clips.md):
  cutroom clip list                          клипы версии и включённые движки
  cutroom clip new <имя> --engine <движок> --duration <с>
                                             проект клипа в clips/<имя>/ под размер ролика
  cutroom clip check <имя>                   проверка композиции средствами движка
  cutroom clip look <имя>                    обновить look.css после смены стиля ролика
  cutroom clip still <имя> <с> [с…]          кадры клипа → clips/<имя>/stills/
  cutroom clip render <имя> [--alpha]        рендер → clips/<имя>.mp4 (.webm с прозрачностью)
  cutroom clip run <имя> -- <команда…>       команда движка в папке клипа

Картинки, которых нет в пакете (через Codex автора, guide/images.md):
  cutroom image list                         сгенерированные картинки версии и лимит
  cutroom image new <имя> --prompt "…" [--shape square|portrait|landscape]
                      [--background transparent|scene]
                                             картинка в стиле пакета → images/<имя>.png
  cutroom image new <имя> --again --prompt "…"   сгенерировать её заново

<t> — секунды склейки (что видит автор); s12.5 — секунды исходника.`;

const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

async function programTimes(dir, args) {
  if (!args.length) throw new Error("Укажите время: секунды склейки или s<секунды исходника>.");
  const timeline = await readJson(path.join(dir, "timeline.json"));
  return args.map((arg) => {
    if (arg.startsWith("s")) {
      const source = Number(arg.slice(1));
      const segment = timeline.segments.find((s) => source >= s.sourceStart && source <= s.sourceEnd);
      if (!segment) throw new Error(`${arg}: этот момент исходника вырезан.`);
      return segment.programStart + source - segment.sourceStart;
    }
    const t = Number(arg);
    if (!Number.isFinite(t) || t < 0 || t > timeline.duration) throw new Error(`${arg}: время вне склейки (0–${timeline.duration.toFixed(2)} с).`);
    return t;
  });
}

async function needCut(dir) {
  if (!(await exists(path.join(dir, "timeline.json"))) || !(await exists(path.join(dir, "out", "cut.mp4")))) {
    throw new Error("Сначала соберите склейку: cutroom cut");
  }
}

async function main([command, sub, ...rest]) {
  const dir = process.cwd();
  if (!command || command === "help" || command === "--help") return console.log(HELP);
  if (!(await exists(path.join(dir, "context.json")))) throw new Error("Здесь нет context.json: запускайте в папке версии.");
  const version = await loadVersion(dir);

  if (command === "cut") {
    const result = await buildCut(dir, { onProgress: (message, percent) => percent == null || percent % 25 === 0 ? process.stderr.write(`${message}\n`) : null });
    const { timeline } = result;
    const removed = version.media.duration - timeline.duration;
    console.log(`Склейка: ${timeline.duration.toFixed(2)} с из ${version.media.duration.toFixed(2)} с, вырезано ${removed.toFixed(2)} с, кусков ${timeline.segments.length}.`);
    console.log(`Видео: out/cut.mp4${result.rendered ? "" : " (без изменений)"}. Таймлайн: timeline.json.\n`);
    console.log("Что осталось (время склейки ← время исходника):");
    for (const unit of timeline.units) console.log(`  ${fmt(unit.programStart)}–${fmt(unit.programEnd)} ← ${unit.sourceStart.toFixed(2)}–${unit.sourceEnd.toFixed(2)}  ${unit.id}  ${unit.text}`);
    return;
  }

  if (command === "frame") {
    await needCut(dir);
    const times = await programTimes(dir, [sub, ...rest].filter(Boolean));
    await mkdir(path.join(dir, "frames"), { recursive: true });
    for (const t of times) {
      const output = path.join("frames", `frame-${t.toFixed(2)}.jpg`);
      await promisify(execFile)("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", path.join("out", "cut.mp4"), "-frames:v", "1", "-q:v", "3", output]);
      console.log(output);
    }
    return;
  }

  if (command === "gfx" && sub === "check") {
    await needCut(dir);
    if (!(await readGraphics(dir))) throw new Error("Нет graphics.json.");
    const prepared = await prepareGraphics(dir, version.media.duration);
    console.log(`graphics.json в порядке: элементов ${prepared.overlays.length}, звуков ${prepared.audio.length}, субтитры ${prepared.graphics.captions ? `${prepared.graphics.captions.style}, ${prepared.graphics.captions.position}` : "нет"}. Пакет вкуса: ${prepared.pack ? `${prepared.pack.name} ${prepared.pack.version}` : "нет"}${prepared.graphics.look ? `, стиль ${prepared.graphics.look} (${prepared.pack.looks[prepared.graphics.look].name})` : ""}.`);
    for (const o of prepared.overlays) console.log(`  ${o.id} ${o.type}${o.component ? `/${o.component}` : ""}: ${fmt(o.programStart)}–${fmt(o.programEnd)} склейки ← ${o.start}–${o.end} исходника  «${o.label}»`);
    for (const a of prepared.audio) {
      // The agent's multipliers as written; the linear levels come from the author's settings.
      const raw = prepared.graphics.audio.find((x) => x.id === a.id) ?? {};
      const where = a.type === "music" ? `${fmt(a.programStart)}–${fmt(a.programEnd)} склейки ← ${a.start}–${a.end} исходника, громкость ${raw.volume ?? 1}/${raw.pauseVolume ?? 1} от уровня автора (речь/пауза)` : `${fmt(a.programStart)} склейки ← ${a.at} исходника, громкость ${raw.volume ?? 1} от уровня автора`;
      console.log(`  ${a.id} ${a.type}: ${where}  ${a.file}`);
    }
    for (const warning of prepared.warnings) console.log(`  ! ${warning}`);
    // A clip shorter than its place in the cut ends early and leaves an empty frame.
    const clips = Object.fromEntries((await listClips(dir)).map((c) => [c.name, c]));
    for (const o of prepared.overlays.filter((x) => x.type === "video" && String(x.props.file).startsWith("clips/"))) {
      const clip = clips[path.basename(String(o.props.file)).replace(/\.(mp4|webm)$/, "")];
      const length = o.programEnd - o.programStart;
      if (clip && clip.duration + 0.05 < length - Number(o.props.from ?? 0)) console.log(`  ! ${o.id}: клип ${clip.name} идёт ${clip.duration} с, а место в склейке ${length.toFixed(2)} с — в конце будет пустой кадр. Удлини клип или сократи элемент.`);
    }
    const sceneReview = await checkScenes(dir, prepared.graphics);
    if (sceneReview.scenes.length) console.log(`\nКарта сцен: ${sceneReview.scenes.length}.`);
    if (sceneReview.problems.length) {
      console.log("\nКарта сцен и текст на экране — исправь:");
      for (const problem of sceneReview.problems) console.log(`  ! ${problem}`);
    } else if (sceneReview.scenes.length) console.log("Текст на экране не повторяет речь.");
    if (sceneReview.warnings?.length) {
      console.log("\nПосмотри и реши:");
      for (const warning of sceneReview.warnings) console.log(`  ? ${warning}`);
    }
    return;
  }

  if (command === "clip") {
    const [name, ...args] = rest;
    const io = { out: process.stdout, err: process.stderr };
    const flag = (key) => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
    if (sub === "list" || !sub) {
      const clips = await listClips(dir);
      console.log(`Движки: ${enabledEngines().join(", ") || "ни одного не включено в настройках Cutroom"}.`);
      if (!clips.length) console.log("Клипов нет.");
      for (const c of clips) console.log(`  ${c.name} — ${c.engine}, ${c.duration} с, ${c.width}×${c.height} @ ${c.fps}: ${c.rendered.join(", ") || "не отрендерен"}`);
      return;
    }
    if (!name) throw new Error("Укажите имя клипа.");
    if (sub === "new") {
      const clip = await newClip(dir, name, { engine: flag("--engine"), duration: flag("--duration") });
      console.log(`Клип ${name}: clips/${name}/, ${clip.engine}, ${clip.duration} с, ${clip.width}×${clip.height} @ ${clip.fps} к/с.`);
      console.log(`Стиль ролика${clip.look ? ` «${clip.look}»` : ""}: clips/${name}/look.css — шрифты пакета и цвета переменными (var(--background), var(--accent), var(--display-font)…), уже подключён.`);
      console.log(`Правила движка: ${clip.guide}. Порядок работы с клипом: guide/clips.md.`);
      return;
    }
    if (sub === "look") { console.log(`look.css обновлён: ${(await refreshLook(dir, name)) ?? "тема пакета"}.`); return; }
    if (sub === "check") { process.exitCode = (await checkClip(dir, name, io)).code ? 2 : 0; return; }
    if (sub === "still") { const r = await clipStills(dir, name, args, io); if (r.code) process.exitCode = 2; else console.log(`Кадры: clips/${name}/stills/`); return; }
    if (sub === "render") {
      const r = await renderClip(dir, name, { alpha: args.includes("--alpha"), ...io });
      console.log(`\nГотово: ${r.file}. В graphics.json: { "type": "video", "start": …, "end": …, "props": { "file": "${r.file}" } } — длина элемента в склейке около ${r.duration} с.`);
      return;
    }
    if (sub === "run") {
      const at = args.indexOf("--");
      const r = await runInClip(dir, name, at >= 0 ? args.slice(at + 1) : args, io);
      process.exitCode = r.code;
      return;
    }
    throw new Error(`Неизвестная команда clip ${sub}.\n\n${HELP}`);
  }

  if (command === "image") {
    const [name, ...args] = rest;
    const flag = (key) => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined; };
    const settings = imagesSnapshot();
    if (sub === "list" || !sub) {
      const images = await listImages(dir);
      console.log(settings.available
        ? `Генерация через Codex: ${images.length} из ${settings.limit} картинок на ролик, каждую можно переделать ${REDO_LIMIT} раза.`
        : `Генерация недоступна: ${settings.enabled ? "Codex CLI не подключён" : "выключена в настройках"}.`);
      for (const i of images) console.log(`  ${i.file} — ${i.width}×${i.height}, ${i.background === "scene" ? "сцена" : "без фона"}: ${i.prompt}`);
      return;
    }
    if (sub !== "new") throw new Error(`Неизвестная команда image ${sub}.\n\n${HELP}`);
    if (!name) throw new Error("Укажите имя картинки.");
    const entry = await generateImage(dir, name, {
      prompt: flag("--prompt"),
      shape: flag("--shape") ?? "square",
      background: flag("--background") ?? "transparent",
      again: args.includes("--again"),
      onProgress: (message) => process.stderr.write(`${message}…\n`),
    });
    console.log(`Готово: ${entry.file}, ${entry.width}×${entry.height}, ${entry.seconds} с. Открой файл и посмотри: подходит ли к стилю и смыслу сцены.`);
    console.log(entry.background === "scene"
      ? `В graphics.json: { "type": "image", "start": …, "end": …, "props": { "file": "${entry.file}" } }.`
      : `В graphics.json: { "type": "sticker", "start": …, "end": …, "props": { "file": "${entry.file}" } } — как иллюстрация пакета, с подписью caption по желанию.`);
    console.log("Запиши в reply.md, что картинка сгенерирована и зачем.");
    return;
  }

  if (command === "gfx" && sub === "moves") {
    const { sheet, moves } = await renderMovesSheet(dir, { onProgress: (message) => process.stderr.write(`${message}…\n`) });
    console.log(`Лист движений: ${sheet} — строка на движение, шесть кадров. Открой и выбери по картинке.`);
    for (const m of moves) console.log(`  ${m.name} — ${m.say}`);
    console.log("Как вызывать: guide/motion.md.");
    return;
  }

  if (command === "gfx" && sub === "illustrations") {
    const { sheets, count } = await renderIllustrationsSheet(dir);
    if (!count) { console.log("В пакете вкуса нет иллюстраций."); return; }
    console.log(`Иллюстраций ${count}. Листы по группам (подпись под картинкой — её id):`);
    for (const sheet of sheets) console.log(`  ${sheet.file} — ${sheet.group}, ${sheet.count}`);
    console.log("Описания — illustrations.md.");
    return;
  }

  if (command === "gfx" && sub === "still") {
    await needCut(dir);
    const times = await programTimes(dir, rest);
    const cut = await readJson(path.join(dir, "out", "cut.json"));
    const { written, warnings } = await renderStills(dir, times, {
      duration: version.media.duration,
      size: { width: cut.width, height: cut.height },
      onProgress: (message) => process.stderr.write(`${message}…\n`),
    });
    for (const file of written) console.log(path.relative(dir, file));
    for (const warning of warnings) console.log(`! ${warning}`);
    return;
  }

  if (command === "gfx" && sub === "review") {
    await needCut(dir);
    const cut = await readJson(path.join(dir, "out", "cut.json"));
    const report = await reviewGraphics(dir, {
      duration: version.media.duration,
      size: { width: cut.width, height: cut.height },
      onProgress: (message) => process.stderr.write(`${message}…\n`),
    });
    const mark = { pass: "ок", warn: "внимание", fail: "ОШИБКА" };
    if (!report.faces) console.log("Лицо в записи не найдено: проверка лица пропущена, смотри кадры глазами.");
    for (const o of report.overlays) {
      console.log(`${o.id} ${o.type}${o.component ? `/${o.component}` : ""}: ${mark[o.status]}  (кадр ${o.still})`);
      for (const sample of o.samples) for (const problem of sample.problems) console.log(`  ${sample.seconds.toFixed(2)} с склейки: ${problem}`);
    }
    if (report.sheets.length) console.log(`Лист кадров по порядку элементов: ${report.sheets.join(", ")} — открой и посмотри.`);
    if (report.sceneSheets?.length) console.log(`Сцены в движении (начало, середина, конец; строка на сцену): ${report.sceneSheets.join(", ")}.`);
    for (const t of report.transitions ?? []) if (t.warning) console.log(`  ? ${t.warning}`);
    console.log("\nТеперь строгий критик (AGENTS.md): посмотри листы как зритель, который видит ролик впервые на телефоне, найди слабые места, исправь и запиши в critique.md.");
    if (report.status === "fail") {
      console.log("\nЕсть ошибки раскладки: поправь position, размеры или время элемента и запусти проверку снова.");
      process.exitCode = 2;
    }
    return;
  }

  throw new Error(`Неизвестная команда.\n\n${HELP}`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
});
