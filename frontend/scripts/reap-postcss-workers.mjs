/**
 * Reap orphaned Turbopack PostCSS workers.
 *
 * Next 16 + Tailwind 3 runs PostCSS out-of-process: Turbopack generates
 * `.next/dev/build/postcss.js` and spawns a Node child to run it. Those
 * children are not reaped when the dev server dies — a force-kill, a closed
 * terminal, a crash — so they survive as orphans holding ~49MB each, forever.
 *
 * They accumulate silently across dev restarts. One session on this repo left
 * **93 orphans holding 4.47GB**, all traced to a single parent, with nothing
 * listening on :3000. That is enough to freeze a 16GB laptop, and it presents
 * as an unrelated symptom first: Next's own compile workers start dying with
 * "Jest worker encountered N child process exceptions, exceeding retry limit".
 *
 * Wired as `predev`, so every `npm run dev` starts from a clean slate.
 *
 * Safety rules, in order of importance:
 *   1. Only processes whose command line runs `.next/dev/build/postcss.js`.
 *   2. Only ORPHANS — a worker whose parent is still alive belongs to a
 *      running dev server and must never be touched. That is what makes this
 *      safe to run while another dev server is up.
 *   3. Never fail the build. Reaping is opportunistic; `npm run dev` must
 *      start regardless.
 */

import { execFileSync } from "node:child_process";

const WORKER_MATCH = "dev/build/postcss.js";
const isWindows = process.platform === "win32";

/** @returns {{pid: number, ppid: number}[]} */
function findWorkers() {
  if (isWindows) {
    // CIM rather than `wmic`, which is deprecated and absent on newer builds.
    const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
      Where-Object { $_.CommandLine -like '*postcss.js*' } |
      ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }`;
    const out = execFileSync("powershell", ["-NoProfile", "-Command", ps], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parsePairs(out);
  }

  const out = execFileSync("ps", ["-eo", "pid=,ppid=,args="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return out
    .split("\n")
    .filter((line) => line.includes(WORKER_MATCH))
    .map((line) => line.trim().split(/\s+/))
    .map(([pid, ppid]) => ({ pid: Number(pid), ppid: Number(ppid) }))
    .filter((p) => Number.isInteger(p.pid));
}

function parsePairs(out) {
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .map(([pid, ppid]) => ({ pid: Number(pid), ppid: Number(ppid) }))
    .filter((p) => Number.isInteger(p.pid) && Number.isInteger(p.ppid));
}

/** Signal 0 probes liveness without touching the process. */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but is owned by someone else — alive, not ours.
    return err.code === "EPERM";
  }
}

try {
  const workers = findWorkers();
  // A live parent means a live dev server. Leave its pool alone.
  const orphans = workers.filter((w) => !isAlive(w.ppid));

  let reaped = 0;
  for (const { pid } of orphans) {
    try {
      process.kill(pid, "SIGKILL");
      reaped++;
    } catch {
      // Already gone, or not ours to kill. Either way, nothing to do.
    }
  }

  if (reaped > 0) {
    const heldMb = reaped * 49; // measured steady-state per worker
    console.log(
      `[reap] cleared ${reaped} orphaned PostCSS worker${reaped === 1 ? "" : "s"} ` +
        `(~${(heldMb / 1024).toFixed(1)}GB) left by a previous dev server`,
    );
  }
} catch {
  // Process enumeration is best-effort and platform-specific. If it fails,
  // that is not a reason to stop someone starting their dev server.
}
