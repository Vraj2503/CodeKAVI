# Visualization design system

Everything under `components/report/viz/` follows this. It exists because there
was no such document, and the result was **five unrelated colour philosophies
across five files** — GitHub-dark neons in `DependencyGraph`, pastel-on-dark in
`ArchitectureGraph`, a muted depth ramp in `RadialMindmap`, sequential orange in
`TreemapViz`, PlotNeuralNet material in `NeuralNetworkViz` — three of which
broke outright in light mode.

**The bar: you should be able to build a new chart from this page without
reading any existing chart's source.** If you had to go read one, that is a bug
in this document; fix it here.

---

## 1. The one rule

> **A chart may only claim what it can show.**

Everything below is downstream of that.

- The complexity treemap is named for cyclomatic complexity, so the backend
  computes cyclomatic complexity (`backend/codekavi/complexity.py`). It does not
  colour by "importance" and call it complexity.
- A file with no parser has **no `complexity` key at all** — not `0`. It renders
  a flat neutral outside the ramp, is excluded from the colour domain, is
  labelled "not measured", and gets its own legend key. Absent means unknown.
- The legend prints the same two endpoints the scale actually uses, so "hot" is
  a claim the reader can check.
- Chart copy derives from the payload (`meta.metric_label`,
  `meta.color_metric`), never from a constant. That is what let the treemap ship
  before the complexity backend existed without ever lying in between.

If you find yourself writing a label that is true *most* of the time, stop.

---

## 2. Colour

**Never write a hex literal in a chart.** Tokens live in `app/globals.css` under
both `:root` and `.dark`; the accessor layer is `lib/viz/tokens.ts`.

| Purpose | Token | Accessor |
|---|---|---|
| Categorical (node type, module, layer, depth) | `--viz-cat-1` … `--viz-cat-8` | `catVar(i)`, `typeVar(type)` |
| Text drawn **on** a categorical fill | `--viz-cat-ink` | `catInkVar(a?)` |
| Sequential ramp (heat) | `--viz-seq-from` / `--viz-seq-to` | `seqScale([min,max])` |
| Chart surfaces and ink | `--viz-surface`, `--viz-ink`, `--viz-ink-dim`, `--viz-edge` | `surfaceVar`, `inkVar`, `inkDimVar`, `edgeVar` |
| "This is the active thing" | `--viz-highlight` | `highlightVar(a?)` |

### Live vs concrete — this distinction matters

- `cssVar` / `catVar` / `inkVar` / `typeVar` return a **live** `hsl(var(--x))`
  string. Assign straight to an SVG attribute; the browser re-resolves it on
  every paint, so a theme flip updates the chart with **no re-render and no
  redraw**. Prefer this everywhere you can.
- `seqScale` / `resolve` / `inkOnFill` return a **concrete** colour, because
  they do arithmetic on the value. These are snapshots and go stale on a theme
  change, so any effect using one **must** list `useVizThemeVersion()` in its
  deps. `TreemapViz` is the worked example.

### Rules

- **Sequential domains are `[min, max]`, never `[0, max]`.** Real metrics
  cluster well above zero; anchoring at 0 leaves the cold half of the ramp
  unused and paints everything warm, which destroys the signal the chart exists
  to carry (QA-006).
- **Gamma defaults to linear.** A gamma below 1 was previously compensating for
  a 0-anchored domain. With a real domain it only distorts the mapping away from
  what the legend advertises.
- **The colour domain spans the whole dataset, not the drilled subtree.**
  Rescaling per drill recolours identical files as you navigate, so one file
  reads hot inside a calm directory and cold one level up.
- **Node chips sit on `hsl(var(--card))` with a coloured border and label**, not
  on a tinted fill. Tinted fills were the dark slabs that made three charts
  unreadable in light mode.
- One deliberate exception: `NeuralNetworkViz`'s `CATEGORY_COLORS`. It is a
  genuine categorical palette encoding layer type, with base/top/side face
  shading for the isometric render, and it reads correctly on both themes.

---

## 3. Chrome geometry

Every chart renders inside `VizShell`. The shell owns position and behaviour;
the chart owns its SVG.

```tsx
const canvas = useVizCanvas();
const reducedMotion = useReducedMotion();
const zoom = useVizZoom(!reducedMotion);
const nav  = useVizNodeNav({ onActivate, onEscape });

<VizShell canvas={canvas} zoom={zoom} nav={nav}
          label="…" description="…"
          legend={<VizLegend title="…" items={…} />}>
  <svg ref={svgRef} className="w-full h-full" />
</VizShell>
```

