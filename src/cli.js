#!/usr/bin/env node
// `cutroom` — the editing agent's tools inside a version folder.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildCut, exists, loadVersion, readJson } from "./cut.js";
import { prepareGraphics, readGraphics, renderStills, reviewGraphics } from "./graphics.js";
import { checkScenes } from "./scenes.js";

const HELP = `Инструменты монтажёра Cutroom. Запускать в папке версии.

  cutroom cut                 собрать склейку из decisions.json и overrides.json:
                              out/cut.mp4 и timeline.json; печатает, что осталось
  cutroom frame <t> [t…]      кадры склейки без графики → frames/frame-<t>.jpg
  cutroom gfx check           проверить graphics.json и показать, где окажется графика
  cutroom gfx still <t> [t…]  кадры с графикой → frames/gfx-<t>.png
  cutroom gfx review          проверить раскладку каждого элемента: лицо, субтитры,
                              безопасная зона площадки → gfx-review.json и лист
                              кадров frames/review-sheet-1.jpg; код 2 при ошибках

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
    console.log(`graphics.json в порядке: элементов ${prepared.overlays.length}, звуков ${prepared.audio.length}, субтитры ${prepared.graphics.captions ? `${prepared.graphics.captions.style}, ${prepared.graphics.captions.position}` : "нет"}. Пакет вкуса: ${prepared.pack ? `${prepared.pack.name} ${prepared.pack.version}` : "нет"}.`);
    for (const o of prepared.overlays) console.log(`  ${o.id} ${o.type}${o.component ? `/${o.component}` : ""}: ${fmt(o.programStart)}–${fmt(o.programEnd)} склейки ← ${o.start}–${o.end} исходника  «${o.label}»`);
    for (const a of prepared.audio) {
      // The agent's multipliers as written; the linear levels come from the author's settings.
      const raw = prepared.graphics.audio.find((x) => x.id === a.id) ?? {};
      const where = a.type === "music" ? `${fmt(a.programStart)}–${fmt(a.programEnd)} склейки ← ${a.start}–${a.end} исходника, громкость ${raw.volume ?? 1}/${raw.pauseVolume ?? 1} от уровня автора (речь/пауза)` : `${fmt(a.programStart)} склейки ← ${a.at} исходника, громкость ${raw.volume ?? 1} от уровня автора`;
      console.log(`  ${a.id} ${a.type}: ${where}  ${a.file}`);
    }
    for (const warning of prepared.warnings) console.log(`  ! ${warning}`);
    const sceneReview = await checkScenes(dir, prepared.graphics);
    if (sceneReview.scenes.length) console.log(`\nКарта сцен: ${sceneReview.scenes.length}.`);
    if (sceneReview.problems.length) {
      console.log("\nКарта сцен и текст на экране — исправь:");
      for (const problem of sceneReview.problems) console.log(`  ! ${problem}`);
    } else if (sceneReview.scenes.length) console.log("Текст на экране не повторяет речь.");
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
