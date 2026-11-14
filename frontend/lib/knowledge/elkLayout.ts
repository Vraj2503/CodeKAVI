import type { ElkNode, LayoutOptions } from "elkjs/lib/elk-api";
import type { KnowledgeGraphPayload } from "@/lib/api";
import { layout, type LayoutResult, type NodeBox } from "@/lib/graph/elkLayout";

export const SYMBOL_NODE_WIDTH = 200;
export const SYMBOL_NODE_HEIGHT = 88;

const NODE_GAP = 60;
const LAYER_GAP = 80;
/** Unlinked symbols sit in rows at least this many wide, so a handful don't become a column. */
const MIN_GRID_COLUMNS = 4;

const FUNCTION_GRAPH_ELK_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_GAP),
  "elk.spacing.nodeNode": String(NODE_GAP),
  // The default layering puts every caller of a hub in the row above it. On
  // CodeKAVI that row was 31 symbols wide before T30 and 12 after, so fitting
  // the graph meant zoom 0.11. MIN_WIDTH spreads callers over more layers:
  // widest row 5, and the drawing comes out close to the canvas's shape.
  "elk.layered.layering.strategy": "MIN_WIDTH",
};

function drawnEdges(payload: KnowledgeGraphPayload) {
  const ids = new Set(payload.nodes.map((symbol) => symbol.id));
  return payload.edges.filter(
    (edge) => edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target),
  );
}

/**
 * ELK input: the symbols that have at least one drawn edge, and those edges.
 * Symbols with none are left to `placeUnlinked`: ELK lays each one out as its
 * own component and packs them all into one row.
 */
export function buildFunctionGraph(payload: KnowledgeGraphPayload): ElkNode {
  const edges = drawnEdges(payload);
  const linked = new Set(edges.flatMap((edge) => [edge.source, edge.target]));

  const children: ElkNode[] = payload.nodes
    .filter((symbol) => linked.has(symbol.id))
    .map((symbol) => ({
      id: symbol.id,
      width: SYMBOL_NODE_WIDTH,
      height: SYMBOL_NODE_HEIGHT,
    }));

  return {
    id: "function-graph",
    layoutOptions: FUNCTION_GRAPH_ELK_OPTIONS,
    children,
    edges: edges.map((edge) => ({
      id: `${edge.source}->${edge.target}`,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };
}

/**
 * Unlinked symbols in rows under the laid-out graph, as wide as it is (at
 * least MIN_GRID_COLUMNS), in the order given, which is importance order.
 * With nothing above, a roughly square grid.
 */
export function placeUnlinked(
  ids: string[],
  above: Record<string, NodeBox>,
): Record<string, NodeBox> {
  const boxes = Object.values(above);
  const cellWidth = SYMBOL_NODE_WIDTH + NODE_GAP;
  const cellHeight = SYMBOL_NODE_HEIGHT + LAYER_GAP;

  let left = 0;
  let top = 0;
  let columns = Math.max(MIN_GRID_COLUMNS, Math.ceil(Math.sqrt(ids.length)));
  if (boxes.length > 0) {
    left = Math.min(...boxes.map((box) => box.x));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    top = Math.max(...boxes.map((box) => box.y + box.height)) + LAYER_GAP * 1.5;
    columns = Math.max(MIN_GRID_COLUMNS, Math.floor((right - left + NODE_GAP) / cellWidth));
  }

  const placed: Record<string, NodeBox> = {};
  ids.forEach((id, index) => {
    placed[id] = {
      id,
      x: left + (index % columns) * cellWidth,
      y: top + Math.floor(index / columns) * cellHeight,
      width: SYMBOL_NODE_WIDTH,
      height: SYMBOL_NODE_HEIGHT,
    };
  });
  return placed;
}

/** Lay out the flat function graph. Falls back to a grid on worker failure. */
export async function layoutFunctionGraph(
  payload: KnowledgeGraphPayload,
): Promise<LayoutResult> {
  const graph = buildFunctionGraph(payload);
  const linked = new Set((graph.children ?? []).map((child) => child.id));
  const unlinked = payload.nodes.map((symbol) => symbol.id).filter((id) => !linked.has(id));

  const result: LayoutResult =
    linked.size > 0 ? await layout(graph) : { positions: {}, usedFallback: false };
  return {
    positions: { ...result.positions, ...placeUnlinked(unlinked, result.positions) },
    usedFallback: result.usedFallback,
  };
}
