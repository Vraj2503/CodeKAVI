/**
 * Dev supervisor: Tailwind CLI watch + `next dev`, with a teardown that
 * actually kills the tree on Windows.
 *
 * Why this exists
 * ---------------
 * Turbopack runs PostCSS out-of-process. When a `postcss.config.*` is present
 * it generates `.next/dev/build/postcss.js` and spawns a Node child per
 * transform via `[turbopack-node]/child_process/evaluate.ts`. Next 16 exposes
 * no knob to bound that pool, and on Windows the children are NOT killed with
 * their parent — there is no process-group signal delivery, so a force-kill,
 * a closed terminal, or a crash strands the entire pool. Measured on this repo:
 * 129 stranded workers holding ~5.3GB, all children of one dead parent. That is
 * what froze a 16GB laptop. macOS never shows it because SIGINT reaches the
 * whole process group and the strays die with the server.
 *
 * The fix is to remove PostCSS from the Turbopack pipeline entirely: Tailwind
 * is compiled here by its own CLI into `app/globals.css`, and Next only ever
 * sees a plain stylesheet, which Turbopack handles natively in Rust with
 * Lightning CSS (always on since 14.2 — it also covers the vendor prefixing
 * autoprefixer used to do). One bounded watcher replaces an unbounded pool.
 *
 * This supervisor still kills its children explicitly, because the Tailwind
 * watcher inherits the same Windows orphaning behaviour.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isWindows = process.platform === "win32";

// Resolve the packages' JS entrypoints and run them under this same Node
// binary. The `.bin` shims are `.cmd` files on Windows, and since the Node
// 18.20/20.12 spawn hardening those cannot be executed without `shell: true` —
// which would add a cmd.exe layer between us and the child and break the
// tree-kill below. Going straight to the JS keeps the process tree flat.
const TAILWIND = path.join(root, "node_modules", "tailwindcss", "lib", "cli.js");
const NEXT = path.join(root, "node_modules", "next", "dist", "bin", "next");

const IN = "app/globals.src.css";
const OUT = "app/globals.css";

/** Windows needs the whole tree; POSIX can signal the process group. */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (isWindows) {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
        stdio: "ignore",
      });
    } else {
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    // Already gone. Nothing to do.
  }
}

// A first synchronous build, so `app/globals.css` exists before Next resolves
// the import in app/layout.tsx. Without this the very first dev boot 404s the
// stylesheet and renders unstyled.
console.log("[dev] building CSS…");
const first = spawnSync(process.execPath, [TAILWIND, "-i", IN, "-o", OUT], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});
if (first.status !== 0 || !existsSync(path.join(root, OUT))) {
  console.error("[dev] initial CSS build failed — not starting Next.");
  process.exit(first.status || 1);
}

const children = [];

// stdin MUST be a live pipe we hold open. The Tailwind CLI deliberately does
// `process.stdin.on("end", () => process.exit(0))` in watch mode ("abort the
// watcher if stdin is closed to avoid zombie processes"), so `stdio: "ignore"`
// hands it an instant EOF and it exits 0 before compiling anything — silently,
// because exit code 0 looks like success. Holding the pipe open also means the
// watcher dies by itself if this supervisor is force-killed.
const css = spawn(process.execPath, [TAILWIND, "-i", IN, "-o", OUT, "--watch"], {
  cwd: root,
  stdio: ["pipe", "ignore", "pipe"],
  shell: false,
  detached: !isWindows,
});
children.push(css);
// The CLI writes its normal "Rebuilding…/Done in Nms" chatter to stderr, which
// would drown out Next's output. Surface only genuine failures.
css.stderr.setEncoding("utf8");
css.stderr.on("data", (chunk) => {
  if (/error|warn/i.test(chunk)) process.stderr.write(`[tailwind] ${chunk}`);
});

const next = spawn(process.execPath, [NEXT, "dev", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  shell: false,
  detached: !isWindows,
});
children.push(next);

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) killTree(c);
  process.exit(code ?? 0);
}

// Next owns the session: when it goes, everything goes.
next.on("exit", (code) => shutdown(code ?? 0));
// Any exit here is a failure, code 0 included: while we are alive the watcher
// has no legitimate reason to stop, and a silent 0 is exactly how the stdin-EOF
// bug hid itself. Failing loudly beats serving stale CSS.
css.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(
      `[dev] tailwind watcher exited unexpectedly (code ${code}) — CSS would go stale. Shutting down.`,
    );
    shutdown(code || 1);
  }
});

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, () => shutdown(0));
}
process.on("exit", () => {
  for (const c of children) killTree(c);
});
