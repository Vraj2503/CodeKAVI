# Visualization Rebuild — Implementation Plan

Resumable plan for the CodeKavi visualization suite. Stop and restart anytime:
update the **Progress** table, and the **Resume protocol** below tells the next
session (human or AI) exactly where to pick up.

Baseline: `main` @ `3722fc7` · Plan written 2026-07-31 · Source: `/plan-design-review`

---

## Resume protocol

Read in this order, then start the first task whose status is `TODO` and whose
dependencies are all `DONE`:

1. **Locked decisions** — settled. Do not re-litigate.
2. **Progress** — what's done, what's next.
3. The task section for the task you're starting.
4. **Appendix A** if you need the original defect with line numbers.

Update the Progress table's Status and Notes as you go. That table is the single
source of truth for state — nothing else needs updating to stop cleanly.

---

## Why this work exists

The suite scored **5/10** on design completeness. It's bimodal: `DependencyGraph`
(8/10) is genuinely good; `TreemapViz` (2/10) should not be demoed. Three
problems decide whether this sells:

1. **Three of five visualizations break in light mode.** `TreemapViz`,
   `RadialMindmap`, and `ArchitectureGraph` use zero theme tokens and hardcode
   GitHub-dark hex, while the app ships a live light/dark/system toggle
   (`frontend/components/ui/theme.tsx`).
2. **The complexity treemap measures the wrong thing** and says so in its label.
   The backend sends `importance_score` (graph centrality) under a viz titled
   "Complexity Treemap — spot maintenance hotspots."
3. **Nothing is keyboard-accessible or screen-reader-visible.** No focusable
   nodes, no `role`/`aria-label`/`<title>` on any SVG. On touch there are no
   tooltips at all, because every tooltip is hover-triggered.

Strategy: **shared shell first.** Every piece of the shell already exists
somewhere in the repo — it just isn't shared. See Appendix B.

---

## Locked decisions

| # | Decision | Rationale |
|:--:|---|---|
| **D1** | Keep the name "Complexity Treemap." Backend must compute **real cyclomatic complexity**. | Name stays, so the metric has to match the label. |
| **D2** | **Area = LOC, color = cyclomatic.** Churn excluded. | Standard treemap encoding. Churn needs a git-log pass per file; the repo already has a "too much time consumption" history. |
| **D3** | Mind map **stays a horizontal left-to-right tree**. Rename the component file only; leave the `radial_mindmap` wire type alone. | Explicit user preference. Renaming the wire type touches backend + `VizContainer.tsx:16-23` for zero user-visible gain. |
| **D4** | **Responsive**, not desktop-only. | Explicit user preference. |
| **D5** | Drill-down uses a **shared N-segment breadcrumb** generalized from `components/graph/GraphBreadcrumb.tsx`. Retrofit `DependencyGraph` onto it. | Treemap nesting is arbitrarily deep; DependencyGraph's back button only works because its hierarchy is exactly 2 levels. |

---

## Progress

Status: `TODO` · `WIP` · `DONE` · `BLOCKED` · `SKIP`

| # | Task | Pri | Est (CC) | Deps | Status | Notes |
|:--:|---|:--:|:--:|:--:|:--:|---|
| T1 | Viz color tokens + fix `.viz-tooltip` | P1 | ~20m | — | **DONE** | Tokens + `lib/viz/tokens.ts`; all 7 viz files swept. Needs visual check in-app. |
| T2 | `VizShell` primitive | P1 | ~45m | T1 | **DONE** | Shell + 3 hooks + breadcrumb. DependencyGraph & DataFlowGraph migrated. |
| T3a | Backend: nest by directory, full paths, truncation flag | P1 | ~15m | — | **DONE** | + 11 tests, mock updated to match |
| T3b | Backend: real cyclomatic complexity | P1 | ~30m | T3a | **DONE** | `complexity.py` + 38 tests. Fixed a broken tree-sitter-python pin |
| T4 | Treemap rewrite on VizShell | P1 | ~40m | T1,T2,T3a | **DONE** | Nesting, dual encoding, legend, breadcrumb, tooltip. Includes QA-006 |
| T5 | Fix mind map join-key collision | ~~P1~~ **P2** | ~5m | — | TODO | Severity revised by QA — identity swap, not data loss. Fixture ready |
| T6 | Stop mind map auto-fit on every update | P1 | ~10m | — | TODO | Standalone, do anytime |
| T7 | Remove Architecture lie affordance | P1 | ~5m | — | TODO | Standalone, do anytime |
| T8 | ResizeObserver for mind map + neural net | P2 | ~15m | — | TODO | |
| T9 | Architecture retrofit onto VizShell | P2 | ~20m | T1,T2 | TODO | |
| T10 | Request timeout + human errors + actionable empty | P2 | ~15m | — | TODO | |
| T11 | `prefers-reduced-motion` across all viz | P2 | ~10m | T2 | TODO | |
| T12 | Keyboard nav + SVG semantics | P2 | ~40m | T2 | TODO | Partly done in T1: `aria-pressed` on toggles, 8px→10px badge label, contrast-safe `--viz-cat-ink`. Keyboard nav still outstanding. |
| T13 | Auto-render default viz, kill the idle card | P3 | ~15m | — | TODO | |
| T14 | Drop emoji from `VizContainer` title map | P3 | ~5m | — | TODO | |
| T15 | Write `DESIGN.md` for the viz system | P3 | ~15m | T1,T2 | TODO | |
| T16 | Responsive + touch | P2 | ~30m | T2,T4 | TODO | Scope widened by QA-001 — canvas is 7px at 375px, not just "small" |
| T17 | Fix infinite-loading dead-end on shared/bookmarked repo links | **P1** | ~20m | — | **DONE** | QA-002. `RepoStatePanel` + 19 tests. Also fixed sign-in return-to |
| T18 | Human error copy instead of raw backend strings | P2 | ~25m | — | TODO | QA-003. Widens T10 to `useRepoGraph` |

