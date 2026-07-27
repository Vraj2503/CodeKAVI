import { describe, expect, it } from "vitest";
import {
  buildContainerGraph,
  containerSize,
  gridFallback,
  layoutContainerChildren,
  type NodeBox,
} from "@/lib/graph/elkLayout";
import { expandedContainerBox } from "@/lib/graph/buildFlowGraph";
import type { RepoGraphPayload } from "@/lib/api";

function container(id: string, fileCount: number) {
  return {
    id,
    layer_id: "layer-1",
    name: id,
    strategy: "folder" as const,
    file_ids: Array.from({ length: fileCount }, (_, i) => `${id}/f${i}`),
  };
}

function payload(): RepoGraphPayload {
  return {
    fingerprint: "fp",
    layers: [],
    containers: [container("a", 4), container("b", 9)],
    files: [],
    edges: [],
    portals: [],
    insights: { cycles: [], orphans: [], central: [], entry_points: [] },
  };
}

describe("buildContainerGraph sizeOverrides", () => {
  it("uses the override box for the named container, containerSize for the rest", () => {
    const graph = buildContainerGraph(payload(), "layer-1", {
      a: { width: 500, height: 320 },
    });
    const byId = Object.fromEntries(
      (graph.children ?? []).map((c) => [c.id, c]),
    );
    expect(byId.a.width).toBe(500);
    expect(byId.a.height).toBe(320);
    const collapsedB = containerSize(9);
    expect(byId.b.width).toBe(collapsedB.width);
    expect(byId.b.height).toBe(collapsedB.height);
  });
});

describe("expandedContainerBox", () => {
  it("grows to enclose file positions and never shrinks below collapsed", () => {
    const collapsed = { width: 120, height: 120 };
    const positions: Record<string, NodeBox> = {
      f0: { id: "f0", x: 0, y: 0, width: 180, height: 56 },
      f1: { id: "f1", x: 200, y: 100, width: 180, height: 56 },
    };
    const box = expandedContainerBox(collapsed, positions);
    // right/bottom edges of files (380 / 156) must be inside the box + padding.
    expect(box.width).toBeGreaterThanOrEqual(380);
    expect(box.height).toBeGreaterThanOrEqual(156);
    expect(box.width).toBeGreaterThanOrEqual(collapsed.width);
    expect(box.height).toBeGreaterThanOrEqual(collapsed.height);
  });

  it("keeps the collapsed size when files fit inside it", () => {
    const collapsed = { width: 400, height: 400 };
    const positions: Record<string, NodeBox> = {
      f0: { id: "f0", x: 0, y: 0, width: 50, height: 50 },
    };
    const box = expandedContainerBox(collapsed, positions);
    expect(box.width).toBe(400);
    expect(box.height).toBe(400);
  });
});

describe("layout with real ELK", () => {
  // Guards the regression that hid behind the worker: every pure-fn test passed
  // while real layout silently timed out and fell back to a grid.
  it("lays out container files with real ELK, not the grid fallback", async () => {
    const result = await layoutContainerChildren(payload(), "a");
    expect(result.usedFallback).toBe(false);
    expect(Object.keys(result.positions)).toHaveLength(4);
  });
});

describe("gridFallback", () => {
  it("never overlaps two node rects", () => {
    const nodes = Array.from({ length: 7 }, (_, i) => ({
      id: `n${i}`,
      width: 100 + i * 10,
      height: 60,
    }));
    const pos = gridFallback(nodes);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = { ...nodes[i], ...pos[nodes[i].id] };
        const b = { ...nodes[j], ...pos[nodes[j].id] };
        const disjoint =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(disjoint).toBe(true);
      }
    }
  });
});
