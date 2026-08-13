# DataFlowGraph — Reactflow Rewrite · Implementation Guide

> **Audience.** Engineers implementing the new data-flow diagram.
> **Status.** Ready to start P0 (see §16).
> **Companions.** `VISUALIZATION.md` (cross-cutting viz choices),
> `frontend/AGENTS.md` (Next.js/Tailwind constraints — re-read before touching
> build config).

This guide covers one visualisation end to end — the **DataFlowGraph** chart,
rewritten on top of `@xyflow/react` (Reactflow 12), replacing the d3
implementation in `frontend/components/report/viz/DataFlowGraph.tsx`. The
deliverable is a chart that is **interactive** (hover/click/drag/search/filter/
trace/subgraphs/replay), highly **detailed** (where data is collected, where it
goes, what is returned), and **theme-correct** (live light/dark tokens).

---

## 1 · Goals

| # | Goal | User-visible result |
|---|---|---|
| G1 | Show where data is collected | Every `io` node names its source (URL, queue, file, cron) |
| G2 | Show where data goes | Every edge has a stacked label: `data_type` on top, `payload` below |
| G3 | Show return paths | A dashed `↩ returns` edge is drawn between any request/response pair |
| G4 | Show what each stage does | Click → detail panel with `description`, `inputs`, `outputs`, files |
| G5 | Subgraphs | Stages that share a domain cluster into labelled groups; collapse/expand |
| G6 | Interactive filter | Toolbar chips toggle visible node kinds and edge kinds |
| G7 | Interactive search | Search box highlights matching nodes, dims the rest |
| G8 | Interactive trace | "Trace from here" follows the subgraph up & downstream in two colours |
| G9 | Interactive replay | Click an edge → animate a dot riding the path (anti-CPU/perf guard below) |
| G10 | Interactivity on every input | Hover, click, double-click, drag, keyboard — none requires a pointer |
| G11 | Theme-correct | Light/dark switch, no hex literals, follows the system preference |
| G12 | Reduced-motion safe | Perpetual animation is gated on `prefers-reduced-motion` |

---

## 2 · Library & dependency choices

