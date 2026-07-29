import type { Node, Edge } from "@xyflow/react";
import type { RepoGraphPayload } from "@/lib/api";
import type { NodeBox } from "./elkLayout";
import { gridFallback } from "./elkLayout";
import { countFlags, type GraphFlag } from "./flags";
import type { LayerNodeType } from "@/components/graph/LayerNode";
import type { ContainerNodeType } from "@/components/graph/ContainerNode";
import type { FileNodeType } from "@/components/graph/FileNode";
import type { PortalNodeType } from "@/components/graph/PortalNode";

export const LAYER_NODE_WIDTH = 220;
export const LAYER_NODE_HEIGHT = 130;
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

function countByDirection(
  edges: RepoGraphPayload["edges"],
  level: RepoGraphPayload["edges"][number]["level"],
  id: string,
): { inCount: number; outCount: number } {
  let inCount = 0;
  let outCount = 0;
  for (const edge of edges) {
    if (edge.level !== level) continue;
    if (edge.target === id) inCount += edge.count;
    if (edge.source === id) outCount += edge.count;
  }
  return { inCount, outCount };
}

/** Overview: one card per layer, laid out on a deterministic grid (no ELK needed for this level). */
export function buildOverviewGraph(
  payload: RepoGraphPayload,
  onOpen: (layerId: string) => void,
  selectedFileId?: string | null,
): { nodes: LayerNodeType[]; edges: Edge[] } {
  const grid = gridFallback(
    payload.layers.map((layer) => ({
      id: layer.id,
      width: LAYER_NODE_WIDTH,
      height: LAYER_NODE_HEIGHT,
    })),
    PORTAL_GAP,
  );

  const selectedLayerId = selectedFileId
    ? payload.files.find((f) => f.id === selectedFileId)?.layer_id
    : undefined;

  const nodes: LayerNodeType[] = payload.layers.map((layer) => {
    const layerFiles = payload.files.filter((f) => f.layer_id === layer.id);
    const { inCount, outCount } = countByDirection(
      payload.edges,
      "layer",
      layer.id,
    );
    return {
      id: layer.id,
      type: "layer",
      position: grid[layer.id],
      width: LAYER_NODE_WIDTH,
      height: LAYER_NODE_HEIGHT,
      selected: layer.id === selectedLayerId,
      data: {
        layer,
        flagCounts: countFlags(layerFiles),
        inCount,
        outCount,
        onOpen,
      },
    };
  });

  const edges: Edge[] = payload.edges
    .filter((e) => e.level === "layer")
    .map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      label: String(e.count),
    }));

  return { nodes, edges };
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
          data: { file },
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
