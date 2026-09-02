import type { KnowledgeGraphPayload } from "@/lib/api";
import type { NodeBox } from "@/lib/graph/elkLayout";
import { SYMBOL_NODE_WIDTH, SYMBOL_NODE_HEIGHT } from "./elkLayout";
import type { SymbolNodeType } from "@/components/knowledge/SymbolNode";
import type { KnowledgeEdgeType } from "@/components/knowledge/KnowledgeEdge";

/** The one flat graph: every important symbol, with calls/inherits edges between them. */
export function buildFunctionGraph(
  payload: KnowledgeGraphPayload,
  positions: Record<string, NodeBox>,
  onSelectSymbol: (symbolId: string) => void,
  selectedSymbolId?: string | null,
): { nodes: SymbolNodeType[]; edges: KnowledgeEdgeType[] } {
  const nodes: SymbolNodeType[] = payload.nodes.map((symbol) => {
    const box = positions[symbol.id];
    return {
      id: symbol.id,
      type: "symbol",
      position: { x: box?.x ?? 0, y: box?.y ?? 0 },
      width: SYMBOL_NODE_WIDTH,
      height: SYMBOL_NODE_HEIGHT,
      selected: symbol.id === selectedSymbolId,
      data: { symbol, onOpen: onSelectSymbol },
    };
  });

  const edges: KnowledgeEdgeType[] = payload.edges
    .filter((edge) => edge.source !== edge.target)
    .map((edge) => ({
      id: `${edge.source}->${edge.target}`,
      source: edge.source,
      target: edge.target,
      type: "knowledgeEdge",
      markerEnd: {
        type: "arrowclosed" as const,
        color: "hsl(var(--muted-foreground))",
      },
      data: { kind: edge.kind, hops: edge.hops, via: edge.via },
    }));

  return { nodes, edges };
}
