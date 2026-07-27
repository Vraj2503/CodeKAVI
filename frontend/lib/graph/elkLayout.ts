import type {
  ElkNode,
  ElkExtendedEdge,
  LayoutOptions,
} from "elkjs/lib/elk-api";
import type {
  RepoGraphPayload,
  RepoGraphContainer,
  RepoGraphEdge,
} from "@/lib/api";

// Stage 1 — containers as opaque atoms, sized sqrt(childCount), capped at
// 800x600 per the design spec.
const CONTAINER_SIZE_UNIT = 60;
const CONTAINER_MIN_SIZE = 90;
const CONTAINER_MAX_WIDTH = 800;
const CONTAINER_MAX_HEIGHT = 600;

// Stage 2 — file nodes. FileNode.tsx (step 8) owns the real visual sizing;
// this is only what ELK needs to compute positions.
export const FILE_NODE_WIDTH = 180;
export const FILE_NODE_HEIGHT = 56;

const ELK_LAYOUT_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "60",
};

export interface NodeBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutResult {
  positions: Record<string, NodeBox>;
  usedFallback: boolean;
}

export function containerSize(fileCount: number): {
  width: number;
  height: number;
} {
  const side = Math.min(
    Math.max(CONTAINER_SIZE_UNIT * Math.sqrt(fileCount), CONTAINER_MIN_SIZE),
    CONTAINER_MAX_WIDTH,
  );
  return { width: side, height: Math.min(side, CONTAINER_MAX_HEIGHT) };
}

function toElkEdges(
  edges: RepoGraphEdge[],
  level: RepoGraphEdge["level"],
  idSet: Set<string>,
): ElkExtendedEdge[] {
  return edges
    .filter(
      (edge) =>
        edge.level === level &&
        edge.source !== edge.target &&
        idSet.has(edge.source) &&
        idSet.has(edge.target),
    )
    .map((edge) => ({
      id: `${edge.source}->${edge.target}`,
      sources: [edge.source],
      targets: [edge.target],
    }));
}

/**
 * Stage 1 input: one layer's containers as sized atoms. Pure, no I/O.
 * `sizeOverrides` supplies real (expanded) box sizes for containers the user has
 * opened, so ELK reflows their neighbors aside instead of overlapping them.
 */
export function buildContainerGraph(
  payload: RepoGraphPayload,
  layerId: string,
  sizeOverrides: Record<string, { width: number; height: number }> = {},
): ElkNode {
  const containers = payload.containers.filter((c) => c.layer_id === layerId);
  const containerIds = new Set(containers.map((c) => c.id));

  const children: ElkNode[] = containers.map(
    (container: RepoGraphContainer) => {
      const { width, height } =
        sizeOverrides[container.id] ?? containerSize(container.file_ids.length);
      return { id: container.id, width, height };
    },
  );

  return {
    id: `layer:${layerId}`,
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children,
    edges: toElkEdges(payload.edges, "container", containerIds),
  };
}

/** Stage 2 input: one expanded container's files. Pure, no I/O. */
export function buildFileGraph(
  payload: RepoGraphPayload,
  containerId: string,
): ElkNode {
  const container = payload.containers.find((c) => c.id === containerId);
  if (!container) {
    throw new Error(`Unknown container: ${containerId}`);
  }
  const fileIds = new Set(container.file_ids);

  const children: ElkNode[] = container.file_ids.map((id) => ({
    id,
    width: FILE_NODE_WIDTH,
    height: FILE_NODE_HEIGHT,
  }));

  return {
    id: `container:${containerId}`,
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children,
    edges: toElkEdges(payload.edges, "file", fileIds),
  };
}

/**
 * Deterministic grid, used when the ELK worker fails or times out. Cell size
 * is the largest node's box so nodes never overlap regardless of individual
 * container/file sizing.
 */
export function gridFallback(
  nodes: { id: string; width: number; height: number }[],
  gap = 20,
): Record<string, { x: number; y: number }> {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const cellWidth = Math.max(gap, ...nodes.map((n) => n.width)) + gap;
  const cellHeight = Math.max(gap, ...nodes.map((n) => n.height)) + gap;

  const positions: Record<string, { x: number; y: number }> = {};
  nodes.forEach((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    positions[node.id] = { x: col * cellWidth, y: row * cellHeight };
  });
  return positions;
}

// Main-thread ELK. The Web Worker path never responded under Next 16 +
// Turbopack, so every layout silently timed out and fell back to a grid.
// Layouts here are always small (one layer's containers, or one container's
// files), so main-thread layout has no meaningful jank.
let elkPromise: Promise<import("elkjs/lib/elk-api").ELK> | null = null;
function getElk() {
  if (!elkPromise) {
    elkPromise = import("elkjs/lib/elk.bundled.js").then(
      (m) => new m.default(),
    );
  }
  return elkPromise;
}

/** Pre-load the ~1MB ELK bundle on mount so the first drill-in / tour step is instant. */
export function warmElkLayout(): void {
  void getElk();
}

async function layout(graph: ElkNode): Promise<LayoutResult> {
  const nodeBoxes = (graph.children ?? []).map((child) => ({
    id: child.id,
    width: child.width ?? FILE_NODE_WIDTH,
    height: child.height ?? FILE_NODE_HEIGHT,
  }));

  try {
    const elk = await getElk();
    const laidOut = await elk.layout(graph);
    const positions: Record<string, NodeBox> = {};
    for (const child of laidOut.children ?? []) {
      positions[child.id] = {
        id: child.id,
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? FILE_NODE_WIDTH,
        height: child.height ?? FILE_NODE_HEIGHT,
      };
    }
    return { positions, usedFallback: false };
  } catch (error) {
    // The bare `catch {}` this replaces swallowed the reason entirely, so a
    // grid fallback was indistinguishable from a timeout, a worker crash, or
    // an ELK input error. graph.id is already `layer:<id>` / `container:<id>`.
    console.error(
      `[elkLayout] ${graph.id} fell back to grid after ${nodeBoxes.length} nodes / ${graph.edges?.length ?? 0} edges:`,
      error,
    );
    const grid = gridFallback(nodeBoxes);
    const positions: Record<string, NodeBox> = {};
    for (const box of nodeBoxes) {
      positions[box.id] = { ...box, ...grid[box.id] };
    }
    return { positions, usedFallback: true };
  }
}

/** Stage 1: lay out a layer's containers. Falls back to a grid on worker failure. */
export function layoutContainers(
  payload: RepoGraphPayload,
  layerId: string,
  sizeOverrides: Record<string, { width: number; height: number }> = {},
): Promise<LayoutResult> {
  return layout(buildContainerGraph(payload, layerId, sizeOverrides));
}

/** Stage 2: lay out an expanded container's files. Falls back to a grid on worker failure. */
export function layoutContainerChildren(
  payload: RepoGraphPayload,
  containerId: string,
): Promise<LayoutResult> {
  return layout(buildFileGraph(payload, containerId));
}