| Need | Choice | Why |
|---|---|---|
| Graph rendering | `@xyflow/react` v12.11 (already in `package.json`) | MIT, no licensing cost, React-native (no canvas tax), already used elsewhere |
| Layout | `elkjs` 0.9 (already in `package.json`) | Layered direction flow, cycle-breaking, group packing — already used by `DependencyGraph` |
| Animation | `framer-motion` 12 (already in `package.json`) | Drives the replay dot along a path; size budget is small |
| Theme | `app/globals.src.css` (the only place to write CSS) | AGENTS.md: never edit `app/globals.css` (it's generated) |
| Numeric tokens | `lib/viz/tokens.ts` (existing) | `cssVar()`, `catVar()`, `inkVar()` etc. — live `hsl(var(--…))` |
| State | React state + `useVizZoom` + a small reducer | No Redux/Zustand; complexity is local |

**No new dependencies.** Reuses everything already installed.

---

## 3 · File structure

```
frontend/components/report/viz/
  DataFlowGraph.tsx                      ← rewrite (top-of-tree host)

frontend/components/report/viz/dataflow/
  model.ts                              ← prop shape → xyflow shape + types
  layout.ts                             ← ELK layered + pack + manual fallback
  theming.ts                            ← maps node/edge categories to live tokens
  detail-panel.tsx                      ← the slide-in inspector
  toolbar.tsx                           ← toolbar chip strip
  search-box.tsx                        ← debounced search input
  filter-chips.tsx                      ← kind toggles
  trace-toolbar.tsx                     ← "Trace ▾ Reset" affordance + count
  minimap-node-color.ts                 ← per-node-type fill for the MiniMap
  replay.ts                             ← motion hook driving the per-edge dot

  nodes/
    start-node.tsx                      ← io / entry — gold border + source.spec
    end-node.tsx                        ← io / exit — gold border + outputs chips
    action-node.tsx                     ← process — label + file-path pill
    decision-node.tsx                   ← branch — inline SVG hexagon
    transform-node.tsx                  ← transform — inline SVG parallelogram
    data-store-node.tsx                 ← cylinder — schema + read/write dots
    group-frame.tsx                     ← subgroup container (Reactflow "group")

  edges/
    flow-edge.tsx                       ← BaseEdge + EdgeLabelRenderer double label
    flow-marker.tsx                     ← one <defs> per directional+colour combo
    edge-styles.ts                      ← edge colour/dash functions

  interactions/
    hover.ts                            ← connection-aware highlight via Part selection
    search.ts                           ← match scoring + dim/highlight map
    trace.ts                            ← BFS upward + downward adjacency
    isolate.ts                          ← on double-click, fade everything but a node
    
  state/
    reducer.ts                          ← the only state machine — single source of truth
    selectors.ts                        ← useSearchMatches(), useTrace(), … hooks

  __tests__/
    model.test.ts                       ← prop → xyflow shape
    layout.test.ts                      ← ELK calls, with elk mocked
    edges/flow-edge.test.tsx            ← double-label renders, response dashing
    interactions/trace.test.ts          ← BFS on a known graph
    DataFlowGraph.test.tsx              ← jsdom smoke: "renders an xyflow chart"
```

Everything outside `DataFlowGraph.tsx` is internal. Consumers only ever import
the top component.

---

## 4 · Type system

### 4.1 Backend contract (extends current)

```ts
// frontend/components/report/viz/dataflow/model.ts

export type NodeKind =
  | "start" | "end"            // io nodes (replaces the d3 "io" with two flavours)
  | "action"                   // process
  | "decision"                 // branch
  | "transform"
  | "data_store";

export type EdgeKind = "http" | "db" | "file" | "event" | "internal";

export type EdgeDirection = "request" | "response" | "internal";

export interface FlowNode {
  id: string;
  label: string;
  kind: NodeKind;                // was `type` in d3
  shape?: "rounded_rect" | "cylinder" | "parallelogram" | "hexagon";
  tier?: number;                 // backend hint, ignored if ELK is happy

  // detail content
  description?: string;
  source_files?: string[];
  source?: { kind: "http" | "queue" | "file" | "cron" | "event"; spec: string };
  reads?:  string[];
  writes?: string[];
  inputs?:  { name: string; type: string }[];
  outputs?: { name: string; type: string }[];
  parent?: string;               // → group id (subgraph)
}

export interface FlowEdge {
  source: string;
  target: string;
  label?: string;
  data_type?: EdgeKind;
  animated?: boolean;
  direction?: EdgeDirection;     // default "internal"
  payload?: string;
  status?: "ok" | "err" | "stream";
}

export interface DataFlowGraphProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** gates editable features (drag-to-connect, double-click to add) */
  editor?: boolean;
  /** initial-set seed for URL-rehydrated state — `null` is "no focus" */
  initialFocusId?: string | null;
}
```

### 4.2 Reactflow shape (internal)

```ts
import type { Node, Edge, NodeProps, EdgeProps, EdgeMarker } from "@xyflow/react";

export type RFNodeKind = NodeKind | "group";
export interface RFNodeData extends Record<string, unknown> {
  flow: FlowNode;
  highlight: "off" | "dim" | "hover" | "trace-up" | "trace-down" | "select";
}
export type RFNode = Node<RFNodeData, RFNodeKind>;

export interface RFEdgeData extends Record<string, unknown> {
  flow: FlowEdge;
  highlight: "off" | "dim" | "hover" | "trace-up" | "trace-down";
  replayToken: number;     // bumped to retrigger the dot anim
}
export type RFEdge = Edge<RFEdgeData, "flow">;
```

The `highlight` field is the *single* thing that drives visibility. Selectors
in §10.4 return a `Map<id, RFHighlight>`; the reducer merges it into the
tree each render via `applyNodeChanges(…)`. No per-element re-renders outside
of `React.memo` boundaries.

---

## 5 · Backend-side changes

`VISUALIZATION.md` already pins the graph surface. This work needs the
flow-specific shape extended:

```python
# backend/codekavi/graph.py (or wherever the flow payload is assembled)

def normalize_flow_node(raw: dict) -> dict:
    """Coerce analyzer output to the frontend contract."""
    ...
    return {
        "id": raw["id"],
        "label": raw["label"],
        "kind": classify_kind(raw),       # see note below
        "shape": raw.get("shape"),
        "tier": raw.get("tier"),
        "description": raw.get("description"),
        "source_files": raw.get("source_files", []),
        "source": derive_source(raw),
        "reads":  raw.get("reads", []),
        "writes": raw.get("writes", []),
        "inputs":  raw.get("inputs", []),
        "outputs": raw.get("outputs", []),
        "parent": raw.get("parent"),
    }

def derive_edge_direction(edges: list[dict]) -> list[dict]:
    """Mark the second of any (a,b) + (b,a) pair as 'response'."""
    seen = {}
    for e in edges:
        key = (e["source"], e["target"])
        seen.setdefault(key, 0)
        seen[key] += 1
        if seen[(e["target"], e["source"])]:
            e["direction"] = "response"   # a -> b came first, this is the return
        else:
            e["direction"] = e.get("direction", "request")
    return edges
```

> **Note on `classify_kind`.** The d3 chart used `type` ∈
> {`io`, `process`, `transform`, `data_store`}. We split `io` into `start` and
> `end` based on `in_degree == 0` vs `out_degree == 0`; nodes with both fall
> to `start` (default). `process` → `action`. `transform`, `data_store`
> unchanged.

---

## 6 · Component composition

```
<DataFlowGraph>
  ├─ <VizShell>             ← chrome (legend, zoom, aria, focus trap)
  │    ├─ toolbar (top-strip)
  │    │    ├─ <SearchBox>
  │    │    ├─ <FilterChips>
  │    │    └─ <TraceToolbar>      (only when a node is selected)
  │    ├─ ReactFlow          ← xyflow canvas
  │    │    ├─ <Background />
  │    │    ├─ <MiniMap nodeColor={…} />
  │    │    ├─ <ReactFlowProvider internal> (provides useReactFlow to children)
  │    │    ├─ nodeTypes={{ action, decision, transform, data_store, start, end, group }}
  │    │    ├─ edgeTypes={{ flow: <FlowEdge /> }}
  │    │    ├─ <FlowMarker /> ← SVG <defs> arrowheads
  │    │    └─ <DetailPanelOverlay /> (positioned absolutely inside the canvas)
  │    └─ <Re/>             legend, footer
  └─ <DetailPanel>          ← always-mounted, slide in/out via CSS transform
```

The canvas (height-bearing `<div>`), the toolbar (top strip), and the
side-panel slot all come from `VizShell` unchanged. Implementing this
component means **VizShell and useVizZoom keep working as-is** except for the
`register` tweak in §10.2.

---

## 7 · Custom node templates

Every node is a pure function component (no class), every one wrapped in
`React.memo`. Selectors keep the props shallow, so a render of one node never
re-renders another.

### 7.1 Shared shell

```tsx
// frontend/components/report/viz/dataflow/nodes/shared.tsx
import { Handle, Position } from "@xyflow/react";

export function LeftHandle({ id }: { id: string }) {
  return (
    <Handle
      id={id}
      type="target"
      position={Position.Left}
      className="!h-2 !w-2 !rounded-full !border-0"
      style={{ background: "hsl(var(--viz-highlight))" }}
    />
  );
}

export function RightHandle({ id }: { id: string }) {
  return (
    <Handle
      id={id}
      type="source"
      position={Position.Right}
      className="!h-2 !w-2 !rounded-full !border-0"
      style={{ background: "hsl(var(--viz-highlight))" }}
    />
  );
}
```

### 7.2 Action / Process node

```tsx
// frontend/components/report/viz/dataflow/nodes/action-node.tsx
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import { highlightToStyle } from "../interactions/hover";
import { LeftHandle, RightHandle } from "./shared";

export const ActionNode = memo(function ActionNode(props: NodeProps) {
  const { label, source_files } = props.data.flow;
  return (
    <div
      className="rounded-md border bg-card px-3 py-1.5 text-xs shadow-sm"
      style={{
        ...highlightToStyle(props.data.highlight),
        borderColor: "hsl(var(--viz-cat-5))",
      }}
    >
      <LeftHandle id="in" />
      <div className="font-medium">{label</div>
      {source_files?.[0] && (
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {source_files[0].split("/").pop()}
       </div>
      )}
      <RightHandle id="out" />
   </div>
  );
});
```

### 7.3 Decision (hexagon) and Transform (parallelogram)

Both use inline SVG, matching the precision the d3 version had:

```tsx
// decision-node.tsx
export const DecisionNode = memo(function DecisionNode(props: NodeProps) {
  const { label } = props.data.flow;
  const w = 140, h = 50, cut = 25;
  return (
    <div style={{ ...highlightToStyle(props.data.highlight) }}>
      <LeftHandle id="in" />
      <svg width={w} height={h}>
        <polygon
          points={`
            ${cut},0 ${w - cut},0 ${w},${h / 2}
            ${w - cut},${h} ${cut},${h} 0,${h / 2}
          `}
          fill="hsl(var(--card))"
          stroke="hsl(var(--viz-cat-2))"
          strokeWidth={2}
        />
        <text
          x={w / 2} y={h / 2 + 4}
          textAnchor="middle"
          fontSize="11"
          fill="hsl(var(--foreground))"
        >
          {label}
       </text>
     </svg>
      <RightHandle id="out" />
   </div>
  );
});
```

`transform-node.tsx` is the parallelogram equivalent.

### 7.4 Data store (cylinder)

```tsx
// data-store-node.tsx
export const DataStoreNode = memo(function DataStoreNode(props: NodeProps) {
  const { label, reads, writes } = props.data.flow;
  const w = 150, h = 50, rx = w / 2, ry = 9;

  return (
    <div style={{ ...highlightToStyle(props.data.highlight) }}>
      <LeftHandle id="in" />
      <svg width={w} height={h + ry}>
        <path
          d={`
            M0,${ry} L0,${h}
            A${rx},${ry} 0 0 0 ${w},${h}
            L${w},${ry}
          `}
          fill="hsl(var(--card))"
          stroke="hsl(var(--viz-cat-3))"
          strokeWidth={2}
        />
        <ellipse
          cx={w / 2} cy={ry} rx={rx} ry={ry}
          fill="hsl(var(--card))"
          stroke="hsl(var(--viz-cat-3))"
          strokeWidth={2}
        />
        <text x={w / 2} y={h / 2 + 5} textAnchor="middle"
              fontSize="11" fill="hsl(var(--foreground))">
          {label}
       </text>
     </svg>
      <div className="mt-1 flex justify-center gap-1">
        {(reads ?? []).slice(0, 5).map((r) => (
          <span key={r} className="rounded bg-emerald-500/20 px-1 text-[9px]">R</span>
        ))}
        {(writes ?? []).slice(0, 5).map((w_) => (
          <span key={w_} className="rounded bg-amber-500/20 px-1 text-[9px]">W</span>
        ))}
     </div>
      <RightHandle id="out" />
   </div>
  );
});
```

### 7.5 Start / End (io)

Same template, flavour switches on `kind`:

```tsx
// start-node.tsx (the `kind === "start"` case)
import { SourceBadge } from "./source-badge";

export const StartNode = memo(function StartNode(props: NodeProps) {
  const { label, source } = props.data.flow;
  return (
    <div
      className="rounded-md border-2 bg-card px-3 py-1.5 text-xs shadow-sm"
      style={{
        ...highlightToStyle(props.data.highlight),
        borderColor: "hsl(var(--viz-cat-1))",
        background: "hsl(var(--viz-cat-1) / 0.05)",
      }}
    >
      <RightHandle id="out" />
      <div className="font-semibold">{label</div>
      {source && <SourceBadge {...source} />}
   </div>
  );
});

export const EndNode = memo(function EndNode(props: NodeProps) {
  const { label, outputs } = props.data.flow;
  return (
    <div
      className="rounded-md border-2 bg-card px-3 py-1.5 text-xs shadow-sm"
      style={{
        ...highlightToStyle(props.data.highlight),
        borderColor: "hsl(var(--viz-cat-1))",
        background: "hsl(var(--viz-cat-1) / 0.05)",
      }}
    >
      <LeftHandle id="in" />
      <div className="font-semibold">{label</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {(outputs ?? []).slice(0, 3).map((o) => (
          <span key={o.name}
            className="rounded bg-muted px-1 font-mono text-[10px]">
            → {o.name}: {o.type}
         </span>
        ))}
     </div>
   </div>
  );
});
```

### 7.6 Group frame (subgraph)

```tsx
// group-frame.tsx
export const GroupFrame = memo(function GroupFrame(
  props: NodeProps<{ label: string; collapsed: boolean }>
) {
  return (
    <div
      className="h-full w-full rounded-xl border-2 border-dashed bg-card/40"
      style={{ borderColor: "hsl(var(--viz-edge))" }}
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {props.data.label}
       </span>
        <button
          className="ml-2 rounded p-0.5 hover:bg-accent"
          onClick={(e) => {
            e.stopPropagation();
            props.data.collapsed = !props.data.collapsed;
            // reducer dispatches toggleCollapsed(groupId)
          }}
          aria-label={props.data.collapsed ? "Expand group" : "Collapse group"}
        >
          {props.data.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
       </button>
     </div>
   </div>
  );
});
```

Children of the group have `parentId: <group.id>` and `extent: 'parent'`. When
collapsed, their `width/height` resolves to 0 via the change reducer; the
collapser expands by temporarily detaching extent, re-running the
subgraph-pack layout in §8, then reattaching.

### 7.7 `nodeTypes` map

```ts
// DataFlowGraph.tsx
const nodeTypes = {
  start:      StartNode,
  end:        EndNode,
  action:     ActionNode,
  decision:   DecisionNode,
  transform:  TransformNode,
  data_store: DataStoreNode,
  group:      GroupFrame,
} satisfies Record<RFNodeKind, React.ComponentType<NodeProps>>;
```

Reactflow needs a *stable* reference for the map (else it remounts every
component on every parent render). Wrap the file in `Object.freeze({...})` or
hoist it module-level — done in §10.1.

---

## 8 · Custom edge — the stateChart double-label

The signature visual: two stacked labels living in the
`<EdgeLabelRenderer>` portal, positioned at the edge midpoint.

```tsx
// edges/flow-edge.tsx
import { memo } from "react";
import {
  BaseEdge, EdgeLabelRenderer, getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { edgeStyle, isResponse, labelOffsets } from "./edge-styles";
import { ReplayDot } from "./replay-dot";

export const FlowEdge = memo(function FlowEdge(
  props: EdgeProps<RFEdgeData>
) {
  const { sourceX, sourceY, targetX, targetY,
          sourcePosition, targetPosition } = props;
  const [path, midX, midY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    borderRadius: 8,
  });
  const isResp = isResponse(props.data.flow);
  const hl = props.data.highlight;

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={edgeStyle(props.data.flow, hl)}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${midX}px,${labelOffsets[hl].y + midY}px)`,
            pointerEvents: "all",
          }}
          className="flex flex-col items-center gap-0.5"
        >
          <span className="rounded bg-card/95 px-1.5 py-0.5 text-[10px] font-medium shadow-sm"
                style={{ color: edgeStyle(props.data.flow, hl).stroke }}>
            {edgeKindLabel(props.data.flow.data_type)}
         </span>
          {props.data.flow.payload && (
            <span className="rounded bg-card/80 px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm">
              {props.data.flow.payload}
           </span>
          )}
          {isResp && (
            <span className="text-[10px] italic text-amber-500">↩ returns</span>
          )}
       </div>
     </EdgeLabelRenderer>

      {props.data.flow.animated && props.data.highlight !== "off" &&
       !props.data.replayToken /* replay anim is mounted on click, see §10.5 */ && (
        <EdgeLabelRenderer>
          <ReplayDot edgeId={props.id} path={path} />
       </EdgeLabelRenderer>
      )}
    </>
  );
});
```

`edgeStyle` returns `{ stroke, strokeWidth, strokeDasharray }`. Anything
matching the `data_type` keeps its categorical colour; `isResponse()` flips
the stroke to dashed and recolours to the "muted" slot.

### 8.1 Edge marker registry

Reactflow draws inside its own wrapping `<svg>`, so we drop `<defs>` once via
the same preview-element trick Go-flow uses:

```tsx
// edges/flow-marker.tsx
export function FlowMarkerDefs() {
  return (
    <svg style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }} aria-hidden>
      <defs>
        {EDGE_STROKE_PALETTE.flatMap((colour) => [
          <marker id={`flow-arrow-${colour.id}`} key={`f-${colour.id}`}
                  viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={colour.css} />
         </marker>,
          <marker id={`flow-arrow-${colour.id}-dashed`} key={`r-${colour.id}`}
                  viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={colour.css} opacity="0.7" />
         </marker>,
        ])}
     </defs>
   </svg>
  );
}
```

Mounted once via `<FlowMarkerDefs />` inside the chart. Edge `markerEnd`
switches between the two ids based on `flow.direction`.

---

## 9 · Layout subsystem

### 9.1 ELK layered (default path)

```ts
// dataflow/layout.ts
import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK();

