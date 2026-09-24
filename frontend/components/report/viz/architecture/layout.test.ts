import { describe, expect, it, vi } from "vitest";
import { layoutArchitectureGraph } from "./layout";
import type { ArchitectureGraphData } from "./types";

const graph: ArchitectureGraphData = {
  schema_version: "architecture.v2",
  repository: { repo_id: "abc123", topology: "web_application", confidence: 0.9 },
  groups: [
    { id: "entry", label: "Entry & Delivery", order: 1, kind: "gateway" },
    { id: "application", label: "Application Capabilities", order: 2, kind: "service" },
    { id: "external", label: "External Services", order: 3, kind: "external" },
  ],
  nodes: [
    { id: "api", label: "API & Request Entry", kind: "gateway", group_id: "entry", summary: "Receives requests.", technologies: [], confidence: 1, evidence: [] },
    { id: "chat", label: "RAG Chat Service", kind: "service", group_id: "application", summary: "Answers questions.", technologies: [], confidence: 1, evidence: [] },
    { id: "groq", label: "Groq — Llama", kind: "external", group_id: "external", summary: "Generates answers.", technologies: [], confidence: 1, evidence: [] },
  ],
  edges: [
    { id: "api-chat", source: "api", target: "chat", label: "Routes request", kind: "http", confidence: 1, evidence_count: 1 },
    { id: "chat-groq", source: "chat", target: "groq", label: "Uses provider", kind: "sdk", confidence: 1, evidence_count: 1 },
  ],
  collapsed: [],
  available_focuses: [],
  diagnostics: { status: "complete", unsupported_languages: [], excluded_low_confidence_edges: 0, source_coverage: 1 },
};

describe("architecture.v2 layout", () => {
  it("keeps group parents before children and preserves routed edges", async () => {
    const layout = await layoutArchitectureGraph(graph);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));

    for (const node of layout.nodes) {
      if (!node.parentId) continue;
      expect(byId.has(node.parentId)).toBe(true);
      expect(node.extent).toBe("parent");
    }
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges.every((edge) => edge.type === "architectureEdge")).toBe(true);
  });

  it("drops edges referencing non-existent nodes and warns", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const badGraph: ArchitectureGraphData = {
      ...graph,
      edges: [
        ...graph.edges,
        // Edge pointing at a node that doesn't exist in graph.nodes
        { id: "dangling-1", source: "api", target: "ghost-node", label: "Phantom link", kind: "http", confidence: 0.5, evidence_count: 1 },
      ],
    };

    const layout = await layoutArchitectureGraph(badGraph);

    // The valid edges survive, the dangling one is dropped
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges.find((e) => e.id === "dangling-1")).toBeUndefined();

    // A warning was emitted for the dropped edge
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ghost-node(MISSING)")
    );

    warnSpy.mockRestore();
  });

  it("invariant: every edge endpoint exists in the node set", async () => {
    const layout = await layoutArchitectureGraph(graph);
    const nodeIds = new Set(layout.nodes.map((n) => n.id));

    for (const edge of layout.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });
});
