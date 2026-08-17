"use client";

/**
 * ArchitectureGraph — swim-lanes as real React Flow groups (mockup B).
 *
 * Replaces the D3 implementation: ELK seeds the geometry, then the canvas is
 * the user's — drag, pan, minimap, zoom. ELK lays out each lane's files on
 * its own, where every edge endpoint is a direct sibling — the case ELK
 * handles best — and the lanes themselves are stacked here, in read order.
 *
 * One node is one file — `/visualize/architecture` sends them all, with `type`
 * naming the lane. Hovering a file isolates its edges; clicking opens the
 * detail panel.
 *
 * Styling follows `arch-diagram-codekavi-theme.html`: tiers are dashed rules
 * with the name in the margin, a file is a card (kind / name / directory)
 * behind its accent rail, and an edge takes the colour of the lane it lands
 * in. The mockup's own labelled edges and pipeline strip are not portable —
 * it hardcodes nine services, this draws whatever repo was analysed.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  memo,
} from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  type Node as RFNodeBase,
  type Edge as RFEdge,
  type NodeMouseHandler,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { catVar, cssVar, inkDimVar } from "@/lib/viz/tokens";
import {
  VizShell,
  VizLegend,
  type VizLegendItem,
} from "@/components/viz/VizShell";
import { useVizCanvas } from "@/components/viz/useVizCanvas";
import { useVizZoom } from "@/components/viz/useVizZoom";
import { useReducedMotion } from "@/components/viz/useReducedMotion";
import { NodeHandles } from "@/components/report/viz/dataflow/nodes/shared";
import { assignClosestHandles } from "@/components/report/viz/dataflow/model";

interface Node {
  id: string;
  label: string;
  type: string;
}

interface Edge {
  source: string;
  target: string;
  label?: string;
}

interface ArchitectureGraphProps {
  nodes: Node[];
  edges: Edge[];
}

/** ELK's box for a file card. The rendered card fills it exactly. */
const NODE_W = 208;
const NODE_H = 62;

/**
 * Layer → categorical slot. Each layer draws its accent from one palette
 * entry; the lane fill is that same color at low alpha over the page surface,
 * so lanes read as tinted glass in both themes.
 */
const LAYER_SLOT: Record<string, number> = {
  routes: 5,
  services: 2,
  models: 1,
  database: 3,
  utils: 0,
  config: 3,
  tests: 7,
  frontend: 4,
  module: 2,
};

function accentOf(layer: string, alpha?: number): string {
  const slot = LAYER_SLOT[layer];
  return slot == null ? inkDimVar(alpha) : catVar(slot, alpha);
}

function washOf(layer: string): string {
  const slot = LAYER_SLOT[layer];
  return slot == null ? inkDimVar(0.07) : catVar(slot, 0.1);
}

/** Lane order is the read order: request in at the top, storage at the bottom. */
const layerOrder = [
  "routes",
  "services",
  "models",
  "database",
  "utils",
  "config",
  "tests",
  "frontend",
  "module",
  "other",
];

