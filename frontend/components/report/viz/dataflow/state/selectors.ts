// dataflow/state/selectors.ts — derive highlight map from reducer state
import { useMemo } from "react";
import type { DFGState } from "./reducer";
import type { RFHighlight, FlowNode, FlowEdge } from "../model";
import { searchMatches } from "../interactions/search";
import { trace } from "../interactions/trace";
import { buildAdjacency } from "../interactions/hover";

export type HighlightMap = Map<string, RFHighlight>;

export function useHighlightMap(
  state: DFGState,
  nodes: FlowNode[],
  edges: FlowEdge[],
): HighlightMap {
  return useMemo(() => {
    const hl = new Map<string, RFHighlight>();

    // Helper: dim everything except a set, which gets a given mode
    const dimAll = (except: Set<string>, mode: RFHighlight) => {
      for (const n of nodes) {
        if (!except.has(n.id)) hl.set(n.id, "dim");
      }
      for (const id of except) hl.set(id, mode);
    };

    // 1. Trace mode — BFS upstream (trace-up) and downstream (trace-down)
    if (state.traceFrom) {
      const up   = trace(edges, state.traceFrom, "in");
      const down = trace(edges, state.traceFrom, "out");
      for (const n of nodes) {
        if (n.id === state.traceFrom)   hl.set(n.id, "select");
        else if (up.has(n.id))          hl.set(n.id, "trace-up");
        else if (down.has(n.id))        hl.set(n.id, "trace-down");
        else                            hl.set(n.id, "dim");
      }
      return hl;
    }

    // 2. Search mode — matches highlighted, rest dim
    if (state.search.trim()) {
      const matches = searchMatches(state.search, nodes);
      dimAll(matches, "hover");
      return hl;
    }

    // 3. Hover — emphasis without reducing baseline readability.  Search,
    // trace, and filters are intentional focus modes and may still dim.
    if (state.hover) {
      const adj = buildAdjacency(edges);
      const connected = adj.get(state.hover) ?? new Set<string>();
      connected.add(state.hover);
      for (const id of connected) hl.set(id, "hover");
      return hl;
    }

    // 4. Node kind filter — dim filtered-out kinds
    for (const n of nodes) {
      const kind = n.kind;
      if (!state.filters.nodes.has(kind)) hl.set(n.id, "dim");
    }

    // 5. Selection always glows on top
    if (state.selected) hl.set(state.selected, "select");

    return hl;
  }, [state, nodes, edges]);
}

/** Returns edge highlight: dim if either endpoint is dim. */
export function edgeHighlight(
  edgeSrc: string,
  edgeTgt: string,
  hlMap: HighlightMap,
): RFHighlight {
  const src = hlMap.get(edgeSrc);
  const tgt = hlMap.get(edgeTgt);
  if (src === "dim" || tgt === "dim") return "dim";
  if (src === "trace-up" && tgt === "trace-up") return "trace-up";
  if (src === "trace-down" && tgt === "trace-down") return "trace-down";
  return "off";
}