and inside the draw effect, after the nodes exist:

```ts
svg.call(zoomBehavior);
zoom.register(svgRef.current, zoomBehavior, g.node());
nav.register(g.node(), "g.my-node");
zoom.fitToView({ animate: false });
```

| Slot | Where it lands | Use for |
|---|---|---|
| `legend` | Inset, bottom-left, floating | Node-link charts, which have whitespace to spare |
| `footer` | Reserved strip **below** the canvas | Space-filling charts (treemap) — an inset key would cover real data |
| `header` | Reserved strip **above** the canvas | Same reasoning; e.g. a breadcrumb over a treemap |
| `toolbarLeft` / `toolbarRight` | Overlay, top corners | View toggles on node-link charts |
| `overlay` | Free-positioned inside the chart area | Detail panels, tooltips |
| Zoom cluster | Fixed, bottom-right | Never re-implement it |

Fixed positions are the point: a user learns a control's location on one chart
and must not lose it on the next.

- **Zoom buttons are 44px** (WCAG 2.5.5). Every control has a visible
  `:focus-visible` ring.
- **The canvas is measured, not the wrapper.** `useVizCanvas` observes the chart
  area so a header/footer shrinks the canvas rather than overlapping it, and so
  tooltip coordinates line up with what was drawn.
- **A chart that encodes meaning in colour renders a legend.** Not optional.

---

## 4. Layout and measurement

- **Observe the container, never `window`.** A sidebar collapse changes the
  container without changing the window, so a `window` listener silently misses
  it. That was the `NeuralNetworkViz` bug.
- Measurement is **debounced** (150ms): the sidebar collapse animates, and an
  unthrottled observer re-lays-out on every frame of it.
- A collapse to 0×0 (hidden tab, `display:none`) is **ignored**. Redrawing at
  0×0 throws the layout away and it never comes back on reveal.
- **Fit with `getBBox()`, never guessed constants.** `ArchitectureGraph` used
  four hardcoded numbers and misfitted whenever content was narrower than its
  lane (B4).
- **The initial fit does not animate.** Tweening from the identity transform on
  first paint reads as an unrequested zoom rather than as a chart appearing.
  User-triggered fits keep the tween.
- **Fit once.** `RadialMindmap` re-fitted inside every `update()`, so each
  expand threw away the pan and zoom the user had just set. If you remove an
  auto-fit, check it was not doubling as the only escape hatch — add the button.
- **Redraw must not reset user state.** The mind map keeps its built hierarchy
  in a ref for as long as `root` is the same object, because expand/collapse
  state lives on that hierarchy and a resize would otherwise silently close
  everything the user had opened.

### Responsive

- **Breakpoint-aware sizing, not fixed constants.** `ArchitectureGraph` reads
  `width < 560` and switches node width 140→104, gutter 16→10 and label
  truncation 18→12 characters. Fixed `NODE_W = 140` fitted one node per row at
  375px and auto-fitted 11px labels down to about 3px.
- Below `NARROW_QUERY` (`max-width: 1023px`) the shell moves an inset legend
  into the footer strip and lays its keys out horizontally.
- Hover is not an input method on touch. Anything reachable only by hover needs
  a tap equivalent — see §6.

---

## 5. Motion

Every chart consumes `useReducedMotion()`. Budget:

| Interaction | Duration | Under reduced motion |
|---|---|---|
| Hover feedback (stroke, fill) | 100–150ms | 0 |
| Layout transition (expand/collapse) | 400ms | 0 |
| Fit-to-view tween | 300–500ms | 0 |
| Entrance stagger | ≤ 60ms × index | none — everything is simply there |
| Ambient/looping animation | — | **not rendered at all** |

- A d3 transition with `duration(0)` still lands on the final attributes, so
  reduced motion is a duration change, not a code path.
- **A self-re-arming animation must be cancellable by the effect that started
  it.** The DataFlow particle loop re-armed via `.on("end", loop)` guarded only
  by `pathNode.isConnected` — on re-render the old node stays attached for a
  tick, orphaning a second loop that never stops (B6). Use an explicit
  `cancelled` flag set in the effect's cleanup.

---

## 6. Interaction

- **Tooltip position is container-relative**: `clientX - containerRect.left`.
  **Never `event.offsetX`** — it is relative to whichever SVG child was hovered
  and differs between Chrome and Firefox (B5).
- Tooltips flip near an edge rather than clipping (`VizTooltip` handles this).
- **A tooltip must say something the chart cannot.** `Value: 42` is not a
  tooltip. Full path, both encodings as numbers, and a derived one-line reading.