/** Unknown layers sort last rather than to the top. */
function layerRank(layer: string): number {
  const i = layerOrder.indexOf(layer);
  return i === -1 ? 99 : i;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const layerOf = (n: Node) => n.type?.toLowerCase() || "other";

/** `codekavi/routes/visualize.py` → `PY`. The card's small-caps kind line. */
function extOf(id: string): string {
  const base = id.slice(id.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toUpperCase() : "FILE";
}

/** `codekavi/routes/visualize.py` → `codekavi/routes`. */
function dirOf(id: string): string {
  const cut = id.lastIndexOf("/");
  return cut === -1 ? "root" : id.slice(0, cut);
}

/* ── Node renderers ───────────────────────────────────────── */

type Highlight = "hot" | "faded" | "";

/** The one accent for "this is what you're pointing at", chips and edges alike. */
const HOT = cssVar("viz-highlight");

interface LaneData extends Record<string, unknown> {
  label: string;
  accent: string;
  /** Painted by the minimap only — the lane itself is a rule, not a box. */
  wash: string;
  count: number;
}

interface FileData extends Record<string, unknown> {
  label: string;
  /** File extension, the card's small caps line. */
  kind: string;
  /** Directory the file sits in. */
  sub: string;
  accent: string;
  state: Highlight;
}

type RFNode = RFNodeBase<LaneData | FileData>;

/**
 * A tier band: a dashed rule with its name in the margin. Color is spent on
 * the cards and the wiring, not on the container — a tinted box behind
 * every card is a second row of chrome competing with the thing it holds.
 */
const LaneNode = memo(function LaneNode({ data }: { data: LaneData }) {
  return (
    <div className="h-full w-full border-t border-dashed border-border">
      <span className="absolute left-0 top-3 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground opacity-60">
        {data.label}
      </span>
      <span className="absolute right-0 top-3 text-[10px] tracking-[0.12em] text-muted-foreground opacity-60">
        {data.count}
      </span>
    </div>
  );
});

const FileNode = memo(function FileNode({ data }: { data: FileData }) {
  const hot = data.state === "hot";
  return (
    <div
      className="group relative h-full w-full overflow-hidden rounded-[10px] border bg-card/70 py-2.5 pl-[18px] pr-4 backdrop-blur-md transition-[border-color,box-shadow,opacity]"
      style={{
        borderColor: hot ? HOT : "hsl(var(--border))",
        boxShadow: hot ? `0 0 0 1px ${HOT}` : undefined,
        opacity: data.state === "faded" ? 0.25 : 1,
      }}
    >
      <NodeHandles />
      <span
        className="absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-r-sm opacity-85"
        style={{ background: data.accent }}
      />
      <div
        className="text-[8px] font-semibold uppercase leading-[11px] tracking-[0.12em] opacity-90"
        style={{ color: data.accent }}
      >
        {data.kind}
      </div>
      <div className="truncate text-[12px] font-semibold leading-[16px] text-foreground">
        {data.label}
      </div>
      <div className="truncate text-[10px] font-light leading-[13px] tracking-[0.04em] text-muted-foreground">
        {data.sub}
      </div>
    </div>
  );
});

const nodeTypes = Object.freeze({
  lane: LaneNode,
  file: FileNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as Record<string, React.ComponentType<any>>;

/* ── Layout ───────────────────────────────────────────────── */

async function getElk() {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  return new ELK();
}

interface LaidOut {
  nodes: RFNode[];
  edges: RFEdge[];
}

export async function runLaneLayout(
  nodes: Node[],
  edges: Edge[],
): Promise<LaidOut> {
  const elk = await getElk();
  const laneOf = new Map(nodes.map((n) => [n.id, layerOf(n)]));
  const lanes = [...new Set(nodes.map(layerOf))].sort(
    (a, b) => layerRank(a) - layerRank(b),
  );
  // Edges pointing at nodes that are not in the payload would make ELK throw
  // and take the whole layout with them.
  const known = edges.filter(
    (e) =>
      laneOf.has(e.source) && laneOf.has(e.target) && e.source !== e.target,
  );

  const inner = await Promise.all(
    lanes.map((lane) => {
      const own = nodes.filter((n) => layerOf(n) === lane);
      const ids = new Set(own.map((n) => n.id));
      return elk.layout({
        id: lane,
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.spacing.nodeNode": "18",
          "elk.layered.spacing.nodeNodeBetweenLayers": "28",
          "elk.padding": "[top=44,left=20,bottom=20,right=20]",
        },
        children: own.map((n) => ({ id: n.id, width: NODE_W, height: NODE_H })),
        edges: known
          .filter((e) => ids.has(e.source) && ids.has(e.target))
          .map((e, i) => ({
            id: `${lane}-${i}`,
            sources: [e.source],
            targets: [e.target],
          })),
      });
    }),
  );

  const rfNodes: RFNode[] = [];

  // Tiers are a fixed stack in read order, full width, each row centred in its
  // band. No second ELK pass: a graph-of-lanes layout puts every lane with no
  // cross-edge into one layer — same y, side by side — which is the opposite
  // of a band, and the y it produced was the only thing left to take from it.
  const laneW = Math.max(...inner.map((g) => g.width ?? 0));
  const indentOf = (g: (typeof inner)[number]) => (laneW - (g.width ?? 0)) / 2;
  const laneGap = 40;
  let laneY = 0;

  // Parents first — React Flow requires a parent to precede its children.
  inner.forEach((g) => {
    rfNodes.push({
      id: `lane-${g.id}`,
      type: "lane",
      position: { x: 0, y: laneY },
      width: laneW,
      height: g.height,
      data: {
        label: titleCase(g.id),
        accent: accentOf(g.id),
        wash: washOf(g.id),
        count: g.children?.length ?? 0,
      },
      selectable: false,
      draggable: false,
      zIndex: 0,
    });
    laneY += (g.height ?? 0) + laneGap;
  });
  inner.forEach((g) => {
    const indent = indentOf(g);
    (g.children ?? []).forEach((c) => {
      const node = nodes.find((n) => n.id === c.id)!;
      rfNodes.push({
        id: c.id,
        type: "file",
        parentId: `lane-${g.id}`,
        extent: "parent",
        position: { x: (c.x ?? 0) + indent, y: c.y ?? 0 },
        width: NODE_W,
        height: NODE_H,
        data: {
          label: node.label,
          kind: extOf(node.id),
          sub: dirOf(node.id),
          accent: accentOf(layerOf(node)),
          state: "",
        },
      });
    });
  });

  const laneOfNode = new Map(nodes.map((n) => [n.id, layerOf(n)]));

  const rfEdges: RFEdge[] = known.map((e, i) => {
    // An edge takes the colour of what it arrives at, so a card's inbound
    // wiring names its destination lane at a glance.
    const accent = accentOf(laneOfNode.get(e.target) ?? "other");
    return {
      id: `e${i}`,
      source: e.source,
      target: e.target,
      label: e.label,
      type: "default",
      data: { accent },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: accent,
      },
    };
  });

  // Leave each chip from the side that faces the target. Fixed bottom→top
  // handles make every edge that isn't going straight down — a sibling in the
  // same lane, a dependency on a lane above — dive under its own chip and hook
  // back around, and those detours are most of what reads as tangle.
  return { nodes: rfNodes, edges: assignClosestHandles(rfNodes, rfEdges) };
}

/* ── Chart ────────────────────────────────────────────────── */

function ArchitectureGraphInner({ nodes, edges }: ArchitectureGraphProps) {
  const rf = useReactFlow();
  const canvas = useVizCanvas();
  const zoom = useVizZoom();
  const reducedMotion = useReducedMotion();

  const [rfNodes, setRfNodes] = useState<RFNode[]>([]);
  const [rfEdges, setRfEdges] = useState<RFEdge[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Stored as an id, not the node: `nodes` can change under us, and looking the
  // node up on each render means a selection whose node has gone simply closes
  // instead of stranding a stale panel.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Which `nodes` array the viewport was last fitted to. */
  const fittedFor = useRef<Node[] | null>(null);

  /** One key per layer actually present, in lane order, with its node count. */
  const legendItems: VizLegendItem[] = useMemo(() => {
    const counts = new Map<string, number>();
    nodes.forEach((n) => {
      const layer = layerOf(n);
      counts.set(layer, (counts.get(layer) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort(([a], [b]) => layerRank(a) - layerRank(b))
      .map(([layer, count]) => ({
        color: accentOf(layer),
        label: `${titleCase(layer)} (${count})`,
      }));
  }, [nodes]);

  useEffect(() => {
    if (nodes.length === 0) {
      // Deferred a frame — a synchronous setState in an effect body cascades.
      const frame = requestAnimationFrame(() => {
        setRfNodes([]);
        setRfEdges([]);
      });
      return () => cancelAnimationFrame(frame);
    }
    let cancelled = false;
    runLaneLayout(nodes, edges)
      .then((laid) => {
        if (cancelled) return;
        setRfNodes(laid.nodes);
        setRfEdges(laid.edges);
        // Only on a new graph — refitting on a re-layout would yank the
        // viewport away from wherever the user panned to.
        if (fittedFor.current === nodes) return;
        fittedFor.current = nodes;
        requestAnimationFrame(() => rf.fitView({ duration: 0, padding: 0.12 }));
      })
      .catch((err) => {
        console.error("[ArchitectureGraph] ELK layout failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [nodes, edges, rf]);

  useEffect(() => {
    zoom.register(null, {
      zoomIn: () => rf.zoomIn({ duration: reducedMotion ? 0 : 200 }),
      zoomOut: () => rf.zoomOut({ duration: reducedMotion ? 0 : 200 }),
      fitToView: () =>
        rf.fitView({ duration: reducedMotion ? 0 : 300, padding: 0.12 }),
    });
  }, [rf, zoom, reducedMotion]);

  /** Direct neighbours of every node, for hover isolation. */
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set()]));
    edges.forEach((e) => {
      m.get(e.source)?.add(e.target);
      m.get(e.target)?.add(e.source);
    });
    return m;
  }, [nodes, edges]);

  const stateOf = useCallback(
    (id: string): Highlight => {
      if (!hoveredId) return "";
      if (id === hoveredId) return "hot";
      return neighbours.get(hoveredId)?.has(id) ? "" : "faded";
    },
    [hoveredId, neighbours],
  );

  const visibleNodes = useMemo<RFNode[]>(() => {
    return rfNodes.map((n) =>
      n.type === "file"
        ? { ...n, data: { ...(n.data as FileData), state: stateOf(n.id) } }
        : n,
    );
  }, [rfNodes, stateOf]);

  const visibleEdges = useMemo<RFEdge[]>(() => {
    return rfEdges.map((e) => {
      const hot =
        hoveredId !== null &&
        (e.source === hoveredId || e.target === hoveredId);
      const accent = (e.data as { accent?: string })?.accent ?? inkDimVar(0.55);
      return {
        ...e,
        // Marching dashes are the hover reward, not the resting state — every
        // edge animating at once is what makes the first look a mess.
        animated: hot && !reducedMotion,
        markerEnd: hot
          ? { type: MarkerType.ArrowClosed, width: 14, height: 14, color: HOT }
          : e.markerEnd,
        style: {
          stroke: hot ? HOT : accent,
          strokeWidth: hot ? 2 : 1.2,
          // At rest the wiring is a faint substrate: enough to see that the
          // lanes are connected, not enough to compete with the cards. Hover
          // is what makes one path legible.
          opacity: hot ? 1 : hoveredId ? 0.06 : 0.45,
        },
        zIndex: hot ? 1 : 0,
      };
    });
  }, [rfEdges, hoveredId, reducedMotion]);

  const handleNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    if (node.type === "file") setSelectedId(node.id);
  }, []);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <VizShell
      canvas={canvas}
      zoom={zoom}
      label="Architecture diagram"
      description={
        `Files grouped into ${legendItems.length} layered swim-lanes, ` +
        "flowing top to bottom. Color indicates the layer and arrows point " +
        `from a file to what it depends on. ${nodes.length} files, ` +
        `${edges.length} dependencies. Nodes are draggable, and clicking one ` +
        "opens its connections."
      }
      legend={<VizLegend title="Layers" items={legendItems} />}
    >
      <div className="relative h-full w-full">
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          onNodesChange={(changes) =>
            setRfNodes((nds) => applyNodeChanges(changes, nds))
          }
          onEdgesChange={(changes) =>
            setRfEdges((eds) => applyEdgeChanges(changes, eds))
          }
          onNodeClick={handleNodeClick}
          onNodeMouseEnter={(_evt, n) =>
            setHoveredId(n.type === "file" ? n.id : null)
          }
          onNodeMouseLeave={() => setHoveredId(null)}
          onPaneClick={() => setSelectedId(null)}
          nodesConnectable={false}
          nodesDraggable
          fitView={false}
          minZoom={0.15}
          panOnDrag
          zoomOnScroll={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <MiniMap
            pannable
            zoomable
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            nodeColor={(n: any) => (n?.data?.wash ?? n?.data?.accent) as string}
            maskColor="hsl(var(--background) / 0.85)"
            nodeStrokeWidth={0}
          />
        </ReactFlow>

        {selected && (
          <NodeDetail
            node={selected}
            nodes={nodes}
            edges={edges}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </VizShell>
  );
}

export const ArchitectureGraph = forwardRef<
  HTMLDivElement,
  ArchitectureGraphProps
>(function ArchitectureGraph(props, ref) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useImperativeHandle(ref, () => el!, [el]);
  return (
    <div ref={setEl} className="h-full w-full">
      <ReactFlowProvider>
        <ArchitectureGraphInner {...props} />
      </ReactFlowProvider>
    </div>
  );
});

/**
 * What a node click reveals. The chip shows a name and its lane — neither
 * answers "what does this connect to", which is the question an architecture
 * diagram exists to answer.
 */
function NodeDetail({
  node,
  nodes,
  edges,
  onClose,
}: {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
}) {
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const dependsOn = edges
    .filter((e) => e.source === node.id)
    .map((e) => labelOf(e.target));
  const usedBy = edges
    .filter((e) => e.target === node.id)
    .map((e) => labelOf(e.source));

  return (
    <div className="glass-panel absolute top-3 left-3 z-20 max-w-xs rounded-lg px-4 py-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-foreground break-words">
            {node.label}
          </div>
          <div className="mt-0.5 uppercase tracking-wide text-[10px] text-muted-foreground">
            {node.type || "other"}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>

      <ConnectionList title="Depends on" items={dependsOn} />
      <ConnectionList title="Used by" items={usedBy} />

      {dependsOn.length === 0 && usedBy.length === 0 && (
        // Said plainly: an isolated node is a finding, not an empty panel.
        <p className="mt-2 text-muted-foreground">
          No connections in this view.
        </p>
      )}
    </div>
  );
}

function ConnectionList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {title} ({items.length})
      </div>
      <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
        {items.map((label) => (
          <div
            key={label}
            className="truncate font-mono text-[11px] text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
