// The editing queue, picked from SQLite. Settings → Очередь монтажа sets how
// many jobs run at once (1 = one after another); a video never runs two jobs
// at the same time. A job's progress, failure and cancellation live on the
// job; the video keeps its own stage.
import { setTimeout as sleep } from "node:timers/promises";
import { addMessage, db, getJob, getSetting, getVideo, now, updateJob, updateVideo } from "./db.js";
import { runEditJob, runFinalJob } from "./edit-job.js";
import { ensureModels } from "./models.js";
import { notifyVideo } from "./notify.js";
import { jobConcurrency } from "./queue.js";

const RUNNERS = { edit: runEditJob, final: runFinalJob };

function log(message) { console.log(`[worker ${new Date().toISOString()}] ${message}`); }

// Jobs left running by a crash or restart cannot resume mid-step; finished
// analysis is cached on disk, so running them again is cheap.
const orphaned = db.prepare("SELECT * FROM jobs WHERE status = 'running'").all();
for (const job of orphaned) {
  updateJob(job.id, { status: "failed", error: "Прервано перезапуском сервиса. Запустите монтаж снова.", finished_at: now() });
  restoreStage(job);
}

function restoreStage(job) {
  const video = getVideo(job.video_id);
  if (video && job.kind === "edit" && video.stage === "editing") updateVideo(video.id, { stage: video.latest_version ? "review" : "draft" });
}

function nextJob() {
  return db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND video_id NOT IN (SELECT video_id FROM jobs WHERE status = 'running') ORDER BY id LIMIT 1").get() ?? null;
}

async function run(job) {
  const controller = new AbortController();
  const watch = setInterval(() => {
    if (getJob(job.id)?.cancel_requested) controller.abort(new Error("Отменено"));
  }, 1000);
  updateJob(job.id, { status: "running", started_at: now(), step: "Начинаю", error: null });
  log(`job ${job.id} (${job.kind}) for video ${job.video_id} started`);
  try {
    await RUNNERS[job.kind](job, { signal: controller.signal });
    updateJob(job.id, { status: "done", finished_at: now(), progress: 100 });
    log(`job ${job.id} done`);
    const video = getVideo(job.video_id);
    if (job.kind === "edit") notifyVideo(job.video_id, "review", { version: video?.latest_version });
    if (job.kind === "final") notifyVideo(job.video_id, "final", { version: job.version ?? video?.accepted_version });
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const message = cancelled ? "Отменено" : error.message;
    updateJob(job.id, { status: cancelled ? "cancelled" : "failed", error: message, finished_at: now() });
    restoreStage(job);
    addMessage(job.video_id, "system", cancelled ? "Монтаж отменён." : `Монтаж не удался: ${message}`);
    if (!cancelled) notifyVideo(job.video_id, "failed", { error: message, kind: job.kind });
    log(`job ${job.id} ${cancelled ? "cancelled" : `failed: ${error.stack ?? error.message}`}`);
  } finally {
    clearInterval(watch);
  }
}

async function main() {
  log("started");
  // Fetch the models early so the first edit does not wait for the download.
  ensureModels((message) => log(message)).then(() => log("models ready")).catch((error) => log(`model download failed: ${error.message}`));
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; process.exit(0); });
  const running = new Set();
  while (!stopping) {
    // Read every tick, so a new setting applies without a restart. Lowering it
    // lets running jobs finish and holds new ones back.
    const limit = jobConcurrency(getSetting("jobConcurrency"));
    while (running.size < limit) {
      const job = nextJob();
      if (!job) break;
      // run() marks the job running before its first await, so the next
      // nextJob() call already skips it.
      const task = run(job).finally(() => running.delete(task));
      running.add(task);
    }
    await sleep(1000);
  }
}

main();
