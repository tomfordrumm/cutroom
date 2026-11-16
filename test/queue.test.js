import assert from "node:assert/strict";
import test from "node:test";
import { isJobConcurrency, jobConcurrency, machine, MAX_CONCURRENCY } from "../src/queue.js";

test("job concurrency defaults to one and stays within the limit", () => {
  assert.equal(jobConcurrency(undefined), 1);
  assert.equal(jobConcurrency(null), 1);
  assert.equal(jobConcurrency("abc"), 1);
  assert.equal(jobConcurrency(0), 1);
  assert.equal(jobConcurrency(3), 3);
  assert.equal(jobConcurrency(99), MAX_CONCURRENCY);
});

test("settings accept only whole numbers from 1 to the limit", () => {
  assert.ok(isJobConcurrency(1));
  assert.ok(isJobConcurrency(MAX_CONCURRENCY));
  assert.ok(!isJobConcurrency(0));
  assert.ok(!isJobConcurrency(2.5));
  assert.ok(!isJobConcurrency("2"));
  assert.ok(!isJobConcurrency(MAX_CONCURRENCY + 1));
});

test("machine suggests a limit between 1 and the maximum", () => {
  const info = machine();
  assert.ok(info.cpus >= 1);
  assert.ok(info.suggested >= 1 && info.suggested <= MAX_CONCURRENCY);
});
