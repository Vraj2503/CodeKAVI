export interface KnowledgeGraphState {
  selectedSymbolId: string | null;
}

export const initialKnowledgeGraphState: KnowledgeGraphState = {
  selectedSymbolId: null,
};

export type KnowledgeGraphAction =
  { type: "select_symbol"; symbolId: string } | { type: "close_panel" };

export function knowledgeGraphReducer(
  state: KnowledgeGraphState,
  action: KnowledgeGraphAction,
): KnowledgeGraphState {
  switch (action.type) {
    case "select_symbol":
      return { ...state, selectedSymbolId: action.symbolId };
    case "close_panel":
      return { ...state, selectedSymbolId: null };
    default:
      return state;
  }
}
