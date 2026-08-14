// dataflow/model.ts — prop shape → xyflow shapes + types
import type { Node, Edge } from "@xyflow/react";

// ── Public contract (matches backend normalize_flow_node) ──────────────

export type NodeKind =
  | "start"
  | "end" // io nodes
  | "action" // process
  | "decision" // branch
  | "transform"
  | "data_store";

export type EdgeKind = "http" | "db" | "file" | "event" | "internal";
export type EdgeDirection = "request" | "response" | "internal";
export type RFHighlight =
  "off" | "dim" | "hover" | "trace-up" | "trace-down" | "select";
export type RFNodeKind = NodeKind | "group";

export interface FlowNode {
  id: string;
  label: string;
  kind: NodeKind;
  shape?: "rounded_rect" | "cylinder" | "parallelogram" | "hexagon";
  tier?: number;
  // legacy compat — backend may still send `type` before full cutover
  type?: string;
  description?: string;
  source_files?: string[];
  source?: { kind: "http" | "queue" | "file" | "cron" | "event"; spec: string };
  reads?: string[];
  writes?: string[];
  inputs?: { name: string; type: string }[];
  outputs?: { name: string; type: string }[];
  parent?: string;
  technologies?: FlowTechnology[];
}

export interface FlowTechnology {
  id: string;
  label: string;
  role: string;
  kind: Extract<NodeKind, "action" | "transform" | "data_store">;
  source_files?: string[];
}

export interface FlowEdge {
  source: string;
  target: string;
  label?: string;
  data_type?: EdgeKind;
  animated?: boolean;
  direction?: EdgeDirection;
  payload?: string;
  status?: "ok" | "err" | "stream";
  /** Added only when the analyzer must bridge otherwise disconnected stages. */
  inferred?: boolean;
}

export interface DataFlowGraphProps {
  nodes: FlowNode[];
  edges: FlowEdge[];
  editor?: boolean;
  initialFocusId?: string | null;
}

// ── Internal Reactflow shapes ──────────────────────────────────────────

export interface RFNodeData extends Record<string, unknown> {
  flow: FlowNode;
  highlight: RFHighlight;
  detailCount?: number;
  expanded?: boolean;
}

export interface RFEdgeData extends Record<string, unknown> {
  flow: FlowEdge;
  highlight: RFHighlight;
  replayToken: number;
  replayRun?: number;
  replayStep?: number;
}

export type RFNode = Node<RFNodeData, RFNodeKind>;
export type RFEdge = Edge<RFEdgeData, "flow">;

// ── Conversion helpers ──────────────────────────────────────────────────

const ALL_NODE_WIDTHS: Record<RFNodeKind, number> = {
  start: 160,
  end: 160,
  action: 160,
  decision: 140,
  transform: 160,
  data_store: 160,
  group: 200,
};

const ALL_NODE_HEIGHTS: Record<RFNodeKind, number> = {
  start: 52,
  end: 52,
  action: 52,
  decision: 52,
  transform: 52,
  data_store: 68, // cylinder is taller
  group: 80,
};

/** Coerce a legacy `type` string to a valid NodeKind. */
function coerceKind(node: FlowNode): NodeKind {
  if (node.kind) return node.kind;
  // fallback from old `type` field
  const t = node.type ?? "action";
  if (t === "io") return "start";
  if (t === "process") return "action";
  if (t === "transform") return "transform";
  if (t === "data_store") return "data_store";
  return "action";
}

/** Convert backend FlowNode[] → Reactflow Node[] */
export function toRFNodes(
  nodes: FlowNode[],
  expanded: ReadonlySet<string> = new Set(),
): RFNode[] {
  const leafNodes: RFNode[] = nodes.map((n) => {
    const kind = coerceKind(n);
    return {
      id: n.id,
      type: kind as RFNodeKind,
      position: { x: 0, y: 0 }, // ELK will override
      width: ALL_NODE_WIDTHS[kind],
      height: ALL_NODE_HEIGHTS[kind],
      data: {
        flow: { ...n, kind },
        highlight: "off",
        detailCount: n.technologies?.length ?? 0,
        expanded: expanded.has(n.id),
      },
      parentId: `category-frame-${kind}`,
      extent: "parent" as const,
    };
  });

  const presentKinds = new Set(
    leafNodes.map((n) => n.data.flow.kind as NodeKind),
  );

  const groupNodes = Array.from(presentKinds).map((kind) => {
    const kindKey = kind as NodeKind;
    return {
      id: `category-frame-${kindKey}`,
      type: "group" as const,
      position: { x: 0, y: 0 },
      zIndex: -1,
      draggable: true,
      selectable: false,
      focusable: false,
      data: {
        flow: {
          id: `category-frame-${kindKey}`,
          label: KIND_LABEL[kindKey],
          kind: kindKey,
        },
        highlight: "off" as const,
      },
    };
  });

  return [...groupNodes, ...leafNodes];
}

