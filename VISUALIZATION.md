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
| T3a | Backend: nest by directory, full paths, truncation flag | P1 | ~15m | — | TODO | Nearly free — fields already exist |
| T3b | Backend: real cyclomatic complexity | P1 | ~30m | T3a | TODO | tree-sitter already a dep |
| T4 | Treemap rewrite on VizShell | P1 | ~40m | T1,T2,T3a | TODO | |
| T5 | Fix mind map join-key collision | P1 | ~5m | — | TODO | Standalone, do anytime |
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
| T16 | Responsive + touch | P2 | ~30m | T2,T4 | TODO | |

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

---

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

## T5 — Mind map join-key collision *(P1, standalone)*

**Bug.** `RadialMindmap.tsx:157,195` keys the D3 data-join on
`d.data.id || d.data.name || d.data.label`. The backend
(`visualize.py:437`) sets file-node `id` to the **bare filename**. Two roles
both containing `index.ts` produce duplicate keys → nodes merge or vanish on
expand.

**Fix:** key on a stable unique path. Either send a real path from the backend
or compose `depth + parent + name` client-side.

**Verify:** analyze a repo with the same filename under two roles, expand both,
all nodes persist.

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
| B1 | P1 | D3 join key collides on bare filenames | `RadialMindmap.tsx:157,195` + `visualize.py:437` | T5 |
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
