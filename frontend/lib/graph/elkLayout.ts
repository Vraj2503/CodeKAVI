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
import type { ElkWorkerRequest, ElkWorkerResponse } from "./elkLayout.worker";

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

const LAYOUT_TIMEOUT_MS = 4000;

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

function containerSize(fileCount: number): { width: number; height: number } {
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

/** Stage 1 input: one layer's containers as sized atoms. Pure, no I/O. */
export function buildContainerGraph(
  payload: RepoGraphPayload,
  layerId: string,
): ElkNode {
  const containers = payload.containers.filter((c) => c.layer_id === layerId);
  const containerIds = new Set(containers.map((c) => c.id));

  const children: ElkNode[] = containers.map(
    (container: RepoGraphContainer) => {
      const { width, height } = containerSize(container.file_ids.length);
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

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<
  number,
  { resolve: (graph: ElkNode) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("./elkLayout.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (event: MessageEvent<ElkWorkerResponse>) => {
    const { requestId } = event.data;
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    if (event.data.layout) entry.resolve(event.data.layout);
    else entry.reject(new Error(event.data.error));
  };
  worker.onerror = () => {
    for (const [requestId, entry] of pending) {
      entry.reject(new Error("ELK worker crashed"));
      pending.delete(requestId);
    }
  };
  return worker;
}

function runElkLayout(graph: ElkNode): Promise<ElkNode> {
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("ELK layout timed out"));
    }, LAYOUT_TIMEOUT_MS);

    pending.set(requestId, {
      resolve: (graph) => {
        clearTimeout(timer);
        resolve(graph);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });

    const request: ElkWorkerRequest = { requestId, graph };
    getWorker().postMessage(request);
  });
}

async function layout(graph: ElkNode): Promise<LayoutResult> {
  const nodeBoxes = (graph.children ?? []).map((child) => ({
    id: child.id,
    width: child.width ?? FILE_NODE_WIDTH,
    height: child.height ?? FILE_NODE_HEIGHT,
  }));

  try {
    const laidOut = await runElkLayout(graph);
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
  } catch {
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
): Promise<LayoutResult> {
  return layout(buildContainerGraph(payload, layerId));
}

/** Stage 2: lay out an expanded container's files. Falls back to a grid on worker failure. */
export function layoutContainerChildren(
  payload: RepoGraphPayload,
  containerId: string,
): Promise<LayoutResult> {
  return layout(buildFileGraph(payload, containerId));
}
