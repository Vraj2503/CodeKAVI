import type { Node, Edge } from "@xyflow/react";
import type { RepoGraphPayload } from "@/lib/api";
import type { NodeBox } from "./elkLayout";
import { countFlags, type GraphFlag } from "./flags";
import type { LayerNodeType } from "@/components/graph/LayerNode";
import type { ContainerNodeType } from "@/components/graph/ContainerNode";
import type { FileNodeType } from "@/components/graph/FileNode";
import type { PortalNodeType } from "@/components/graph/PortalNode";

const LAYER_NODE_WIDTH = 260;
/** LayerNode chrome: px-4 py-3 (24) + the text-sm title row (20) + gap-2 (8),
 * plus one text-xs line per stat. No floor: the card ends at its last stat. */
const LAYER_CARD_CHROME = 56;
const LAYER_STAT_ROW = 16;
/** Overview grid gap. Wider than PORTAL_GAP: layer cards are the only thing on
 * that level, so they get room the layer view can't spare. */
const LAYER_GRID_GAP = 48;
export const PORTAL_NODE_WIDTH = 160;
export const PORTAL_NODE_HEIGHT = 44;

const CONTAINER_HEADER_HEIGHT = 40;
const CONTAINER_PADDING = 16;
const PORTAL_GAP = 24;

/**
 * The box an expanded container needs to enclose its files + chrome, never
 * smaller than its collapsed box. Single source of truth for both the rendered
 * container node (below) and stage-1 ELK reflow sizing (`sizeOverrides`).
 */
export function expandedContainerBox(
  collapsed: { width: number; height: number },
  filePositions: Record<string, NodeBox>,
): { width: number; height: number } {
  const boxes = Object.values(filePositions);
  const rightEdge = Math.max(0, ...boxes.map((b) => b.x + b.width));
  const bottomEdge = Math.max(0, ...boxes.map((b) => b.y + b.height));
  return {
    width: Math.max(collapsed.width, rightEdge + CONTAINER_PADDING * 2),
    height: Math.max(
      collapsed.height,
      bottomEdge + CONTAINER_HEADER_HEIGHT + CONTAINER_PADDING,
    ),
  };
}

/** Edges this node depends on — its outgoing count at the given level. */
function countOutgoing(
  edges: RepoGraphPayload["edges"],
  level: RepoGraphPayload["edges"][number]["level"],
  id: string,
): number {
  let outCount = 0;
  for (const edge of edges) {
    if (edge.level === level && edge.source === id) outCount += edge.count;
  }
  return outCount;
}

/** Computes the layer card sizing metadata used by both ELK layout and node creation. */
export function computeLayerCards(payload: RepoGraphPayload) {
  return payload.layers.map((layer) => {
    const layerFiles = payload.files.filter((f) => f.layer_id === layer.id);
    const flagCounts = countFlags(layerFiles);
    const outCount = countOutgoing(payload.edges, "layer", layer.id);
    const rows = 1 + flagCounts.length + (outCount > 0 ? 1 : 0);
    return {
      id: layer.id,
      layer,
      flagCounts,
      outCount,
      width: LAYER_NODE_WIDTH,
      height: LAYER_CARD_CHROME + LAYER_STAT_ROW * rows,
    };
  });
}

/** Overview: one card per layer, positioned by pre-computed ELK layout. */
export function buildOverviewGraph(
  payload: RepoGraphPayload,
  positions: Record<string, NodeBox>,
  onOpen: (layerId: string) => void,
  selectedFileId?: string | null,
): { nodes: LayerNodeType[]; edges: Edge[] } {
  const cards = computeLayerCards(payload);

  const selectedLayerId = selectedFileId
    ? payload.files.find((f) => f.id === selectedFileId)?.layer_id
    : undefined;

  const nodes: LayerNodeType[] = cards.map((card) => ({
    id: card.id,
    type: "layer",
    position: positions[card.id] ?? { x: 0, y: 0 },
    width: card.width,
    height: card.height,
    selected: card.id === selectedLayerId,
    data: {
      layer: card.layer,
      flagCounts: card.flagCounts,
      outCount: card.outCount,
      onOpen,
    },
  }));

  const edges: Edge[] = payload.edges
    .filter((e) => e.level === "layer")
    .map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: "countEdge",
      markerEnd: {
        type: "arrowclosed" as const,
        color: "hsl(var(--muted-foreground))",
      },
      data: { count: e.count },
    }));

  return { nodes, edges };
}

