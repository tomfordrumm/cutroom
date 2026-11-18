#!/usr/bin/env node
// Commands update.sh runs inside the app container:
//   node src/admin.js status   → {"version","running","queued","paused"} as JSON
//   node src/admin.js pause    → new edits wait; running ones go on
//   node src/admin.js resume   → the queue runs again
import { pauseQueue, queueCounts, queuePause, resumeQueue, VERSION } from "./release.js";

const command = process.argv[2];
if (command === "pause") pauseQueue(process.argv[3] || undefined);
else if (command === "resume") resumeQueue();
else if (command !== "status") {
  console.error("Использование: node src/admin.js status|pause|resume");
  process.exit(1);
}
console.log(JSON.stringify({ version: VERSION, ...queueCounts(), paused: queuePause() }));