export interface LayoutOutput {
  positions: Map<string, { x: number; y: number; width: number; height: number }>;
  groups: Map<string, { width: number; height: number }>;
}

export async function runLayout(
  graph: {
    nodes: { id: string; width: number; height: number; parentId?: string;
             collapsed?: boolean }[];
    edges: { id: string; source: string; target: string }[];
  },
  opts: { cycleSensitive: boolean; groupPack: boolean },
): Promise<LayoutOutput> {
  const graphV = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.spacing.nodeNode": "40",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.cycleBreaking.strategy": opts.cycleSensitive ? "DEPTH_FIRST" : "NONE",
    },
    children: graph.nodes.map((n) => ({
      id: n.id,
      width: n.width, height: n.height,
      layoutOptions: n.parentId ? { "elk.layered.layering.layerChoiceConstraint": "1" } : {},
    })),
    edges: graph.edges.map((e) => ({
      id: e.id, sources: [e.source], targets: [e.target],
    })),
  };

  const out = await elk.layout(graphV);
  return {
    positions: new Map(
      (out.children ?? [])
        .filter((c) => !c.parentId && c.x != null)
        .map((c) => [c.id, { x: c.x!, y: c.y!, width: c.width!, height: c.height! }])
    ),
    groups: new Map(
      (out.children ?? [])
        .filter((c) => c.parentId && c.x != null)
        .map((c) => [c.id, { width: c.width!, height: c.height! }])
    ),
  };
}
```

Layout is wrapped in a `useEffect` with `cancelled` flag so unmounts don't
fire late updates:

```ts
useEffect(() => {
  let cancelled = false;
  runLayout(graph).then((out) => {
    if (cancelled) return;
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        position: out.positions.get(n.id) ?? n.position,
        width:  out.positions.get(n.id)?.width  ?? n.width,
        height: out.positions.get(n.id)?.height ?? n.height,
      }))
    );
    // Frame after layout settles.
    fitView({ duration: 0 });   // see §10.2 — the no-animate rule
  });
  return () => { cancelled = true; };
}, [graphVersion]);  // bump only when the underlying graph changes (props or filters)
```

### 9.2 Group packing (per-group children)

After the main pass, walk over nodes that have `parentId` and run a second
ELK pass with `elk.algorithm: "packed"` per group. The result becomes the
group's child positions and the group's `width/height`.

### 9.3 Manual fallback

For tiny graphs (≤3 nodes) or ELK throwings, the layout is skipped and nodes
default to `(0, 0)` — `VizShell`'s "Fit to view" button makes that readable
anyway.

---

## 10 · State, controller, and interactivity

### 10.1 Single reducer

```ts
// state/reducer.ts
interface State {
  selected:   string | null;
  hover:      string | null;
  search:     string;
  filters:    { nodes: Set<NodeKind>; edges: Set<EdgeKind> };
  traceFrom:  string | null;
  graphVersion: number;       // bumped to retrigger layout
}

