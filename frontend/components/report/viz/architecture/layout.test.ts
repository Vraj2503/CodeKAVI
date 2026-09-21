import { describe, expect, it } from "vitest";
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
});
