import { describe, it, expect } from "vitest";
import { runLaneLayout } from "../ArchitectureGraph";

const nodes = [
  { id: "main", label: "main.py", type: "routes" },
  { id: "orch", label: "orchestrator.py", type: "services" },
  { id: "analyzer", label: "analyzer.py", type: "services" },
  { id: "db", label: "supabase_client.py", type: "database" },
];

const edges = [
  { source: "main", target: "orch" },
  { source: "orch", target: "analyzer" },
  { source: "analyzer", target: "db" },
  { source: "orch", target: "ghost" }, // dangling — must be dropped
];

describe("runLaneLayout", () => {
  it("emits one lane per layer, parents before children, dangling edges dropped", async () => {
    const { nodes: laid, edges: laidEdges } = await runLaneLayout(nodes, edges);

    const lanes = laid.filter((n) => n.type === "lane");
    expect(lanes.map((l) => l.id)).toEqual([
      "lane-routes",
      "lane-services",
      "lane-database",
    ]);

    // React Flow requires a parent to precede its children in the array.
    laid.forEach((n, i) => {
      if (!n.parentId) return;
      expect(laid.findIndex((p) => p.id === n.parentId)).toBeLessThan(i);
    });

    const files = laid.filter((n) => n.type === "file");
    expect(files).toHaveLength(nodes.length);
    expect(files.every((f) => f.extent === "parent")).toBe(true);

    expect(laidEdges).toHaveLength(3);
  });

  it("routes each edge from the side facing its target", async () => {
    const { edges: laid } = await runLaneLayout(nodes, edges);

    // Lanes stack downward, so a cross-lane edge leaves the bottom.
    const crossLane = laid.find((e) => e.source === "main")!;
    expect(crossLane.sourceHandle).toBe("bottom-src");
    expect(crossLane.targetHandle).toBe("top-tgt");

    // Files sit side by side inside a lane — that edge must go sideways, not
    // dive under the chip and hook back up.
    const sameLane = laid.find(
      (e) => e.source === "orch" && e.target === "analyzer",
    )!;
    expect(sameLane.sourceHandle).toBe("right-src");
    expect(sameLane.targetHandle).toBe("left-tgt");
  });
});
