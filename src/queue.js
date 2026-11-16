// How many editing jobs the worker runs at once. 1 = one after another.
import os from "node:os";

export const MAX_CONCURRENCY = 4;

export function jobConcurrency(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 1 ? Math.min(number, MAX_CONCURRENCY) : 1;
}

export function isJobConcurrency(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_CONCURRENCY;
}

/** What the server has, to suggest a setting. Inside Docker this is the VM's share. */
export function machine() {
  const cpus = os.availableParallelism?.() ?? os.cpus().length;
  const memoryGb = Math.round(os.totalmem() / 1024 ** 3);
  // An edit runs Whisper, ffmpeg and Chromium; each parallel job wants about
  // 4 cores and 4 GB to stay usable.
  const suggested = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(cpus / 4), Math.floor(memoryGb / 4)));
  return { cpus, memoryGb, suggested };
}