type Action =
  | { type: "select"; id: string | null }
  | { type: "hover";  id: string | null }
  | { type: "search"; q: string }
  | { type: "toggle-kind";    kind: NodeKind }
  | { type: "toggle-e-kind";  kind: EdgeKind }
  | { type: "trace";          from: string | null }
  | { type: "graph-changed" };
```

`useReducer` here; selectors in §10.4 read the slice they need.

### 10.2 `useVizZoom` upgrade — one-line partner for Reactflow

Goal: `useVizZoom`'s public shape is unchanged but the
`register(svg, behaviour, root)` signature becomes
`register(svg, controller?)`. D3 charts keep calling the d3 form; the Reactflow
chart passes a `{ zoomIn, zoomOut, fitToView }` adapter that calls
`useReactFlow()`:

```ts
// inside DataFlowGraph.tsx
const rf = useReactFlow();
useEffect(() => {
  zoom.register(null, {
    zoomIn:  () => rf.zoomIn({ duration: 200 }),
    zoomOut: () => rf.zoomOut({ duration: 200 }),
    fitToView: () => rf.fitView({ duration: 300, padding: 0.15 }),
  });
}, [rf, zoom]);
```

`useVizZoom`'s signature widens to:

```ts
// components/viz/useVizZoom.ts
type ZoomController = {
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
};
register(svg: SVGSVGElement | null, controller?: ZoomController | null): void;
```

`DependencyGraph.tsx` wraps its existing `d3.ZoomBehavior` in the same shape
(one-line change inside its existing `useEffect`). All other VizShell
callers are unaffected.

### 10.3 Mouse / pointer interactions

| Reactflow prop | Hookup | Effect |
|---|---|---|
| `onNodeClick` | `dispatch({ select: id })` | opens detail panel |
| `onNodeMouseEnter` | `dispatch({ hover: id })` | selects the part for connection-aware styling |
| `onNodeMouseLeave` | `dispatch({ hover: null })` | clears |
| `onNodeDoubleClick` | `dispatch({ select: id, isolate: true })` | fades everything else; second dbl-click exits |
| `onPaneClick` | `dispatch({ select: null, isolate: false, trace: null })` | resets |
| `onPaneDoubleClick` (gated by `editor`) | open `<AddStageModal>` | adds a node, triggers layout |
| `onConnect` (gated by `editor`) | `addEdge({...flow, direction:"internal"}, ...)` | adds edge + layout |
| `onNodesChange` / `onEdgesChange` | standard reducers | resizes, drags, deletes |
| `onMove`, `onMoveEnd` | bump `viewportVersion` | cheap subscribe to MiniMap |

### 10.4 Selectors (read-side)

```ts
// state/selectors.ts
export function useHighlightMap(state: State, nodes: FlowNode[], edges: FlowEdge[]) {
  return useMemo(() => {
    const hl = new Map<string, RFHighlight>();
    const dimAll = (except: Set<string>, mode: RFHighlight) => {
      for (const n of nodes) if (!except.has(n.id)) hl.set(n.id, "dim");
      for (const e of edges) if (!except.has(`${e.source}->${e.target}`)) hl.set(`${e.source}->${e.target}`, "dim");
      for (const id of except) hl.set(id, mode);
    };

    if (state.traceFrom) {
      // BFS from `traceFrom` upward (incoming) and downward (outgoing).
      const up = trace(state, nodes, edges, state.traceFrom, "in");
      const down = trace(state, nodes, edges, state.traceFrom, "out");
      for (const n of nodes) {
        if (up.has(n.id))      hl.set(n.id, "trace-up");
        else if (down.has(n.id)) hl.set(n.id, "trace-down");
        else                    hl.set(n.id, "dim");
      }
      return applyEdgeHighlight(state, hl, nodes, edges);
    }

    if (state.search.trim()) {
      const matches = searchMatches(state.search, nodes);
      dimAll(matches, "hover");
      return applyEdgeHighlight(state, hl, nodes, edges);
    }

    // Hover highlight
    if (state.hover) {
      const adj = adjacency(state.hover, edges);
      dimAll(adj, "hover");
      return applyEdgeHighlight(state, hl, nodes, edges);
    }

    // Filters: matched kinds are kept, others dim.
    if (state.filters.nodes.size < ALL_NODE_KINDS.length) {
      for (const n of nodes)
        if (!state.filters.nodes.has(n.kind)) hl.set(n.id, "dim");
    }

    // Selected node always glows.
    if (state.selected) hl.set(state.selected, "select");

    return applyEdgeHighlight(state, hl, nodes, edges);
  }, [state, nodes, edges]);
}
```

`highlightToStyle` is a tiny table:

```ts
export function highlightToStyle(h: RFHighlight): CSSProperties {
  switch (h) {
    case "off":        return { opacity: 1, transition: "opacity 200ms" };
    case "dim":        return { opacity: 0.25 };
    case "hover":      return { outline: "2px solid hsl(var(--viz-highlight))" };
    case "trace-up":   return { outline: "2px solid hsl(var(--viz-cat-5))" };
    case "trace-down": return { outline: "2px solid hsl(var(--viz-cat-7))" };
    case "select":     return { outline: "2px solid hsl(var(--viz-highlight))", boxShadow: "0 0 0 4px hsl(var(--viz-highlight) / 0.2)" };
  }
}
```

### 10.5 Replay (per-edge dot)

Click an edge → `dispatch({ replay: edgeId })` bumps `replayToken`. The
`<ReplayDot />` uses Framer Motion to drive a `<motion.circle>` along the
edge's path:

```tsx
export function ReplayDot({ edgeId, path }: { edgeId: string; path: string }) {
  const ref = useRef<SVGCircleElement>(null);
  useMotionValueEvent(...); // not needed if we use animateMotion
  return (
    <motion.circle
      r={3}
      fill="hsl(var(--viz-highlight))"
      initial={{ offsetDistance: "0%", opacity: 0 }}
      animate={{ offsetDistance: "100%", opacity: [0, 1, 1, 0] }}
      transition={{ duration: 1.6, ease: "easeInOut", times: [0, 0.1, 0.85, 1] }}
      style={{ offsetPath: `path('${path}')` }}
      onAnimationComplete={() => {
        dispatch({ type: "replay-complete", edgeId });
      }}
    />
  );
}
```

`style={{ offsetPath }}` is the CSS Motion Path. Chromium, Firefox, and
recent Safari all support it. **Gated on `useReducedMotion()`** — under
prefers-reduced-motion, the replay is a one-frame solid highlight, no
perpetual animation.

### 10.6 Search

```tsx
export function searchMatches(q: string, nodes: FlowNode[]): Set<string> {
  const needle = q.trim().toLowerCase();
  if (!needle) return new Set();
  const out = new Set<string>();
  for (const n of nodes) {
    let score = 0;
    if (n.label.toLowerCase().includes(needle)) score += 3;
    if (n.description?.toLowerCase().includes(needle)) score += 1;
    if (n.source_files?.some((f) => f.toLowerCase().includes(needle))) score += 2;
    if (score > 0) out.add(n.id);
  }
  return out;
}
```

A 150ms debounce in `SearchBox` keeps the layout from re-laying-out on every
keystroke.

### 10.7 Trace

```ts
export function trace(
  _state: State, nodes: FlowNode[], edges: FlowEdge[],
  from: string, direction: "in" | "out",
): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    if (direction === "out") adj.get(e.source)!.add(e.target);
    else                     adj.get(e.target)!.add(e.source);
    // Skip response edges so trace doesn't loop back onto itself.
    if (e.direction === "response") continue;
  }
  const visited = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  visited.delete(from);
  return visited;
}
```

The TraceToolbar exposes `Trace from ▾` with two affordances: *BFS upstream* and
*BFS downstream* (both run, results rendered in two distinct colours). A
`Reset trace` button clears the from-node.

### 10.8 Filter chips

```tsx
// dataflow/filter-chips.tsx
export function FilterChips({ value, onChange }: FilterChipsProps) {
  return (
    <div className="flex gap-1">
      {ALL_NODE_KINDS.map((k) => (
        <button
          key={k}
          aria-pressed={value.has(k)}
          onClick={() => onChange(toggle(value, k))}
          className={cn(
            "rounded px-2 py-0.5 text-[11px] transition-colors",
            value.has(k) ? "bg-accent text-foreground" : "text-muted-foreground"
          )}
        >
          {KIND_LABEL[k]}
       </button>
      ))}
   </div>
  );
}
```

Filter state lives in the reducer (§10.1). When a filter eliminates every
node, show `VizMessage` with hint — "all node kinds hidden".

### 10.9 MiniMap

```tsx
<MiniMap
  pannable zoomable
  nodeColor={(n) => nodeKindToColor(n.data.flow.kind)}
  maskColor="hsl(var(--background) / 0.85)"
  nodeStrokeWidth={2}