/** Basenames used by more than one file — those nodes need a folder to tell
 * them apart (three `README.md` boxes look like a rendering bug otherwise). */
function ambiguousNames(payload: RepoGraphPayload): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const f of payload.files) {
    if (seen.has(f.name)) dupes.add(f.name);
    else seen.add(f.name);
  }
  return dupes;
}

/** Trailing folder segments of a path, the end being the distinguishing part. */
export function folderLabel(path: string, segments = 2): string {
  const dirs = path.split("/").slice(0, -1);
  if (dirs.length === 0) return "repo root";
  const tail = dirs.slice(-segments).join("/");
  return dirs.length > segments ? `…/${tail}` : tail;
}

export interface LayerViewCallbacks {
  onToggleContainer: (containerId: string) => void;
  onNavigatePortal: (layerId: string) => void;
}

/**
 * Layer view: containers positioned by ELK (stage 1), portals to other layers
 * stacked to the right, and — for any expanded container — its files
 * positioned by ELK (stage 2) and nested as React Flow child nodes.
 */
export function buildLayerViewGraph(
  payload: RepoGraphPayload,
  layerId: string,
  containerPositions: Record<string, NodeBox>,
  expandedContainers: ReadonlySet<string>,
  filePositionsByContainer: Record<string, Record<string, NodeBox>>,
  activeFlags: ReadonlySet<GraphFlag>,
  callbacks: LayerViewCallbacks,
  selectedFileId?: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const { onToggleContainer, onNavigatePortal } = callbacks;
  const containers = payload.containers.filter((c) => c.layer_id === layerId);

  const nodes: Node[] = [];
  const visibleIds = new Set<string>();
  const ambiguous = ambiguousNames(payload);

  let maxContainerRight = 0;

  for (const container of containers) {
    const box = containerPositions[container.id];
    if (!box) continue;
    visibleIds.add(container.id);

    const expanded = expandedContainers.has(container.id);
    const filePositions = filePositionsByContainer[container.id];

    let width = box.width;
    let height = box.height;
    if (expanded && filePositions) {
      ({ width, height } = expandedContainerBox(box, filePositions));
    }

    maxContainerRight = Math.max(maxContainerRight, box.x + width);

    const containerNode: ContainerNodeType = {
      id: container.id,
      type: "container",
      position: { x: box.x, y: box.y },
      width,
      height,
      data: { container, expanded, onToggle: onToggleContainer },
    };
    nodes.push(containerNode);

    if (expanded && filePositions) {
      for (const fileId of container.file_ids) {
        const fileBox = filePositions[fileId];
        const file = payload.files.find((f) => f.id === fileId);
        if (!fileBox || !file) continue;
        if (
          activeFlags.size > 0 &&
          !file.flags.some((f) => activeFlags.has(f as GraphFlag))
        ) {
          continue;
        }
        visibleIds.add(fileId);
        const fileNode: FileNodeType = {
          id: fileId,
          type: "file",
          parentId: container.id,
          extent: "parent",
          position: {
            x: fileBox.x + CONTAINER_PADDING,
            y: fileBox.y + CONTAINER_HEADER_HEIGHT,
          },
          width: fileBox.width,
          height: fileBox.height,
          selectable: true,
          selected: fileId === selectedFileId,
          data: {
            file,
            folder: ambiguous.has(file.name)
              ? folderLabel(file.path)
              : undefined,
          },
        };
        nodes.push(fileNode);
      }
    }
  }

  const portals = payload.portals.filter((p) => p.from_layer === layerId);
  portals.forEach((portal, index) => {
    const toLayer = payload.layers.find((l) => l.id === portal.to_layer);
    if (!toLayer) return;
    const portalNode: PortalNodeType = {
      id: `portal:${portal.from_layer}->${portal.to_layer}`,
      type: "portal",
      position: {
        x: maxContainerRight + PORTAL_GAP,
        y: index * (PORTAL_NODE_HEIGHT + PORTAL_GAP),
      },
      width: PORTAL_NODE_WIDTH,
      height: PORTAL_NODE_HEIGHT,
      data: { portal, toLayer, onNavigate: onNavigatePortal },
    };
    nodes.push(portalNode);
  });

  const edges: Edge[] = payload.edges
    .filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
    .map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      label: String(e.count),
    }));

  return { nodes, edges };
}