**Suggested order:** T1 → T2 → T3a → T4, with T5/T6/T7 dropped in whenever
(they're standalone one-file fixes; T5 and T6 are both in `RadialMindmap.tsx`
and total ~15 min).

**Quick wins if you have 20 minutes:** T5, T6, T7, T14.

### T1 as-built notes

- Tokens live in `frontend/app/globals.css` under both `:root` and `.dark`:
  `--viz-cat-1..8`, `--viz-cat-ink`, `--viz-seq-from/to`,
  `--viz-surface/ink/ink-dim/edge`. Dark values reproduce the previous
  hardcoded hex exactly, so **dark mode is visually unchanged** apart from the
  two deliberate contrast fixes below.
- `frontend/lib/viz/tokens.ts` is the accessor layer. **Read its header before
  using it** — the live-vs-concrete distinction matters: `cssVar()`/`catVar()`
  return `hsl(var(--x))` and follow the theme with no re-render, while
  `seqScale()`/`inkOnFill()` return concrete colors and require
  `useVizThemeVersion()` in the drawing effect's deps. `TreemapViz` is the
  worked example.
- **Two deliberate dark-mode visual changes**, both contrast fixes: module
  badge text flipped from white to `--viz-cat-ink` (white failed 4.5:1 on the
  lighter palette slots), and the "files" sublabel went 8px → 10px.
- `ArchitectureGraph` and `RadialMindmap` nodes now draw on `hsl(var(--card))`
  with a colored border and label, replacing fixed dark tinted fills. Their
  `fill-opacity` tweens were removed — they only made solid chips translucent.
- Deliberately **not** tokenized: `NeuralNetworkViz`'s `CATEGORY_COLORS`
  (12 remaining hex). It is a genuine categorical palette encoding layer type,
  with base/top/side face shading for the isometric render, and it reads
  correctly on both themes.
- Verified: `tsc --noEmit` clean, `next build` clean, `eslint` introduces zero
  new warnings (4 pre-existing ones on `main` remain). Tailwind 3.4.19 confirmed
  to emit `bg-[hsl(var(--viz-highlight)/0.18)]` correctly.
- **Not yet verified: actual light-mode rendering in the browser.** Needs the
  app running against an analyzed repo. Do this before starting T4.

### T2 as-built notes

New module `frontend/components/viz/`:

| File | Purpose |
|---|---|
| `VizShell.tsx` | Layout + chrome: zoom cluster, legend slot, tooltip, empty/error, a11y wrapper |
| `useVizCanvas.ts` | Container measurement (debounced ResizeObserver) |
| `useVizZoom.ts` | Zoom controller — `zoomIn/zoomOut/fitToView` + `+`/`-`/`0` keys |
| `useReducedMotion.ts` | OS reduced-motion subscription |
| `VizBreadcrumb.tsx` | N-segment breadcrumb (**D5**) |

- **Charts keep their own `d3.zoom` behavior** (scale extent and transform
  target are chart-specific) and call `zoom.register(svg, behavior, rootG)`
  inside the draw effect. The shell only drives it. This keeps the migration
  shallow — no draw logic was rewritten.
- **`DependencyGraph` and `DataFlowGraph` are migrated.** Both lost their
  duplicated zoom cluster, and both gained a legend they never had — the
  dependency graph had a 16-entry type map plus an 8-color module palette and
  no key at all.
- **`DependencyGraph`'s back button is now the shared breadcrumb** (D5), so the
  treemap will not need a second bespoke drill-down control.
- **Zoom buttons are 44px** (were 32px) with a visible `:focus-visible` ring,
  and `+`/`-`/`0` work once the chart has focus. Per-node keyboard traversal is
  still T12.
- **B6 fixed early**: the DataFlow particle loop now checks a `cancelled` flag
  set by the effect's cleanup. `isConnected` alone was insufficient — on
  re-render the old node can stay attached for a tick, orphaning a second loop
  that never stops. It is also skipped entirely under reduced motion.
- **Two React-compiler lint rules shaped the API**, worth knowing before adding
  hooks here (this repo enforces them as errors):
  - `useReducedMotion` uses `useSyncExternalStore`, not `useState`+`useEffect` —
    `set-state-in-effect` rejects the latter.
  - `useVizCanvas` returns a **callback ref named `attach`**, not a ref object,
    and `VizShell` destructures it (`const { attach } = canvas`) before use.
    `react-hooks/refs` rejects both a `.ref` property and any member expression
    in a `ref=` slot.
- Verified: `tsc --noEmit` clean, `next build` clean, `vitest` 11/11,
  `eslint` 0 errors (3 pre-existing warnings remain).
- **Not verified in-browser**, same caveat as T1.

### T3a as-built notes

New treemap payload shape (`GET /visualize/complexity/{repo_id}`):

```jsonc
{ "type": "treemap", "data": {
  "name": "<repo>", "path": "",
  "children": [ { "name": "src/api", "path": "src/api", "children": [
    { "name": "routes.ts", "path": "src/api/routes.ts",
      "value": 21000, "language": "TypeScript",
      "role": "Routes", "importance": 0.84 } ] } ],
  "meta": { "total": 312, "shown": 250, "truncated": true,
            "metric": "size", "metric_label": "File size (bytes)" } } }
```

Since T3b, leaves also carry `loc`, `complexity` and `complexity_source`, and
`meta` gains `color_metric` / `color_metric_label` / `measured`. An unmeasured
file omits `complexity` entirely rather than sending 0 — see the T3b notes.

- **Read `meta.metric`, never assume.** Area is `"size"`; `meta.color_metric`
  is `"cyclomatic"` once measured and `"none"` for analyses cached before T3b.
  The legend copy follows these fields — that is what keeps the "Complexity
  Treemap" name honest.
- **Single-child directory chains collapse.** `backend/codekavi/routes/` becomes
  one node named `backend/codekavi/routes` instead of three nested header bands
  that squeeze the tiles to nothing.
- **The root is deliberately never collapsed**, or a repo with everything under
  `src/` would rename its root to "src" and lose its identity. There is a test
  pinning this.
