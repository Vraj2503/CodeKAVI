// dataflow/state/reducer.ts — single source of truth for interactive state
import type { NodeKind, EdgeKind } from "../model";

export const ALL_NODE_KINDS: NodeKind[] = [
  "start", "end", "action", "decision", "transform", "data_store",
];
export const ALL_EDGE_KINDS: EdgeKind[] = [
  "http", "db", "file", "event", "internal",
];

export interface DFGState {
  selected:     string | null;
  hover:        string | null;
  search:       string;
  filters: {
    nodes:      Set<NodeKind>;
    edges:      Set<EdgeKind>;
  };
  traceFrom:    string | null;
  graphVersion: number;
}

export type DFGAction =
  | { type: "select";       id: string | null }
  | { type: "hover";        id: string | null }
  | { type: "search";       q: string }
  | { type: "toggle-n-kind"; kind: NodeKind }
  | { type: "toggle-e-kind"; kind: EdgeKind }
  | { type: "trace";        from: string | null }
  | { type: "graph-changed" }
  | { type: "reset" };

export function initialState(): DFGState {
  return {
    selected:     null,
    hover:        null,
    search:       "",
    filters: {
      nodes: new Set(ALL_NODE_KINDS),   // all on by default
      edges: new Set(ALL_EDGE_KINDS),
    },
    traceFrom:    null,
    graphVersion: 0,
  };
}

export function dfgReducer(state: DFGState, action: DFGAction): DFGState {
  switch (action.type) {
    case "select":
      return { ...state, selected: action.id, traceFrom: null };
    case "hover":
      return { ...state, hover: action.id };
    case "search":
      return { ...state, search: action.q };
    case "toggle-n-kind": {
      const nodes = new Set(state.filters.nodes);
      nodes.has(action.kind) ? nodes.delete(action.kind) : nodes.add(action.kind);
      return { ...state, filters: { ...state.filters, nodes } };
    }
    case "toggle-e-kind": {
      const edges = new Set(state.filters.edges);
      edges.has(action.kind) ? edges.delete(action.kind) : edges.add(action.kind);
      return { ...state, filters: { ...state.filters, edges } };
    }
    case "trace":
      return { ...state, traceFrom: action.from };
    case "graph-changed":
      return { ...state, graphVersion: state.graphVersion + 1 };
    case "reset":
      return initialState();
  }
}