/** Convert backend FlowEdge[] → Reactflow Edge[] */
export function toRFEdges(edges: FlowEdge[]): RFEdge[] {
  return edges.map((e, i) => ({
    id: `e-${e.source}-${e.target}-${i}`,
    source: e.source,
    target: e.target,
    sourceHandle: "out",
    targetHandle: "in",
    animated: true,
    type: "flow" as const,
    markerEnd: `url(#flow-arrow-${e.data_type ?? "fallback"}${e.direction === "response" ? "-dashed" : ""})`,
    data: {
      flow: e,
      highlight: "off",
      replayToken: 0,
    },
  }));
}

/** The only node/edge shape edge routing needs — any React Flow graph fits. */
type PositionedNode = {
  id: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  parentId?: string;
  measured?: { width?: number; height?: number };
};
type RoutableEdge = { source: string; target: string };

/** Absolute position of a node, walking up any parentId chain. */
function absoluteBox(node: PositionedNode, byId: Map<string, PositionedNode>) {
  let x = node.position.x;
  let y = node.position.y;
  let parent = node.parentId ? byId.get(node.parentId) : undefined;
  const seen = new Set<string>([node.id]);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    x += parent.position.x;
    y += parent.position.y;
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  const w = node.width ?? node.measured?.width ?? 0;
  const h = node.height ?? node.measured?.height ?? 0;
  return { x, y, w, h };
}

/**
 * Route each edge out of the side that actually faces its target: whichever
 * axis has the larger edge-to-edge gap wins, so stacked lanes connect
 * bottom→top and side-by-side files connect right→left. Nodes must render
 * `NodeHandles` (ids `<side>-src` / `<side>-tgt`). Edges whose endpoints are
 * missing pass through untouched.
 */
export function assignClosestHandles<E extends RoutableEdge>(
  nodes: PositionedNode[],
  edges: E[],
): E[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.map((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return edge;

    const a = absoluteBox(source, byId);
    const b = absoluteBox(target, byId);
    const dx = b.x + b.w / 2 - (a.x + a.w / 2);
    const dy = b.y + b.h / 2 - (a.y + a.h / 2);
    const [src, tgt] =
      Math.abs(dx) - (a.w + b.w) / 2 >= Math.abs(dy) - (a.h + b.h) / 2
        ? dx >= 0
          ? ["right", "left"]
          : ["left", "right"]
        : dy >= 0
          ? ["bottom", "top"]
          : ["top", "bottom"];
    return { ...edge, sourceHandle: `${src}-src`, targetHandle: `${tgt}-tgt` };
  });
}