- Cap raised 80 → 250 (`MAX_TREEMAP_FILES`). `file_profiles` is pre-sorted by
  importance, so this keeps the most significant files, and `meta.truncated`
  now admits the cut instead of silently showing a third of the repo.
- Path separators are normalized once up front, so leaf `path` (what the
  tooltip shows) always matches the directory nodes built from it. This repo
  has prior Windows-path bugs; do not remove that normalization.
- `codekavi/test_visualize_treemap.py` covers the tree shape, chain collapse,
  the root invariant, Windows separators, and that the build-time `_dirs` index
  never reaches the wire. **11 tests.**
- `frontend/lib/mockData.ts` `case "complexity"` was updated to the new shape,
  so `/repo/dev-mock-repo/visualize?type=complexity` exercises real T4 data
  without a backend. Its values are now deterministic — `Math.random()` made
  the layout reshuffle on every regenerate, which makes visual comparison
  impossible.
- **Dev-env note:** `backend/.venv` did not have dev dependencies. `pytest` and
  `pytest-asyncio` were installed into it; `ruff` and `mypy` are still missing
  (pre-commit supplies its own).
- Verified: backend `pytest` 15/15, frontend `vitest` 11/11, `next build` clean.

---

## How to see this running

**Correct URL (both parts required):**

```
/repo/dev-mock-repo/visualize?type=<t>&dev=true
```

`lib/api.ts` short-circuits on the repo id, but `RepoProvider` gates the mock on
`?dev=true`. Since T17, omitting the flag no longer hangs — you get the "Sign in
to open this analysis" recovery screen instead, which is correct but is not the
mock. Frontend only — `npm run dev`, no backend, no Redis, no auth.

All six `type` values work against the mock as of 2026-08-02.

## QA session — 2026-08-02

Full report: `.gstack/qa-reports/qa-report-codekavi-2026-08-02.md` (11 screenshots).
Health score **77/100**. Ran after T3a, before T4.

**Confirmed working:** T1's core goal holds — Treemap, Architecture, and Mind Map
render correctly in light mode instead of as dark slabs. T2's legend, 44px zoom
cluster, themed toggles, and fit-to-view all verified in-browser. Zero console
errors outside the Graph page's auth 401s.

**Fed back into this plan:** T17 and T18 added · T16 scope widened (QA-001) ·
T5/B1 severity revised P1 → P2 · T4 gains the ramp-domain fix (QA-006).

**Fixed during the session:** the two mock contracts below.

**Fixed during the session:** the two mock contracts below, plus **QA-004**
(dependency graph now frames itself on first render — see below).

**Still open, not yet in this plan** (all from the QA report):
QA-005 nav tabs truncated to two characters at 1280px ·
QA-007 "Mind Map" clipped out of the sidebar at 720px height ·
QA-009 duplicate "Generate Report" buttons.

### QA-004 — dependency graph auto-fit (fixed)

ELK centres the graph but never scales it, so any graph taller than the viewport
rendered clipped at both ends until the user found the "Fit to view" button.
`DataFlowGraph` and `ArchitectureGraph` both already framed themselves after
layout; `DependencyGraph` never did.

Two layout paths, two framing points:

- **ELK** — positions are final the moment `runElkLayout` resolves, so it frames
  immediately after `draw(positions)`.
- **Force** — the simulation keeps moving for hundreds of ticks, so framing on
  return would fit the initial random scatter. It frames on `sim.on("end")`
  instead, wired from inside `draw()` where `sim` actually exists. Wiring it
  outside does not typecheck: TS narrows `sim` to `null` after its declaration
  because it is only assigned inside `draw`.

`useVizZoom.fitToView` now takes `{ animate }`. The initial fit passes `false` —
tweening from the identity transform on first paint reads as an unrequested
zoom rather than a chart appearing. User-triggered fits keep the tween.

### Mock contracts — fixed, do not regress

`frontend/lib/mockData.ts` had drifted from the backend and was producing false
QA results. Both are now pinned to the real response shapes:

- **`mindmap`** must return `{ root: {...} }`. The backend sends
  `{"data": {"root": root}}` (`visualize.py:526-529`) and
  `isEmptyVisualization` requires `data.root.children`
  (`FocusedVisualization.tsx:457-460`). The old mock returned the root bare, so
  the mind map *always* reported "No Data Available" — a false failure that
  would have blocked T5 and T6 verification.
- **`dataflow`** must supply `type` (`io|process|transform|data_store`), `tier`,
  and `shape`. The old mock predated the semantic redesign: without `tier` all
  nodes collapsed into one unreadable column, and with unknown `type` values the
  legend silently rendered nothing.

Two robustness gaps that fell out of this and are **not yet fixed**:

- `DataFlowGraph` degrades silently when `tier` is absent — everything lands in
  column 0. A cached analysis from before the tier feature would do this to a
  real user. Consider assigning tiers by topological depth as a fallback.
- `VizLegend` renders nothing when no node type matches, so a contract mismatch
  disappears instead of showing. Consider a visible fallback.

## T1 — Viz color tokens

**Problem.** `globals.css` already defines a full token system with light and
dark values, including a purpose-built `--viz-highlight` (`:45`, `:81`). Three of
five viz files ignore it. `.viz-tooltip` (`globals.css:322-333`) is itself
hardcoded `background:#21262d; color:#e6edf3` — a dark tooltip in light mode.

**Files:** `frontend/app/globals.css`, new `frontend/lib/viz/tokens.ts`

**Do:**

1. Add to `globals.css` under **both** `:root` and `.dark`:

```css
/* categorical — node/module/depth colors */
--viz-cat-1 … --viz-cat-8
/* sequential — treemap heat ramp */
--viz-seq-from  --viz-seq-to
/* surfaces */
--viz-surface  --viz-ink  --viz-ink-dim  --viz-edge
```

Light values must be genuinely light. Dark values can stay close to the current
GitHub-dark palette so nothing regresses visually in dark mode.

2. Fix `.viz-tooltip` to use `hsl(var(--viz-surface))` / `hsl(var(--viz-ink))` /
   `hsl(var(--viz-edge))`.