- **`cursor: pointer` is a promise.** Either wire the click or drop the cursor.
  `ArchitectureGraph` carried a pointer cursor with no handler for its whole
  life (B3).
- On coarse pointers, **tap pins** what hover would have shown, and a background
  tap dismisses it. `mouseleave` must not clear a pinned tooltip — mobile
  browsers synthesise one right after the tap.
- **Drill-down goes through `VizBreadcrumb`** (D5), the shared N-segment
  control. Do not build a second bespoke back button.

---

## 7. Accessibility floor

Non-negotiable:

| Property | Floor |
|---|---|
| Type size | **10px**. No exceptions — 8px and 9px labels were unreadable. |
| Contrast | 4.5:1, including label-on-fill. Use `catInkVar()` on categorical fills and `inkOnFill()` on a computed ramp colour. |
| Target size | 44×44px for every control |
| Focus | Visible `:focus-visible` ring on every control and every focusable node |

### Keyboard

`VizShell`'s wrapper is a `role="group"` with `aria-label`, `aria-describedby`
and `tabIndex={0}` — **the chart is a single tab stop**, never 250 tiles in the
tab order. From there:

| Key | Action |
|---|---|
| `+` / `-` / `0` | Zoom in, out, fit |
| Arrows | Move between nodes (`useVizNodeNav`) |
| `Home` / `End` | First / last node |
| `Enter` / `Space` | Activate the focused node |
| `Escape` | Back out — close a panel, drill up |

`nav.onKeyDown` runs first and reports whether it consumed the key; unconsumed
keys fall through to zoom. Nodes carry `tabindex="-1"` (focusable
programmatically, never by Tab). Arrows wrap at both ends — a chart has no
scrollbar to orient by, so a silent no-op at the edge reads as broken input.

**Enter re-uses the click path** (`el.dispatchEvent(new MouseEvent("click"))`)
so mouse and keyboard cannot drift apart.

### Screen readers

Per-node `aria-label` must carry **everything the chart says visually and the
label does not**:

```
"src/components/Graph.tsx, TypeScript, 21,000 bytes, 992 lines, complexity 84"
"auth.routes.ts, routes layer, depends on 2, used by 0"
```

Node names truncate at 12–20 characters and encodings live in geometry and
colour, all of which are silent. `role="button"` when the node activates
something, `role="img"` when it does not.

Use `aria-label`, **not an SVG `<title>`** — the browser also renders `<title>`
as a native tooltip that fights the real one.

---

## 8. Empty, loading and error states

- **An empty state is a feature, not a full stop.** Say what was found, name the
  most likely cause, and link somewhere that will work. "Files were detected but
  no connections resolved" plus "this project may use path aliases (`@/`, `~/`)
  we don't map yet" plus a link to the chart that does not need edges.
- **Never render `err.message`.** Classify at the hook boundary with
  `describeFailure()` from `lib/errors.ts` and render `FailureState`. The
  taxonomy decides the action: 401/403 → sign in, 404 → re-analyze, 429/5xx →
  retry, 4xx → no action, because a retry sends the identical request.
- **Every request carries a deadline.** 45s for a visualization, with a "taking
  longer than usual" transition at 12s. A backend that accepts the socket and
  never answers must not spin forever.
- **Distinguish a cancel from a timeout.** Both arrive as `signal.reason`;
  collapsing them means a timed-out request renders nothing at all.
- **Free charts render on arrival.** Only `/visualize/dataflow` spends tokens,
  and only it keeps a "Generate" card — which says *why* it asks.

---

## 9. Things that look like bugs and are not

- `useVizCanvas` returns a **callback ref named `attach`**, not a ref object,
  and consumers destructure it (`const { attach } = canvas`) before use.
  React's compiler lint rejects both a `.ref` property and a member expression
  in a `ref=` slot.
- **Never alias `canvas.containerRef` into a local const.** The compiler's ref
  analysis taints the alias, and every later `canvas.*` read during render
  becomes a `react-hooks/refs` error. Write `canvas.containerRef.current`
  inline, as `TreemapViz` does.
- **Never write a ref during render.** The "latest options" pattern
  (`ref.current = options`) must go in an effect — see `useVizNodeNav`.
- `useReducedMotion` uses `useSyncExternalStore`, not `useState` + `useEffect`:
  this repo enforces `react-hooks/set-state-in-effect` as an **error**. Same for
  `useMediaQuery`.
- Path separators are normalised once, up front, in the backend treemap builder.
  This repo has prior Windows-path bugs; do not remove that.
