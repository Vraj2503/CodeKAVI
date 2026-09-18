import { describe, expect, it } from "vitest";
import {
  initialKnowledgeGraphState,
  knowledgeGraphReducer,
} from "../graphState";

describe("knowledgeGraphReducer", () => {
  it("selects and closes the symbol panel", () => {
    const selected = knowledgeGraphReducer(initialKnowledgeGraphState, {
      type: "select_symbol",
      symbolId: "sym-1",
    });
    expect(selected.selectedSymbolId).toBe("sym-1");

    const closed = knowledgeGraphReducer(selected, { type: "close_panel" });
    expect(closed.selectedSymbolId).toBeNull();
  });
});