3. Create `lib/viz/tokens.ts` exporting typed accessors so D3 reads
   `catColor(i)` / `seqScale(t)` instead of literal hex. Read computed custom
   properties off `document.documentElement` so the values follow the theme.

**Reference:** `viz-mockups.html` (delivered in review) implements exactly this
ramp and reads it back with `getComputedStyle` — lift the `heat()` function.

**Verify:** toggle to light mode, open all five visualizations, no dark slabs, no
white-on-white text.

**Done when:** zero hardcoded hex remains in any file under
`components/report/viz/` except deliberately categorical palettes
(`NeuralNetworkViz` layer categories), and those still pass contrast in both
themes.

---

## T2 — `VizShell` primitive

**Problem.** Chrome is inconsistent across the five: zoom cluster on two, absent
on three; view toggles on one. The cluster is **byte-identical** in
`DependencyGraph.tsx:880-910` and `DataFlowGraph.tsx:440-470`. That duplication
is the shell trying to be born.

**Files:** new `frontend/components/viz/VizShell.tsx`, `useVizCanvas.ts`,
`VizBreadcrumb.tsx`

**Provide:**

| Piece | Lift from |
|---|---|
| `useVizCanvas()` — ref + debounced ResizeObserver → `{width,height}` | `DependencyGraph.tsx:294-311` |
| Zoom cluster + `getBBox()` fit-to-view | `DependencyGraph.tsx:762-791, 880-910` |
| `<VizShell.Tooltip>` — container-relative, edge collision | `DependencyGraph.tsx:579-582, 915-988` |
| `<VizShell.Legend>` — fixed slot, same position every viz | `NeuralNetworkViz.tsx:477-503` |
| `<VizShell.Empty>` / `<VizShell.Error>` | copy from `VizContainer.tsx:80` |
| `<VizBreadcrumb>` — N segments (per **D5**) | generalize `components/graph/GraphBreadcrumb.tsx` |
| SVG a11y scaffold: `role="img"`, `aria-label`, `<title>`/`<desc>`, roving tabindex | new |
| `useReducedMotion()` context | new |

**Constraints:**
- Zoom buttons **44px minimum** (currently `w-8 h-8` = 32px).
- Visible `:focus-visible` ring on every control.
- Legend is not optional. A viz that encodes meaning in color renders a legend.

**Verify:** migrate `DependencyGraph` and `DataFlowGraph` first — they must
render identically to before. That proves the shell before you build on it.

**Done when:** the duplicated zoom cluster is deleted from both files and both
graphs consume `VizShell`.

---

## T3a — Backend: hierarchy + paths (cheap)

**Problem.** `backend/codekavi/routes/visualize.py:144-170`:

```python
for fp in classification[:80]:
    children.append({
        "name": os.path.basename(fp.get("path", "")),   # path discarded
        "value": fp.get("importance_score", 1),          # not complexity
    })
```

Flat list of 80 leaves. A tile labeled `index.ts` could be any of five files.
Truncation is silent.

**Good news:** `classifier.py:476-484` already emits `path`, `size`, and
`language`. Stage 1 needs **no new computation.**

**Do:**
1. Stop calling `basename`. Keep the full `path` on each leaf.
2. Nest by directory: split each path and build a real tree instead of one flat
   `children` array.
3. Use `size` for area (interim, until T3b).
4. Add `{"truncated": bool, "total": N, "shown": N}` to the payload.

**Verify:** response has nested `children`; every leaf carries `path`; the
truncation flag is present and correct on a repo with >80 files.

---

## T3b — Backend: real cyclomatic complexity

**Per D1/D2.** The name stays, so the metric must be real.

**Good news:** `backend/requirements.in:25-28` already has
`tree-sitter`, `tree-sitter-javascript`, `tree-sitter-typescript`,
`tree-sitter-python`. No new dependency.

**Do:**
1. Add a complexity pass that counts branching nodes per file via tree-sitter:
   `if`, `for`, `while`, `case`, `catch`, `&&`, `||`, ternary. Cyclomatic =
   branch count + 1.
2. Emit per leaf: `{path, loc, complexity, complexity_source}` where
   `complexity_source` is `"cyclomatic"` or `"size_fallback"`.
3. For languages without a parser, fall back to `size` and mark it.
4. **Surface the fallback in the legend** (T4) — e.g. *"3 files sized by bytes —
   no parser for .rs"*. This is what keeps the "Complexity" name honest.

**Watch:** this adds a parse pass. Cache it alongside the existing analysis
result; do not recompute per request. The repo has prior history with slow
analysis.

**Verify:** a file with heavy branching scores higher than a long-but-linear
file. Spot-check `DependencyGraph.tsx` (should be the hottest frontend file)
against `NeuralNetworkViz.tsx` (long, geometry-heavy, low branching).

### T3b as-built notes

**New module** `backend/codekavi/complexity.py`. McCabe: count decision points
per language grammar, add one. Python / JS / JSX / TS / TSX. Thread-local
parsers, same arrangement `analyzer.py` uses, because tree-sitter `Parser` and
`Query` objects mutate on use and classification runs in a thread pool.

**Deviation from the plan, deliberate: area stays BYTES, not LOC.** The plan
said area = LOC. Building it that way produced a chart where source files were
sized by lines and images, lockfiles and manifests were sized by bytes — two
different units in the one channel a treemap must get right. Area is now bytes
for every file, LOC rides along in the tooltip, and only the *color* channel
changed. The complexity claim in the name is carried by color, so nothing is
lost.

**The metric mix problem, and why unmeasured files are grey.** A `.go` file has
no parser. Falling back to its byte count would put ~800 on a scale whose real
values run 1–58, stretching the domain by a factor of ~20 and flattening every
genuine hotspot to the same cold shade. So an unmeasured file gets **no
`complexity` key at all** — the frontend leaves it out of the domain, paints it
a flat neutral outside the ramp, labels the tile "not measured", and adds a
"Not measured" key to the legend. Absent means unknown, never zero.