function componentSets(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[][] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const adjacent = new Map<string, Set<string>>();
  for (const node of nodes) adjacent.set(node.id, new Set());
  for (const edge of edges) {
    if (
      edge.direction === "response" ||
      !byId.has(edge.source) ||
      !byId.has(edge.target)
    )
      continue;
    adjacent.get(edge.source)!.add(edge.target);
    adjacent.get(edge.target)!.add(edge.source);
  }
  const remaining = new Set(byId.keys());
  const components: FlowNode[][] = [];
  while (remaining.size) {
    const [first] = remaining;
    const component: FlowNode[] = [];
    const queue = [first];
    remaining.delete(first);
    while (queue.length) {
      const id = queue.shift()!;
      component.push(byId.get(id)!);
      for (const next of adjacent.get(id) ?? []) {
        if (remaining.delete(next)) queue.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * Preserve real edges, then join disconnected conceptual islands with clearly
 * labelled continuity edges. The largest workflow is treated as the backbone;
 * a Dashboard is always the final web-app destination.
 */
export function prepareFlowGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const validNodes = nodes.filter((node) => Boolean(node.id));
  const ids = new Set(validNodes.map((node) => node.id));
  const validEdges = edges.filter(
    (edge) =>
      ids.has(edge.source) &&
      ids.has(edge.target) &&
      edge.source !== edge.target,
  );
  const components = componentSets(validNodes, validEdges);
  const dashboardComponent = components.find((component) =>
    component.some((node) => /dashboard/i.test(node.label)),
  );
  const ordered = components
    .filter((component) => component !== dashboardComponent)
    .sort(
      (a, b) =>
        b.length - a.length ||
        Math.max(...b.map((node) => node.tier ?? 0)) -
          Math.max(...a.map((node) => node.tier ?? 0)),
    );
  if (dashboardComponent) ordered.push(dashboardComponent);

  const inferred: FlowEdge[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    const currentIds = new Set(current.map((node) => node.id));
    const nextIds = new Set(next.map((node) => node.id));
    const source =
      current
        .filter(
          (node) =>
            !validEdges.some(
              (edge) => edge.source === node.id && currentIds.has(edge.target),
            ),
        )
        .sort((a, b) => (b.tier ?? 0) - (a.tier ?? 0))[0] ?? current[0];
    const target =
      next
        .filter(
          (node) =>
            !validEdges.some(
              (edge) => edge.target === node.id && nextIds.has(edge.source),
            ),
        )
        .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0))[0] ?? next[0];
    inferred.push({
      source: source.id,
      target: target.id,
      label: "continues",
      payload: "inferred continuity",
      data_type: "internal",
      inferred: true,
    });
  }

  const connectedEdges = [...validEdges, ...inferred];
  const incoming = new Set(
    connectedEdges
      .filter((edge) => edge.direction !== "response")
      .map((edge) => edge.target),
  );
  const outgoing = new Set(
    connectedEdges
      .filter((edge) => edge.direction !== "response")
      .map((edge) => edge.source),
  );
  let finalEdges = connectedEdges.map((e) => ({ ...e }));
  const finalNodes: FlowNode[] = [];

  for (const node of validNodes) {
    const isDashboard = /dashboard/i.test(node.label);
    if (isDashboard) {
      const entryId = `${node.id}-entry`;
      const exitId = `${node.id}-exit`;

      finalNodes.push({
        ...node,
        id: entryId,
        label: "Dashboard",
        kind: "start",
      });
      finalNodes.push({ ...node, id: exitId, label: "Dashboard", kind: "end" });

      finalEdges = finalEdges.map((edge) => ({
        ...edge,
        source: edge.source === node.id ? entryId : edge.source,
        target: edge.target === node.id ? exitId : edge.target,
      }));
    } else {
      if (!outgoing.has(node.id)) finalNodes.push({ ...node, kind: "end" });
      else if (!incoming.has(node.id))
        finalNodes.push({
          ...node,
          kind: node.kind === "data_store" ? "data_store" : "start",
        });
      else finalNodes.push(node);
    }
  }

  return {
    edges: finalEdges,
    nodes: finalNodes,
  };
}

/**
 * Expands a conceptual stage into the products detected in its source files.
 * The original stage stays in the primary flow; product nodes branch from it,
 * so expanding never changes the entry-to-exit semantics of the diagram.
 */
export function expandTechnologies(
  nodes: FlowNode[],
  edges: FlowEdge[],
  expanded: ReadonlySet<string>,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const detailNodes: FlowNode[] = [];
  const detailEdges: FlowEdge[] = [];

  for (const node of nodes) {
    if (!expanded.has(node.id)) continue;
    for (const tech of node.technologies ?? []) {
      const id = `${node.id}::tech::${tech.id}`;
      detailNodes.push({
        id,
        label: tech.label,
        kind: tech.kind,
        tier: (node.tier ?? 0) + 1,
        description: tech.role,
        source_files: tech.source_files,
      });
      detailEdges.push({
        source: node.id,
        target: id,
        label: "uses",
        payload: tech.role,
        data_type: tech.kind === "data_store" ? "db" : "internal",
      });
    }
  }
  return {
    nodes: [...nodes, ...detailNodes],
    edges: [...edges, ...detailEdges],
  };
}

export const ALL_NODE_KINDS: NodeKind[] = [
  "start",
  "end",
  "action",
  "decision",
  "transform",
  "data_store",
];

export const ALL_EDGE_KINDS: EdgeKind[] = [
  "http",
  "db",
  "file",
  "event",
  "internal",
];

export const KIND_LABEL: Record<string, string> = {
  start: "Entry",
  end: "Exit",
  action: "Process",
  decision: "Branch",
  transform: "Transform",
  data_store: "Data Store",
  group: "Group",
};

export const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  http: "HTTP",
  db: "Database",
  file: "File",
  event: "Event",
  internal: "Local Flow",
};
