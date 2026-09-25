import { describe, expect, it, vi } from "vitest";
import { layoutArchitectureGraph } from "./layout";
import type { ArchitectureEdgeSection, ArchitectureGraphData } from "./types";

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

  it("anchors intra-group edges in absolute canvas space", async () => {
    // Regression: ELK reports sections of same-group edges in the group's
    // local space; the layout must shift them onto the absolute canvas or the
    // edge floats detached from its cards.
    const intraGroupGraph: ArchitectureGraphData = {
      ...graph,
      groups: [graph.groups.find((g) => g.id === "application")!],
      nodes: graph.nodes.filter((n) => n.group_id === "application"),
      edges: [
        { id: "svc-svc", source: "chat", target: "chat-b", label: "Coordinates", kind: "internal", confidence: 1, evidence_count: 1 },
      ],
    };
    intraGroupGraph.nodes.push({
      id: "chat-b", label: "RAG Chat Service B", kind: "service", group_id: "application",
      summary: "Answers questions too.", technologies: [], confidence: 1, evidence: [],
    });

    const layout = await layoutArchitectureGraph(intraGroupGraph);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const group = byId.get("application")!;
    const source = byId.get("chat")!;
    const target = byId.get("chat-b")!;

    // RF child positions are parent-relative; resolve them to canvas space.
    const absoluteX = (node: typeof source) =>
      node.parentId ? group.position!.x + node.position!.x : node.position!.x;
    const absoluteY = (node: typeof source) =>
      node.parentId ? group.position!.y + node.position!.y : node.position!.y;

    const edge = layout.edges.find((e) => e.id === "svc-svc");
    expect(edge).toBeDefined();
    const sections = (edge!.data as { sections?: ArchitectureEdgeSection[] }).sections ?? [];
    expect(sections.length).toBeGreaterThan(0);

    // ELK pins the first section to the source's bottom edge and the last
    // one to the target's top edge (portConstraints FIXED_SIDE, direction
    // DOWN). The node cards are 320x120 — see layout.ts member sizing.
    const first = sections[0];
    const last = sections[sections.length - 1];
    expect(Math.abs(first.startPoint.y - (absoluteY(source) + 120))).toBeLessThan(2);
    expect(first.startPoint.x).toBeGreaterThanOrEqual(absoluteX(source));
    expect(first.startPoint.x).toBeLessThanOrEqual(absoluteX(source) + 320);
    expect(Math.abs(last.endPoint.y - absoluteY(target))).toBeLessThan(2);
    expect(last.endPoint.x).toBeGreaterThanOrEqual(absoluteX(target));
    expect(last.endPoint.x).toBeLessThanOrEqual(absoluteX(target) + 320);
  });

  it("places edge labels clear of node cards", async () => {
    // Regression: centering labels on the longest horizontal segment parks
    // them on the node cards (React Flow's label layer sits below nodes, so
    // they vanish). The layout must score candidates against node rects and
    // emit a collision-free anchor.
    const denseGraph: ArchitectureGraphData = {
      ...graph,
      edges: [
        { id: "api-chat", source: "api", target: "chat", label: "Routes request", kind: "http", confidence: 1, evidence_count: 1 },
        { id: "chat-groq", source: "chat", target: "groq", label: "Uses provider", kind: "sdk", confidence: 1, evidence_count: 1 },
      ],
    };

    const layout = await layoutArchitectureGraph(denseGraph);

    // Absolute-space card rects, rebuilt the same way layout.ts does them.
    const groupById = new Map(layout.nodes.filter((n) => n.type === "architectureGroup").map((n) => [n.id, n]));
    const rects: { x: number; y: number; width: number; height: number }[] = [];
    for (const node of layout.nodes) {
      if (node.type !== "architectureNode") continue;
      const group = node.parentId ? groupById.get(node.parentId) : undefined;
      const x = (group?.position?.x ?? 0) + (node.position?.x ?? 0);
      const y = (group?.position?.y ?? 0) + (node.position?.y ?? 0);
      const style = node.style as { width?: number; height?: number } | undefined;
      rects.push({ x, y, width: style?.width ?? 320, height: style?.height ?? 120 });
    }
    expect(rects.length).toBe(3);

    const insideRect = (x: number, y: number) =>
      rects.some((r) => x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height);

    for (const edge of layout.edges) {
      const data = edge.data as { label?: string; labelX?: number; labelY?: number };
      expect(data.label).toBeTruthy();
      expect(typeof data.labelX).toBe("number");
      expect(typeof data.labelY).toBe("number");
      expect(insideRect(data.labelX!, data.labelY!)).toBe(false);
    }

    // Labels must not stack on each other either: any two anchors need
    // vertical or horizontal separation beyond one pill (≈90x22).
    const anchors = layout.edges.map((e) => {
      const d = e.data as { labelX: number; labelY: number };
      return { x: d.labelX, y: d.labelY };
    });
    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        const dx = Math.abs(anchors[i].x - anchors[j].x);
        const dy = Math.abs(anchors[i].y - anchors[j].y);
        expect(dx >= 90 || dy >= 24).toBe(true);
      }
    }
  });

  it("uses measured heights so edge anchors match the real card edges", async () => {
    // Regression: ELK laid out estimated heights while real cards rendered
    // taller, leaving anchors behind the actual boxes — edges looked
    // disconnected from their endpoints.
    const measuredLayout = await layoutArchitectureGraph(graph, { chat: 200 });
    const byId = new Map(measuredLayout.nodes.map((node) => [node.id, node]));
    const chat = byId.get("chat")!;
    const group = byId.get("application")!;
    expect(chat.parentId).toBe("application");

    const edge = measuredLayout.edges.find((e) => e.id === "api-chat")!;
    const sections = (edge.data as { sections: ArchitectureEdgeSection[] }).sections;
    const last = sections[sections.length - 1];
    const chatAbsY = group.position!.y + chat.position!.y;
    // The edge must arrive exactly at the measured card's top edge; with the
    // stale 120px estimate it would stop ~80px above the real card.
    expect(Math.abs(last.endPoint.y - chatAbsY)).toBeLessThan(2);
    expect(last.endPoint.x).toBeGreaterThanOrEqual(group.position!.x + chat.position!.x);
    expect(last.endPoint.x).toBeLessThanOrEqual(group.position!.x + chat.position!.x + 320);
  });

  it("keeps every label on its own routed path", async () => {
    // Regression: candidate anchors that are not on the orthogonal path
    // (e.g. a straight source→target midpoint of an L-shaped route) rendered
    // as pills floating in empty space. The anchor must stay within one pill
    // height of the polyline it describes.
    const layout = await layoutArchitectureGraph(graph);

    const distToPath = (
      px: number,
      py: number,
      sections: ArchitectureEdgeSection[]
    ) => {
      let best = Infinity;
      for (const s of sections) {
        const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
        for (let i = 1; i < pts.length; i++) {
          const ax = pts[i - 1].x, ay = pts[i - 1].y;
          const bx = pts[i].x, by = pts[i].y;
          const dx = bx - ax, dy = by - ay;
          const lenSq = dx * dx + dy * dy || 1;
          const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
          best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
        }
      }
      return best;
    };

    for (const edge of layout.edges) {
      const d = edge.data as { sections: ArchitectureEdgeSection[]; labelX: number; labelY: number };
      if (!d.sections?.length) continue;
      // Pills render centered ON their line, so anything beyond ~3px from the
      // path means the label left its edge entirely.
      expect(distToPath(d.labelX, d.labelY, d.sections)).toBeLessThan(3);
    }
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
