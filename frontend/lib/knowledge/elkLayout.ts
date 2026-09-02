import type { ElkNode, LayoutOptions } from "elkjs/lib/elk-api";
import type { KnowledgeGraphPayload } from "@/lib/api";
import { layout, type LayoutResult } from "@/lib/graph/elkLayout";

export const SYMBOL_NODE_WIDTH = 200;
export const SYMBOL_NODE_HEIGHT = 64;

const FUNCTION_GRAPH_ELK_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "60",
};

/** One flat graph: every important symbol, with calls/inherits edges between them. */
export function buildFunctionGraph(payload: KnowledgeGraphPayload): ElkNode {
  const children: ElkNode[] = payload.nodes.map((symbol) => ({
    id: symbol.id,
    width: SYMBOL_NODE_WIDTH,
    height: SYMBOL_NODE_HEIGHT,
  }));

  const edges = payload.edges
    .filter((edge) => edge.source !== edge.target)
    .map((edge) => ({
      id: `${edge.source}->${edge.target}`,
      sources: [edge.source],
      targets: [edge.target],
    }));

  return {
    id: "function-graph",
    layoutOptions: FUNCTION_GRAPH_ELK_OPTIONS,
    children,
    edges,
  };
}

/** Lay out the flat function graph. Falls back to a grid on worker failure. */
export function layoutFunctionGraph(
  payload: KnowledgeGraphPayload,
): Promise<LayoutResult> {
  return layout(buildFunctionGraph(payload));
}