**Found and fixed: `tree-sitter-python==0.25.0` could never load.** It is
ABI-incompatible with the pinned `tree-sitter==0.21.3` core — `language()`
returns a PyCapsule that the 0.21 `Language()` constructor rejects outright.
Nothing imported it, so the breakage was invisible. Repinned to `0.21.0` in
`requirements.in` and `requirements.txt`.

**Why tree-sitter for Python rather than stdlib `ast`.** `ast.parse` raises on
any file whose syntax the runtime does not accept, so a Python 2 repo would
report zero complexity for every file. tree-sitter recovers locally and still
counts the branches it can see. Verified: `print "hello"` + `if x and y` scores
3, not a fallback.

**Cost.** One parse per source file, during `/analyze` only, stored on the file
profile and cached with the rest of the analysis. Visualization requests parse
nothing. Full content usually comes free from `FileEntry.content`, which the
traverser pre-loads for files under 100KB — the shared `content_cache` holds
only the first 4KB and is useless here, since most control flow lives past byte
4096. Files over 512KB are skipped: a minified bundle is not a hotspot reading.

**Verified as specified.** `DependencyGraph.tsx` cx 135 vs `NeuralNetworkViz.tsx`
cx 35 — 15.5 vs 7.3 decisions per 100 lines, so the long geometry-heavy file
does read cooler. Synthetic check: a 3019-byte linear `.ts` scores 1 while a
322-byte branchy `.py` scores 21 — under the old size-only chart the linear file
was the hottest thing on screen.

**Also fixed:** the sidebar described this chart as "complexity by importance
score". Importance is graph centrality; the chart has never drawn it. Now reads
"Files sized by bytes, colored by cyclomatic complexity."

**Not counted, on purpose:** `else`/`default` (the `if`/`switch` already
accounts for both paths) and Python `assert` (JS has no equivalent, so counting
it would make Python files read systematically hotter on a chart that colors
both languages from one scale).

**Verification:** 58 backend tests (38 new), 11 frontend tests, `tsc` clean,
`next build` clean, eslint 0 errors. In-browser in both themes: legend reads
*"CYCLOMATIC COMPLEXITY 1 → 58 · Not measured · Tile area = file size (bytes) ·
5 files not measured (no parser for Go). Showing 58 of 76 files."* Confirmed a
tile keeps its exact fill across a drill, and confirmed the pre-T3b path still
renders — legend falls back to "FILE SIZE (BYTES)" with *"Color is file size,
not complexity — re-run the analysis to measure it."*

---

## T4 — Treemap rewrite

**Problem.** 2/10. Zero tokens, no legend, no hierarchy, no drill-down, tooltip
reads `Value: 42`, tooltip positioned with `event.offsetX` (relative to the
hovered `<rect>`, cross-browser inconsistent).

**Files:** `frontend/components/report/viz/TreemapViz.tsx` (162 lines — this is a
rewrite, not a patch)

**Build:**
- **Nested directory groups** with a header band per group. The point of a
  treemap is seeing which *folder* is heavy.
- **Two encodings:** area = LOC, color = cyclomatic (**D2**). A big pale tile is
  boring-but-long; a small hot tile is the file that bites you.
- **Legend** with numeric endpoints + the `size_fallback` note from T3b.
- **Breadcrumb** (`VizBreadcrumb`, **D5**) for 4-deep nesting.
- **Tooltip:** full path (mono), complexity, LOC, and a one-line *why this is a
  hotspot*. `cx 84` alone means nothing.
- Tokens throughout; container-relative tooltip from `VizShell`.

**Reference:** `viz-mockups.html` — the squarified layout is ~40 lines and
directly liftable.

**Stretch:** the "why" line is a natural fit for the existing
`/explain/visualization` endpoint, per-file.

**Verify:** light + dark; hover any tile and see a disambiguating full path;
drill three levels and back via breadcrumb.

---

### T4 as-built notes

- **Reads `meta.metric`, never assumes.** The legend label, tile sublabel,
  tooltip rows, and SVG description all derive from `meta.metric_label` and
  per-leaf `complexity_source`. Today it renders "File size (bytes)" and says
  *"Color is file size, not complexity yet."* in the legend. When T3b ships
  complexity the copy follows automatically — **no code change needed, and no
  moment where the chart lies.**
- **Two encodings.** Area = the size metric; color = complexity when present,
  falling back to the size metric when not. `stats.hasComplexity` gates it.
- **QA-006 fixed.** `seqScale` now takes an explicit `[min, max]` domain
  instead of `[0, max]`, and gamma defaults to linear. The 0-anchored domain
  left the cold half of the ramp permanently unused so everything read hot; the
  gamma had been compensating for that. The legend prints the same two endpoints
  the scale uses, so "hot" is now a claim the reader can check.
- **The color domain spans the whole repo, not the drilled subtree.** Rescaling
  per drill would recolor identical files as you navigate, so a file could read
  hot inside a calm directory and cold one level up. Verified: `Component0`
  keeps its exact color after drilling into `src/components`.
- **Two new VizShell slots — `header` and `footer`** — that reserve space rather
  than overlay. A space-filling chart has no whitespace to float chrome over:
  the inset legend covered two `services` tiles and the floating breadcrumb
  covered the top-left tile's label. Node-link charts keep the overlay `legend`
  slot. `useVizCanvas` now measures the **chart area**, not the outer wrapper,
  so reserved strips shrink the canvas and tooltip coordinates still line up.
- **Tooltip** shows the full path (`src/components/Component0.tsx`), the metric,
  language, and a derived one-line note. `hotspotNote` computes from p90 and LOC
  density rather than inventing prose — `cx 84` alone tells a reader nothing.
- **Still overlapping:** the zoom cluster sits over the bottom-right tiles.
  Kept for chrome consistency across all five charts; revisit if it bothers you.
- Verified in-browser in both themes: nesting, drill-down, breadcrumb-back,
  tooltip, footer legend. `tsc` clean · `next build` clean · `vitest` 11/11 ·
  `eslint` 0 errors across `components/viz`, `components/report/viz`, `lib/viz`.

