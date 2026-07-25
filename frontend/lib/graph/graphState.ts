import type { GraphFlag } from "./flags";

export interface GraphViewState {
  activeLayerId: string | null;
  expandedContainers: ReadonlySet<string>;
  selectedFileId: string | null;
  activeFlags: ReadonlySet<GraphFlag>;
}

export const initialGraphViewState: GraphViewState = {
  activeLayerId: null,
  expandedContainers: new Set(),
  selectedFileId: null,
  activeFlags: new Set(),
};

export type GraphAction =
  | { type: "open_layer"; layerId: string }
  | { type: "close_layer" }
  | { type: "toggle_container"; containerId: string }
  | { type: "select_file"; fileId: string }
  | { type: "close_panel" }
  | { type: "toggle_flag"; flag: GraphFlag };

/** activeLayer, expandedContainers, selectedNode, activeFlags — per Step 8 plan. */
export function graphViewReducer(
  state: GraphViewState,
  action: GraphAction,
): GraphViewState {
  switch (action.type) {
    case "open_layer":
      return {
        ...state,
        activeLayerId: action.layerId,
        expandedContainers: new Set(),
        selectedFileId: null,
      };
    case "close_layer":
      return {
        ...state,
        activeLayerId: null,
        expandedContainers: new Set(),
        selectedFileId: null,
      };
    case "toggle_container": {
      const next = new Set(state.expandedContainers);
      if (next.has(action.containerId)) next.delete(action.containerId);
      else next.add(action.containerId);
      return { ...state, expandedContainers: next };
    }
    case "select_file":
      return { ...state, selectedFileId: action.fileId };
    case "close_panel":
      return { ...state, selectedFileId: null };
    case "toggle_flag": {
      const next = new Set(state.activeFlags);
      if (next.has(action.flag)) next.delete(action.flag);
      else next.add(action.flag);
      return { ...state, activeFlags: next };
    }
    default:
      return state;
  }
}
