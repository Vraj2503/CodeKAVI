import { describe, it, expect } from "vitest";
import { assignClosestHandles } from "@/components/report/viz/dataflow/model";
import type { RFNode, RFEdge } from "@/components/report/viz/dataflow/model";

function node(id: string, x: number, y: number, parentId?: string) {
  return {
    id,
    position: { x, y },
    width: 100,
    height: 50,
    ...(parentId ? { parentId } : {}),
  } as RFNode;
}

function edge(source: string, target: string) {
  return { id: `${source}-${target}`, source, target } as RFEdge;
}

describe("assignClosestHandles", () => {
  it("picks right→left for a target to the east", () => {
    const [e] = assignClosestHandles(
      [node("a", 0, 0), node("b", 300, 0)],
      [edge("a", "b")],
    );
    expect(e.sourceHandle).toBe("right-src");
    expect(e.targetHandle).toBe("left-tgt");
  });

  it("picks bottom→top for a target to the south", () => {
    const [e] = assignClosestHandles(
      [node("a", 0, 0), node("b", 0, 300)],
      [edge("a", "b")],
    );
    expect(e.sourceHandle).toBe("bottom-src");
    expect(e.targetHandle).toBe("top-tgt");
  });

  it("resolves child coordinates against the parent group", () => {
    const group = { ...node("g", 500, 0), type: "group" } as RFNode;
    // "b" sits at parent-relative x=0 → absolute x=500, i.e. east of "a".
    const [e] = assignClosestHandles(
      [node("a", 0, 0), group, node("b", 0, 0, "g")],
      [edge("a", "b")],
    );
    expect(e.sourceHandle).toBe("right-src");
    expect(e.targetHandle).toBe("left-tgt");
  });

  it("leaves an edge untouched when an endpoint is missing", () => {
    const original = edge("a", "ghost");
    const [e] = assignClosestHandles([node("a", 0, 0)], [original]);
    expect(e).toBe(original);
  });
});