**Pre-existing lint error, not from this work:** `components/graph/TourPanel.tsx:84`
trips `react-hooks/set-state-in-effect`. Untouched on this branch — it surfaced
only because the lint scope was widened. Same fix shape as `useReducedMotion`
in T2.

---

## T5 — Mind map join-key collision *(P2, standalone)*

**Bug.** `RadialMindmap.tsx:157,195` keys the D3 data-join on
`d.data.id || d.data.name || d.data.label`. The backend
(`visualize.py:437`) sets file-node `id` to the **bare filename**, so two roles
both containing `index.ts` produce duplicate keys.

**Symptom corrected by QA (2026-08-02).** The original wording here said nodes
"merge or vanish on expand." That is wrong, and the distinction matters. Measured
behavior with the new fixture: expanding two roles that share `index.ts` renders
**both** nodes (12 total, 2 × `index.ts`), and collapsing one leaves the other's
subtree intact. No data is lost.

What actually happens is **identity swapping**. D3's `bindKey` matches the first
datum to the existing keyed node and treats the second as an enter — so on the
next update a node originally bound to Routes gets re-bound to Models. Observed
directly: after collapsing Routes, Models' DOM order changed from
`User.ts, Order.ts, index.ts` to `index.ts, User.ts, Order.ts`, meaning the
surviving node was the one previously belonging to Routes.

Consequences are real but narrower than "data loss": nodes tween in from the
wrong branch during the 400ms transition, and expand/collapse state stored on
`_children` can leak between same-named nodes.

**Severity revised P1 → P2.** Still worth fixing (it is a two-line change and
the animation artifact is visible), but it does not lose data and should not
block T4.

**Fix:** key on a stable unique path. Either send a real path from the backend
or compose `depth + parent + name` client-side.

**Verify:** `?type=mindmap&dev=true` — the mock fixture now ships `index.ts`
under three roles and `utils.ts` under two, on purpose. Expand Routes and Models,
then collapse Routes. Every node stays put and nothing tweens in from another
branch.

---

## T6 — Mind map viewport thrash *(P1, standalone)*

**Bug.** `RadialMindmap.tsx:357-359` calls `fitToScreen` inside **every**
`update()` on a 50ms timeout. Each expand/collapse re-zooms and re-centers the
whole map, destroying the user's position and overriding their manual zoom.

**Fix:** fit once on mount and on explicit "Fit to view" only.

**Verify:** expand three nodes in a row; the viewport does not move.

---

## T7 — Architecture lie affordance *(P1, standalone)*

**Bug.** `ArchitectureGraph.tsx:241` sets `.style("cursor","pointer")` on nodes
that have **no click handler**.

**Fix:** either wire click to a detail panel (preferred — matches DataFlow's
`selected` popover pattern) or drop the cursor style.

**Verify:** cursor state matches actual behavior.

---

## T8 — Missing ResizeObserver

- `RadialMindmap.tsx:427` — `renderTree` deps are `[root]` only. **No
  ResizeObserver at all.** Collapse the sidebar and it keeps stale mount-time
  dimensions.
