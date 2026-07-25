import { describe, it, expect } from "vitest";
import {
  buildContainerGraph,
  buildFileGraph,
  gridFallback,
  FILE_NODE_WIDTH,
  FILE_NODE_HEIGHT,
} from "../elkLayout";
import type { RepoGraphPayload } from "@/lib/api";

function makePayload(
  overrides: Partial<RepoGraphPayload> = {},
): RepoGraphPayload {
  return {
    fingerprint: "abc123",
    layers: [],
    containers: [],
    files: [],
    edges: [],
    portals: [],
    insights: { cycles: [], orphans: [], central: [], entry_points: [] },
    ...overrides,
  };
}

describe("buildContainerGraph", () => {
  it("includes only containers from the requested layer, sized by sqrt(childCount)", () => {
    const payload = makePayload({
      containers: [
        {
          id: "c1",
          layer_id: "core",
          name: "c1",
          strategy: "folder",
          file_ids: ["a", "b", "c", "d"],
        },
        {
          id: "c2",
          layer_id: "core",
          name: "c2",
          strategy: "folder",
          file_ids: ["e"],
        },
        {
          id: "c3",
          layer_id: "routes",
          name: "c3",
          strategy: "folder",
          file_ids: ["f"],
        },
      ],
    });

    const graph = buildContainerGraph(payload, "core");

    const children = graph.children ?? [];
    expect(children.map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    const c1 = children.find((c) => c.id === "c1");
    const c2 = children.find((c) => c.id === "c2");
    // 4 files -> bigger side than 1 file
    expect(c1?.width).toBeGreaterThan(c2?.width ?? 0);
  });

  it("caps container size at 800x600", () => {
    const payload = makePayload({
      containers: [
        {
          id: "huge",
          layer_id: "core",
          name: "huge",
          strategy: "folder",
          file_ids: Array.from({ length: 100000 }, (_, i) => `f${i}`),
        },
      ],
    });

    const graph = buildContainerGraph(payload, "core");
    const node = graph.children![0];
    expect(node.width!).toBeLessThanOrEqual(800);
    expect(node.height!).toBeLessThanOrEqual(600);
  });

  it("keeps only container-level edges within the layer, drops cross-layer and self edges", () => {
    const payload = makePayload({
      containers: [
        {
          id: "c1",
          layer_id: "core",
          name: "c1",
          strategy: "folder",
          file_ids: ["a"],
        },
        {
          id: "c2",
          layer_id: "core",
          name: "c2",
          strategy: "folder",
          file_ids: ["b"],
        },
      ],
      edges: [
        { source: "c1", target: "c2", level: "container", count: 3 },
        { source: "c1", target: "c1", level: "container", count: 1 },
        { source: "c1", target: "outside", level: "container", count: 2 },
        { source: "a", target: "b", level: "file", count: 1 },
      ],
    });

    const graph = buildContainerGraph(payload, "core");
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges![0].sources).toEqual(["c1"]);
    expect(graph.edges![0].targets).toEqual(["c2"]);
  });
});

describe("buildFileGraph", () => {
  it("builds fixed-size nodes for every file in the container", () => {
    const payload = makePayload({
      containers: [
        {
          id: "c1",
          layer_id: "core",
          name: "c1",
          strategy: "folder",
          file_ids: ["a", "b"],
        },
      ],
    });

    const graph = buildFileGraph(payload, "c1");
    expect(graph.children).toEqual([
      { id: "a", width: FILE_NODE_WIDTH, height: FILE_NODE_HEIGHT },
      { id: "b", width: FILE_NODE_WIDTH, height: FILE_NODE_HEIGHT },
    ]);
  });

  it("throws on an unknown container id", () => {
    const payload = makePayload();
    expect(() => buildFileGraph(payload, "missing")).toThrow();
  });

  it("keeps only file-level edges within the container", () => {
    const payload = makePayload({
      containers: [
        {
          id: "c1",
          layer_id: "core",
          name: "c1",
          strategy: "folder",
          file_ids: ["a", "b"],
        },
      ],
      edges: [
        { source: "a", target: "b", level: "file", count: 2 },
        { source: "a", target: "outside", level: "file", count: 1 },
        { source: "c1", target: "c2", level: "container", count: 1 },
      ],
    });

    const graph = buildFileGraph(payload, "c1");
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges![0].sources).toEqual(["a"]);
    expect(graph.edges![0].targets).toEqual(["b"]);
  });
});

describe("gridFallback", () => {
  it("produces non-overlapping positions regardless of node size", () => {
    const nodes = [
      { id: "n1", width: 800, height: 600 },
      { id: "n2", width: 120, height: 120 },
      { id: "n3", width: 180, height: 56 },
      { id: "n4", width: 180, height: 56 },
      { id: "n5", width: 180, height: 56 },
    ];

    const positions = gridFallback(nodes);
    const boxes = nodes.map((n) => ({
      ...positions[n.id],
      width: n.width,
      height: n.height,
    }));

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("is deterministic for the same input", () => {
    const nodes = [
      { id: "n1", width: 100, height: 100 },
      { id: "n2", width: 100, height: 100 },
      { id: "n3", width: 100, height: 100 },
    ];

    expect(gridFallback(nodes)).toEqual(gridFallback(nodes));
  });
});
