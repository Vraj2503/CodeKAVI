<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Codex will review your output once you are done.
<!-- END:nextjs-agent-rules -->

# CSS: edit `app/globals.src.css`, never `app/globals.css`

`app/globals.css` is **generated** by the Tailwind CLI and git-ignored. Edits to
it are erased on the next rebuild. The Tailwind source is `app/globals.src.css`.

Tailwind is compiled outside of Next on purpose, and there is deliberately **no
`postcss.config.*` in this project**. Do not add one back.

When a PostCSS config exists, Turbopack runs PostCSS out-of-process: it writes
`.next/dev/build/postcss.js` and spawns a Node child per transform. Next 16
exposes no setting that bounds that pool, and on Windows the children are not
killed with their parent — there is no process-group signal delivery, so a
force-kill, a closed terminal or a crash strands the whole pool. Measured here:
**129 stranded workers holding ~5.3GB**, all children of one dead parent, which
froze a 16GB laptop. It surfaces first as an unrelated-looking error —
`Jest worker encountered N child process exceptions, exceeding retry limit`.
macOS hides the bug entirely, because SIGINT reaches the whole process group.

With no PostCSS config, Turbopack handles the resulting plain stylesheet
natively in Rust via Lightning CSS (always on since 14.2 — it also does the
vendor prefixing `autoprefixer` used to do).

- `npm run dev` — `scripts/dev.mjs` runs the Tailwind watcher + `next dev`
  together and tears the tree down on exit.
- `npm run build` — `prebuild` compiles the CSS minified first.

Both scripts hold the watcher's stdin open on purpose: the Tailwind CLI exits 0
the moment stdin closes ("abort the watcher if stdin is closed to avoid zombie
processes"), so `stdio: "ignore"` silently produces stale CSS.