- `NeuralNetworkViz.tsx:375-377` — listens to `window` resize, so it misses
  sidebar collapse entirely (the container changes, the window doesn't).

**Fix:** both consume `useVizCanvas()` from T2.

**Verify:** collapse the sidebar with each viz open; both relayout.

---

## T9 — Architecture retrofit

**Problems.** No zoom controls, no tooltip (only a native SVG `<title>`), no
legend, and auto-fit uses **hardcoded guessed bbox constants**
(`ArchitectureGraph.tsx:299-309`: `bboxX=10, bboxY=30, bboxW=width-20`) instead
of `g.getBBox()`. The correct pattern is already in-repo at
`DataFlowGraph.tsx:413`.

**Fix:** migrate onto `VizShell`; replace the guessed bbox with real `getBBox()`.

**Verify:** fit-to-view centers correctly on a repo with few modules.

---

## T10 — States: timeout, human errors, actionable empty

Interaction states are the strongest existing dimension (6/10 —
`FocusedVisualization.tsx:165-263` covers idle/loading/error/success/empty).
Gaps:

| Gap | Location | Fix |
|---|---|---|
| **No timeout** — backend hangs, spinner spins forever | `useVisualization.ts:30-76` | `AbortController` + ~45s; "Taking longer than usual" transition |
| Raw `err.message` shown to users | `useVisualization.ts:69` → `:221` | map to human copy |
| Empty state is a dead end | `FocusedVisualization.tsx:241-255` | primary action + warmth; reuse the better copy at `VizContainer.tsx:80` |
| Diagnostics looks like a footnote | `FocusedVisualization.tsx:420-433` | real inline notice; "63% of imports resolved" is not a caption |
| Cache never invalidates | `useVisualization.ts:34` | invalidate on re-analysis |

**Verify:** kill the backend mid-request; the user sees human copy and a retry
path.

---

## T11 — `prefers-reduced-motion`

**No guard exists anywhere.**

- `DataFlowGraph.tsx:282-303` — particle animation `loop()` re-arms itself via
  `.on("end", loop)`, guarded only by `pathNode.isConnected`. Vestibular trigger
  **and** permanent CPU/battery drain.
- `RadialMindmap.tsx` — 400ms transitions + 500ms auto-fit zoom per click.
- `NeuralNetworkViz.tsx:289-292` — staggered entrance.

**Fix:** all consume `useReducedMotion()` from T2. Under reduced motion:
no particles, no entrance stagger, instant transitions.

**Verify:** OS reduced-motion on → no particles, no stagger.

---

## T12 — Keyboard nav + SVG semantics

**Today: zero.** No focusable nodes, no tab order, no `role`, no `aria-label`,
no `<title>`/`<desc>` on any SVG root. Five visualizations are completely
invisible to assistive tech. `DependencyGraph`'s entire drill-down feature
(`:575`) is mouse-only. The only text alternative is AI Insights — opt-in,
LLM-gated, quota-limited.

**Fix (via T2 scaffold):**
- `role="img"` + `aria-labelledby` → `<title>` and `<desc>` on every SVG root.
- Roving tabindex over nodes; arrows to move, Enter to drill down, Escape to
  go up.
- `aria-label` per node carrying its data ("DependencyGraph.tsx, complexity 84,
  992 lines").
- Fix type below the legibility floor: `font-size: 8`
  (`DependencyGraph.tsx:558`), `font-size: 9` (`NeuralNetworkViz.tsx:267,334`).
- Fix `rgba(255,255,255,0.7)` on saturated fills (`DependencyGraph.tsx:559`) —
  fails 4.5:1 against lighter palette entries.
- `aria-pressed` on the Module/File toggle.

**Verify:** tab into a graph, arrow between nodes, Enter to drill; VoiceOver or
NVDA announces the chart and node data.

---

## T13 — Auto-render the default viz

**Problem.** Every viz gates behind an idle card with a "Generate Visualization"
button (`FocusedVisualization.tsx:165-189`). But the complexity and architecture
endpoints are **zero-LLM-cost** (`visualize.py:152, 187`). You are gating a free,
instant render behind a click at exactly the moment you're trying to impress.

**Fix:** auto-generate the default viz on mount. Replace the idle card with a
ghosted preview of the graph, not a card asking permission.

**Bonus:** removes an AI-slop hit — the card's `w-24 h-24 rounded-3xl
bg-gradient-to-br` icon tile (`:173-175`) is the "icon in colored rounded
square, centered" pattern.

---

## T14 — Drop the emoji *(P3, 5 min)*

`VizContainer.tsx:16-23` uses 🏗️ 🔗 🧠 🔥 🌊 in the title map. Emoji-as-design-
element reads as AI-generated. Use product language.

---

## T15 — `DESIGN.md`

No DESIGN.md exists, which is why there are **five unrelated color
philosophies** across five files: GitHub-dark neons (Dependency), pastel-on-dark
(Architecture), muted depth ramp (Mindmap), sequential orange heat (Treemap),
PlotNeuralNet material (NeuralNet).

**Document:** palette semantics, chrome geometry (where zoom/legend/breadcrumb
live), legend rules, motion budget, a11y floor (contrast, target size, min type
size).

**Done when:** a new viz can be built from the doc without reading existing viz
code.

---

## T17 — Infinite-loading dead-end *(P1, standalone)*

**From QA-002.** `RepoProvider.tsx:62-165` resolves `repoData` from
`sessionStorage`, or from `?dev=true` in development. If neither is present the
effect **ends with no else branch**, so `repoData` stays `null` forever. Every
consumer page then renders "Loading repository data…" indefinitely: no error, no
retry, no redirect, no timeout.

`sessionStorage` is per-tab and cleared on tab close, so this is not an edge
case — **bookmarking a repo URL, sharing a link, or reopening in a new tab all
produce a permanent dead end.**

**Repro:** open `/repo/<any-id>/visualize` in a fresh tab. Waited 20s+, no change.

**Fix:** add the missing terminal branch. When there is no session metadata and
no dev flag, attempt `restoreRepo(repoId)` directly; on 404 or failure, set an
error state and render a real recovery path ("This analysis has expired —
re-analyze this repository") rather than an eternal spinner.

**Verify:** open a repo URL in a private window. You get an actionable screen
within a few seconds, never an indefinite loading message.

### T17 as-built notes

**The plan understated the failure.** The missing `else` was real, but a cold
load has three distinct ways to fail and the code could not tell them apart:
`lib/api.ts` `restoreRepo` returned `AnalyzeResponse | null`, folding "the cache
expired" (404) together with "the network died", and *throwing* raw backend text
on 401. Since `/restore` is authenticated (`analyze.py:859`), **a signed-out
visitor following a shared link is the single most likely case** — and the plan's
suggested copy, "This analysis has expired," would have been a lie for them.

So `restoreRepo` now returns a discriminated `RestoreResult` —
`ok` / `expired` / `unauthenticated` / `unreachable` — and each maps to its own
recovery. Offering "Re-analyze" to someone whose backend is down aims them at an
operation that fails the same way; offering it to someone signed out is worse.

**Resolution order** in `RepoProvider`, every branch terminating:
1. `?dev=true` (development only) — mock data, no network. This now runs *before*
   the `sessionStorage` check rather than after, so an explicit dev override
   wins over stale tab metadata.
2. This tab's session metadata — restore, and on a cache miss degrade to the
   metadata with `needsReanalysis` (unchanged behaviour; chat outlives the
   analysis cache because the embeddings are in Zilliz).
3. **New:** a cold restore straight from the backend cache chain. Most shared
   links land here and simply work — the analysis is usually still cached.
4. Otherwise `unavailable`, with a reason.

**Deviation from the plan's "degrade" default.** With stored metadata *and* a
401, the old code degraded to minimal data. It now shows the sign-in screen:
chat would fail identically, so degrading only hides the real problem.

**What the fix needed that the plan didn't mention:**
- `getSessionByRepoId` (`lib/sessions.ts`) — a repo id in a URL is opaque, so
  recovering `github_url` from Supabase is what gives "Re-analyze" a target.
  Without it the expired screen can only say "go away and start over".
- **Re-analysis mints a new `repo_id`** (`cloner.py:102` is `uuid4`, and the
  signature dedupe in `cache.py` can only reuse an id whose cache entry still
  exists — which by definition it doesn't here). So `RepoStatePanel` navigates
  to `/repo/<new-id>/<same-view>` on completion. Landing the user back on the
  URL that just failed would rebuild the dead end on their next reload.
- `AbortSignal.timeout(20s)` on the restore. A backend that accepts the socket
  and never answers would otherwise reproduce the original bug through a
  different door.
- A `useRef` guard so StrictMode's double-invoke doesn't spend two of the
  endpoint's 30 requests/min on one page load.
- `/login?next=` → `/auth/callback?next=`. The callback already read `next`;
  nothing ever sent it. Without this, "Sign in" drops you on the dashboard
  having lost the link you followed. Both ends reject non-same-origin paths.
- The **graph page** is gated too. `/repo/<id>` redirects to `/graph`, so that
  is where most shared links actually land — fixing only `/visualize` would have
  left the common case broken. It keeps its independent fast path and defers
  only when the repo is known to be unloadable.

**Deliberately not done:** `GraphCanvas` still renders raw backend strings on its
own fetch failures. That is T18/QA-003 and it is a different hook.

**Verified.** 30 frontend tests (19 new: 11 on provider resolution, 8 on the
restore taxonomy), `tsc`, `eslint` and `next build` all clean. In-browser on a
cold tab at `/repo/<unknown-id>/{visualize,graph,chat,report}`: all four reach
"Sign in to open this analysis" with `?next=` set correctly, in both themes, no
console errors, and **no request sent** — the signed-out short-circuit skips the
round trip. The `expired` and `unreachable` panels were confirmed by temporarily
forcing each state. `?dev=true` still bypasses cleanly.

**Not verified end-to-end:** the successful cold-restore path and the re-analyze
completion hand-off both need a running backend and a signed-in Supabase session;
they are covered by unit tests only. Re-analysis also runs through
`AnalysisProgress` (streaming), so it shows real staged progress rather than the
report page's bare spinner.

---

## T18 — Human error copy *(from QA-003)*

**From QA-003.** The Graph page renders `Missing Authorization header.` in red,
centered, as the entire page state, alongside two `401`s in the console. A user
has no idea what that means; there is no sign-in prompt and no retry.

This is the same defect class as T10 but on a different hook, so **T10's scope
widens**: fix `useRepoGraph` alongside `useVisualization.ts:69`.

**Fix:** map backend failures to human copy at the hook boundary. Auth failures
in particular should offer sign-in, not print the header name that was missing.
Never render `err.message` directly.

**Verify:** hit the Graph page unauthenticated. You get "Sign in to view this
graph" with a working action, not a transport-layer string.

---

## T16 — Responsive + touch *(per D4)*

**Problems.** Fixed `NODE_W = 150`, `nodeW = 140`, `BLOCK_GAP = 85`. At 375px the
architecture lane math yields `nodesPerRow = 2`, producing a very tall column
that auto-fits down to a scale where 11px labels render at ~3px. And **every
interaction is hover or drag — on touch there are no tooltips at all** on
Treemap, Mindmap, Architecture, or Dependency.

**Fix:**
- **Tap-to-pin tooltips** replacing hover on coarse pointers
  (`@media (pointer: coarse)` / `matchMedia`).
- 44px touch targets (covered by T2).
- Breakpoint-aware node sizing rather than fixed constants.
- Simplified small-screen default: treemap shows top-level directories only
  until tapped.

**Verify:** 375px viewport, all five viz legible and every tooltip reachable by
tap.

---

## Appendix A — Confirmed defects

| # | Sev | Defect | Location | Task |
|:--:|:--:|---|---|:--:|
| B1 | ~~P1~~ P2 | D3 join key collides on bare filenames — identity swap between branches, not data loss (revised by QA 2026-08-02) | `RadialMindmap.tsx:157,195` + `visualize.py:437` | T5 |
| B2 | P1 | `fitToScreen` inside every `update()` | `RadialMindmap.tsx:357-359` | T6 |
| B3 | P1 | `cursor:pointer` with no click handler | `ArchitectureGraph.tsx:241` | T7 |
| B4 | P2 | Guessed bbox constants instead of `getBBox()` | `ArchitectureGraph.tsx:299-309` | T9 |
| B5 | P2 | Tooltip uses `event.offsetX` (wrong origin, cross-browser inconsistent) | `TreemapViz.tsx:96-107`, `RadialMindmap.tsx:313-326` | T4, T2 |
| B6 | P2 | Particle `loop()` re-arms forever, no reduced-motion guard | `DataFlowGraph.tsx:290-302` | T11 |
| B7 | P3 | `generate()` early-returns on cache hit with no state change → button silently no-ops | `useVisualization.ts:34` | T10 |

## Appendix B — Reuse, don't rebuild

| Asset | Location |
|---|---|
| Debounced ResizeObserver | `DependencyGraph.tsx:294-311` |
| Zoom cluster + `getBBox()` fit-to-view | `DependencyGraph.tsx:762-791, 880-910` |
| Container-relative tooltip w/ edge collision | `DependencyGraph.tsx:579-582, 915-988` |
| Full interaction-state machine | `FocusedVisualization.tsx:165-263` |
| Helpful empty-state copy | `VizContainer.tsx:80` |
| Working legend | `NeuralNetworkViz.tsx:477-503` |
| Breadcrumb w/ correct a11y semantics | `components/graph/GraphBreadcrumb.tsx` |
| Theme tokens incl. `--viz-highlight` | `globals.css:45, 81` |
| tree-sitter parsers (JS/TS/Python) | `backend/requirements.in:25-28` |
| `path` / `size` / `language` per file | `backend/codekavi/classifier.py:476-484` |

## Appendix C — Out of scope

- **Rewriting `DependencyGraph`.** It's the best thing here. It becomes the
  template, not the target.
- **Replacing D3 with a chart library.** The custom D3 is a differentiator.
- **A 3D/WebGL renderer for large graphs.** No evidence of a node-count ceiling
  being hit yet.
- **Renaming the `radial_mindmap` wire type** (per **D3**) — component file
  only.

## Appendix D — Scores to beat

| Pass | Before | Target |
|---|:--:|:--:|
| Information Architecture | 4/10 | 9 |
| Interaction States | 6/10 | 9 |
| User Journey | 5/10 | 8 |
| AI Slop Risk | 7/10 | 9 |
| Design System Alignment | 3/10 | 9 |
| Responsive & Accessibility | 2/10 | 8 |
| **Overall** | **5/10** | **9** |

Re-run `/plan-design-review` after T4 to re-score.
