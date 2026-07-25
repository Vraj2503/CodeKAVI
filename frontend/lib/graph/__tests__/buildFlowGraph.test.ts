import { describe, it, expect, vi } from "vitest";
import { buildOverviewGraph, buildLayerViewGraph } from "../buildFlowGraph";
import type { RepoGraphPayload } from "@/lib/api";
import type { NodeBox } from "../elkLayout";

function payload(overrides: Partial<RepoGraphPayload> = {}): RepoGraphPayload {
  return {
    fingerprint: "fp",
    layers: [
      { id: "routes", name: "routes", label: "Routes", file_count: 2, tier: 0 },
      {
        id: "services",
        name: "services",
        label: "Services",
        file_count: 1,
        tier: 1,
      },
    ],
    containers: [
      {
        id: "c1",
        layer_id: "routes",
        name: "routes/api",
        strategy: "folder",
        file_ids: ["f1", "f2"],
      },
    ],
    files: [
      {
        id: "f1",
        path: "routes/a.ts",
        name: "a.ts",
        container_id: "c1",
        layer_id: "routes",
        role: null,
        role_label: null,
        importance: 50,
        in_degree: 1,
        out_degree: 1,
        language: "ts",
        size: 100,
        kind: "file",
        parent: null,
        flags: ["entry_point"],
      },
      {
        id: "f2",
        path: "routes/b.ts",
        name: "b.ts",
        container_id: "c1",
        layer_id: "routes",
        role: null,
        role_label: null,
        importance: 20,
        in_degree: 0,
        out_degree: 1,
        language: "ts",
        size: 50,
        kind: "file",
        parent: null,
        flags: [],
      },
    ],
    edges: [
      { source: "routes", target: "services", level: "layer", count: 3 },
      { source: "f1", target: "f2", level: "file", count: 1 },
    ],
    portals: [
      { from_layer: "routes", to_layer: "services", connection_count: 3 },
    ],
    insights: { cycles: [], orphans: [], central: [], entry_points: ["f1"] },
    ...overrides,
  };
}

describe("buildOverviewGraph", () => {
  it("builds one node per layer with in/out counts from layer edges", () => {
    const { nodes, edges } = buildOverviewGraph(payload(), vi.fn());
    expect(nodes).toHaveLength(2);
    const routes = nodes.find((n) => n.id === "routes")!;
    expect(routes.data.outCount).toBe(3);
    const services = nodes.find((n) => n.id === "services")!;
    expect(services.data.inCount).toBe(3);
    expect(edges).toHaveLength(1);
  });
});

describe("buildLayerViewGraph", () => {
  const containerPositions: Record<string, NodeBox> = {
    c1: { id: "c1", x: 0, y: 0, width: 100, height: 80 },
  };

  it("collapsed: renders the container atom and the portal, no file nodes", () => {
    const { nodes, edges } = buildLayerViewGraph(
      payload(),
      "routes",
      containerPositions,
      new Set(),
      {},
      new Set(),
      { onToggleContainer: vi.fn(), onNavigatePortal: vi.fn() },
    );
    expect(nodes.filter((n) => n.type === "container")).toHaveLength(1);
    expect(nodes.filter((n) => n.type === "file")).toHaveLength(0);
    expect(nodes.filter((n) => n.type === "portal")).toHaveLength(1);
    expect(edges).toHaveLength(0); // f1->f2 not visible since c1 isn't expanded
  });

  it("expanded: nests file nodes under the container and includes their edge", () => {
    const filePositions = {
      c1: {
        f1: { id: "f1", x: 0, y: 0, width: 180, height: 56 },
        f2: { id: "f2", x: 0, y: 80, width: 180, height: 56 },
      },
    };
    const { nodes, edges } = buildLayerViewGraph(
      payload(),
      "routes",
      containerPositions,
      new Set(["c1"]),
      filePositions,
      new Set(),
      { onToggleContainer: vi.fn(), onNavigatePortal: vi.fn() },
    );
    const fileNodes = nodes.filter((n) => n.type === "file");
    expect(fileNodes).toHaveLength(2);
    expect(fileNodes.every((n) => n.parentId === "c1")).toBe(true);
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe("f1->f2");
  });

  it("active flags hide non-matching files", () => {
    const filePositions = {
      c1: {
        f1: { id: "f1", x: 0, y: 0, width: 180, height: 56 },
        f2: { id: "f2", x: 0, y: 80, width: 180, height: 56 },
      },
    };
    const { nodes } = buildLayerViewGraph(
      payload(),
      "routes",
      containerPositions,
      new Set(["c1"]),
      filePositions,
      new Set(["entry_point"]),
      { onToggleContainer: vi.fn(), onNavigatePortal: vi.fn() },
    );
    const fileNodes = nodes.filter((n) => n.type === "file");
    expect(fileNodes.map((n) => n.id)).toEqual(["f1"]);
  });
});