/>
```

`nodeKindToColor` lives in `minimap-node-color.ts` and is exactly the same
colour table `DataFlowGraph`'s viewport uses — kept here as a single import
so changes flow through both spots.

### 10.10 Keyboard

Reactflow has built-in `'KeyA'` etc. handlers but we want navigation that
follows our own topological order. We use `useKeyPress` from `@xyflow/react`
(which is just a small event hook):

```tsx
const order = useTopologicalOrder(nodes, edges); // memoised
useKeyPress(["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"], (e) => {
  e.preventDefault();
  const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
  const cur = state.selected ? order.indexOf(state.selected) : 0;
  const next = order[(cur + dir + order.length) % order.length];
  dispatch({ type: "select", id: next });
  rf.setCenter(getNode(next).position.x, getNode(next).position.y, { zoom: rf.getZoom() });
});
```

Also wired: `Enter` → drill into selected (e.g. open the matching group), `Esc`
→ clears selection + exits trace, `+/−/0` → mapped via `useVizZoom`.

`useVizNodeNav` is **not** used here (its selector model is DOM-`<g>` based).
The shell description string updates to say "arrow keys move through stages,
Enter to open, Escape to back out".

### 10.11 URL state

Every interactive state option (focus, trace, filters, search) is mirrored to
the URL via a `useUrlState` hook modeled on `useSearchParams`:

```ts
const [params, setParams] = useSearchParams();
useEffect(() => {
  setParams((p) => {
    if (state.selected)   p.set("focus", state.selected);
    else                  p.delete("focus");
    if (state.traceFrom)  p.set("trace", state.traceFrom);
    else                  p.delete("trace");
    if (state.search)     p.set("q", state.search);
    else                  p.delete("q");
    return p;
  }, { replace: true });
}, [state.selected, state.traceFrom, state.search]);
```

This makes a chart *shareable* — a teammate opening the same report sees
what the previous viewer was looking at.

---

## 11 · Detail panel

Lives outside the `<ReactFlow>` canvas so it doesn't fight the SVG layering
order; positioned absolutely inside the `VizShell` container so it tracks the
same `clientRect` as the chart's tooltips.

```tsx
// detail-panel.tsx
export function DetailPanel({ node, traceUp, traceDown, onClose, onTraceFrom }: Props) {
  return (
    <aside
      role="complementary"
      aria-label={`Details for ${node.label}`}
      className="absolute right-3 top-3 w-80 max-h-[80vh] overflow-y-auto
                 rounded-lg border border-border bg-card/95 backdrop-blur
                 shadow-xl p-4 text-xs"
    >
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{node.label</h2>
          <p className="text-muted-foreground">{KIND_LABEL[node.kind]</p>
       </div>
        <button onClick={onClose} aria-label="Close" className="text-muted-foreground">×</button>
     </header>

      {node.source && (
        <Section title="Where data comes in">
          <SourceBadge {...node.source} />
       </Section>
      )}

      {node.inputs?.length > 0 && (
        <Section title="Inputs">
          <ul className="space-y-0.5 font-mono">
            {node.inputs.map((i) => (
              <li key={i.name}>{i.name}: <span className="text-muted-foreground">{i.type</span</li>
            ))}
         </ul>
       </Section>
      )}

      {node.outputs?.length > 0 && (
        <Section title="Returns">
          <ul className="space-y-0.5 font-mono">
            {node.outputs.map((o) => (
              <li key={o.name}>{o.name}: <span className="text-muted-foreground">{o.type</span</li>
            ))}
         </ul>
       </Section>
      )}

      {node.source_files?.length > 0 && (
        <Section title="Files">
          <ul className="space-y-0.5">
            {node.source_files.map((f) => (
              <li key={f} className="truncate font-mono text-[10px] text-muted-foreground">{f</li>
            ))}
         </ul>
       </Section>
      )}

      {node.description && (
        <Section title="What it does">
          <p className="text-muted-foreground leading-snug">{node.description</p>
       </Section>
      )}

      <Section title="Where data goes">
        <TraceGraph fromId={node.id} upstream={traceUp} downstream={traceDown}
                    onClickEntity={(id) => onTraceFrom(id)} />
     </Section>
   </aside>
  );
}
```

`TraceGraph` is a tiny `<svg>` rendering the same upstream/downstream BFS the
trace toolbar uses, but as inline mini-bars. Click any node in the mini-graph
to refocus trace on it (useful when reading a long pipeline).

---

## 12 · Theming & tokens

| Slot | Source | Example |
|---|---|---|
| Border colour per kind | `catVar(<slot>)` | `borderColor: catVar(kindSlot(n.kind))` |
| Edge stroke | `catVar(<slot>)` | `catVar(edgeSlot(edges.kind))` |
| Card body | `"hsl(var(--card))"` | via Tailwind class |
| Foreground | `"hsl(var(--foreground))"` | via Tailwind class |
| Highlight ring | `"hsl(var(--viz-highlight))"` | outline + boxShadow |
| Trace up | `"hsl(var(--viz-cat-5))"` | currently a strong blue |
| Trace down | `"hsl(var(--viz-cat-7))"` | currently a teal/purple |
| Dashed line for response | strokeDasharray `"6 4"` | hand-coded, lives in `edge-styles.ts` |

`useVizThemeVersion()` from `lib/viz/tokens` exists for charts that snapshot
concrete colours; we don't need it in this component because every colour is a
live `hsl(var(--…))` string already.

`@xyflow/react/dist/style.css` is imported **once** at the chart's parent
(likely `app/(report)/page.tsx` where `DataFlowGraph` is mounted) so we don't
double-load. Tailwind config already excludes `@xyflow/react`'s class scope;
no new config required.

---

## 13 · Performance plan

| Risk | Mitigation |
|---|---|
| Custom node re-render storms | Wrap every node component in `React.memo`; pass stable `data` references; selectors memoised with explicit dependency inputs |
| Edge label portal cost | `EdgeLabelRenderer` paints DOM, but Reactflow only re-creates the label elements when path geometry changes. `FlowEdge` is memoised and `data.flow` is referentially stable across renders thanks to the `useMemo` on `model.ts` output |
| Layout cost | ELK runs once per `graphVersion` bump, not per state change. Filters/search/hover don't bump graph version — they bump a `viewVersion` that re-runs the highlight selector only |
| Replay animation CPU | `<ReplayDot />` only mounts after `dispatch({ replay })`; auto-unmounts via `onAnimationComplete`. Reduced-motion → no `<ReplayDot>` at all. Idle cost = 0 |
| `MiniMap` rerenders | `<MiniMap>` is memoized by its `nodes`/`edges` references; we wrap the `nodes` reference in `useMemo` keyed on layout time, not on every selection change |
| Bundle size | `@xyflow/react` is ~70KB min+gzip; `elkjs` is ~120KB. Both are already loaded by `DependencyGraph`, so the addition is zero |

---

## 14 · Tests

### 14.1 Unit (no DOM)

- `model.test.ts` — `modelPropToRf(...)` — given a `FlowNode`/`FlowEdge`, the
  produced Reactflow node has the right `type`, `data`, handles.
- `interactions/trace.test.ts` — BFS over a small known graph produces the
  expected sets, ignores `direction: "response"`.
- `interactions/search.test.ts` — case-insensitive, multi-token, scoring
  order.
- `edges/edge-styles.test.ts` — `isResponse(direction)`, `edgeStyle(flow,
  highlight)`.

### 14.2 Component (jsdom)

- `DataFlowGraph.test.tsx`:
  - mounts with empty input → renders empty-state with `VizMessage`,
  - mounts with N nodes → asserts `ReactFlow` `__test__` finds N node
    elements,
  - selecting a node dispatches the reducer and the panel renders,
  - filter chips, search, trace all toggle the URL.

### 14.3 Integration (Playwright, already in CI)

- Open a known fixture (small repo, 5 stages, 6 edges), screenshot the chart
  before any interaction and after each major interaction. Diff against a
  stored baseline **only on the page-level visual** — the canvas pixel hash
  is allowed to drift up to a tolerance (we render with sub-pixel
  differences across platforms).

### 14.4 Accessibility

- `getByRole("group", { name: /data flow/ })` is focusable.
- `ArrowDown` moves focus to the first navigable node; `Enter` opens it;
  `Esc` returns focus to the chart wrapper.
- `<aside role="complementary">` announces the detail panel; `aria-label`
  reads the node label.

---

## 15 · Phased implementation

Each phase is a self-contained PR; the chart is feature-flagged
`?viz=xyflow` from P2 until P5, so the d3 chart stays live until then.

| Phase | Scope | Rollback | Exit criteria |
|---|---|---|---|
| **P0 — Schema** | Backend adds `kind`, `direction`, `payload`, `source`, `reads`, `writes`, `inputs`, `outputs`, `parent`. D3 chart ignores them. | Revert backend commit; nothing breaks. | Unit tests in `graphs_test.py` pass. |
| **P1 — Scaffold** | Create `dataflow/` folder; `VizShell` imports the Reactflow CSS once at the page boundary; `useVizZoom` gains `zoomController` param; `DependencyGraph` switches to the new param (one-line change). | Delete folder; revert `useVizZoom`. | `npm run lint typecheck build` all green. |
| **P2 — Render** | `DataFlowGraph` mounts `<ReactFlow>` behind `?viz=xyflow`. Custom nodes (7) and `FlowEdge` live but only basic styling. Layout via ELK. Click opens detail panel. | Set `?viz=`; flip back. | Smoke test renders N nodes. |
| **P3 — Detail & returns** | `direction === "response"` edges render dashed + `↩ returns`. Detail panel reads `direction`, `payload`, `inputs`, `outputs`, `source`. Subgraph groups not yet rendered. | Same as P2. | End-to-end Playwright: open `localhost:3000/report/...?viz=xyflow` on a fixture; assert panel reads inputs + outputs. |
| **P4 — Subgraphs** | Group nodes (when `parent` is present). Two-pass ELK. Collapse/expand via header chevron. | `parent` field is optional; missing → flat. | Fixture with `parent` shows groups; clicking chevron hides children. |
| **P5 — Interactivity** | Search, Filter chips, Trace toolbar, MiniMap, Replay dot, Keyboard navigation, URL state, Subgraph isolation. | Each feature opt-out key in the reducer; default = off. | Manual QA on the demo fixture. |
| **P6 — Cutover** | Make Reactflow the default. Move the d3 file to `_legacy/`. | Restore the legacy export. | `git grep DataFlowGraph` returns only the new file + the kill switch. |

---

## 16 · Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| ELK mislays cyclic graphs | Med | Cycle-breaking strategy `DEPTH_FIRST`; tests with a fixture that has a self-referential edge (e.g. retry loop). |
| Loaded CSS conflicts with Tailwind preflight | Low | `@xyflow/react/dist/style.css` has no global resets; import once at the page boundary. |
| Theme flips leave XY styles stale | Low | All colors are `hsl(var(--viz-*))`; Reactflow does not cache the resolved value. |
| Reduced-motion users still see a perpetual dot | Low | `<ReplayDot>` is gated by both `edge.animated` AND `!useReducedMotion()`. Belt: also gated by `state.replayToken === 0` (no replay in flight). |
| Bundle size from elkjs for tiny charts | Low | Conditional import: `await import("elkjs")` inside the layout effect, dynamically. Drops out of the bundle for static builds. |
| Click-vs-drag tension on touch | Med | Reactflow's `panOnDrag` works fine on touch; double-click is emulated with two `tap`s. We add explicit "double-tap to isolate" affordance label. |
| Subgraph nesting depth > 1 | Low | Backend drives this; we cap at depth 2 in `groups.ts` (`getDepth(parent)`). |

---

## 17 · Open questions (resolved by working agreement)

1. **Library** — `@xyflow/react`. *(you've answered)*
2. **Editable mode** — `?editor=1` behind a flag. Drag-to-connect and
   double-click-to-add are wired but off by default.
3. **Code excerpt endpoint** — defer to a later release. The detail panel
   shows paths; clicking a path opens the file in the existing
   `CodeExplorer` (already a separate component).
4. **Subgraph source-of-truth** — `parent` field on the node, populated by
   `group_modules` in `backend/codekavi/orchestrator.py`. If absent, the
   chart stays flat (no synthetic groups).

---

## 18 · Step-by-step next actions

The following are the **first concrete tasks** to do, in order, sized to one
focused change each:

1. **Backend** — In `backend/codekavi/graph.py`, write
   `normalize_flow_node` and `derive_edge_direction`; write tests in
   `tests/test_graph_normalize.py`.
2. **Hook** — In `frontend/components/viz/useVizZoom.ts`, add the
   `ZoomController` type and make `register` accept it alongside d3
   behaviour. Update `DependencyGraph.tsx` to pass the new shape.
3. **CSS import** — In whichever file mounts the report route (search for
   `<DataFlowGraph`), `import "@xyflow/react/dist/style.css"` once.
4. **Scaffold the folder** — create `frontend/components/report/viz/dataflow/`
   with the file layout in §3 and an `index.ts` re-exporting `DataFlowGraph`.
5. **Templates** — start with `ActionNode` and `FlowEdge`. Get a 3-node
   fixture rendered before adding the rest.
6. **Layout** — wire ELK into the main effect; fit-to-view after.
7. **Reducer + selectors** — bring up `useReducer`, the highlight selector,
   and the `select`/`hover` interactions in that order.
8. **Detail panel** — render when `selected !== null`; cover all
   `FlowNode` fields.
9. **Interactivity** — search, filter chips, trace, miniMap, replay, keyboard,
   URL state — one PR per feature.
10. **Cutover** — drop the `?viz=` flag, demote d3 to `_legacy/`.

That sequence orders things so the chart is rendering something visible from
task 5 onwards. Each step is independently testable and reversible.

---

## Appendix A · AGENTS.md reminders for this work

From the project instructions:

- **No `postcss.config.*`** — Tailwind is compiled by its own CLI into
  `app/globals.css`; Reactflow rendering is unaffected, but **do not touch the
  build pipeline**.
- **`npm run dev`** runs `scripts/dev.mjs` (Tailwind watch + Next dev). Don't
  switch dev commands manually.
- **`scripts/reap-postcss-workers.mjs`** is run via `predev`; don't break it
  — anything that leaves orphan Node workers on Windows is a real cost.
- **Next 16 has breaking changes** — if you need an SSR pattern (we don't
  here; the chart mounts client-only behind a `"use client"` module),
  read `node_modules/next/dist/docs/` first.

## Appendix B · Glossary

- **Trace up / down** — upstream and downstream in the request DAG, ignoring
  `direction: "response"`.
- **Replay** — a one-shot animation of a dot riding an edge, retriggered by
  clicking the edge label.
- **Isolate** — fade every node/edge except one and its neighbourhood, exit
  with another dbl-click or `Esc`.
- **Highlight map** — the per-element `RFHighlight` table, single source of
  truth for visibility based on the reducer state.
- **Command surface** — keyboard: `Tab` enters, arrows move, `Enter` opens,
  `Esc` exits, `+ − 0` zooms, `/` focuses the search box.
