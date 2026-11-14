import { describe, expect, it } from "vitest";
import {
  buildFunctionGraph,
  layoutFunctionGraph,
  placeUnlinked,
  SYMBOL_NODE_HEIGHT,
  SYMBOL_NODE_WIDTH,
} from "../elkLayout";
import type { KnowledgeGraphPayload, KnowledgeSymbol } from "@/lib/api";
import type { NodeBox } from "@/lib/graph/elkLayout";

function symbol(id: string, file: string): KnowledgeSymbol {
  return {
    id,
    label: id,
    type: "function",
    file,
    line: 1,
    loc: 1,
    doc: null,
    description: null,
    signature: null,
    is_async: false,
    http: null,
    external_calls: [],
    effects: [],
    in_degree: 0,
    out_degree: 0,
    role: null,
    importance: null,
  };
}

function payload(): KnowledgeGraphPayload {
  return {
    nodes: [symbol("a.py::f", "a.py"), symbol("a.py::g", "a.py")],
    edges: [
      { source: "a.py::f", target: "a.py::g", kind: "calls_direct", hops: 1 },
    ],
    metadata: {
      total_symbols: 2,
      important_symbols: 2,
      resolved_calls: 1,
      unresolved_calls: 0,
      edges_truncated: false,
      unsupported_languages: [],
    },
  };
}

/** A hub with `callers` callers (route handlers -> run_sync), plus `unlinked` symbols with no drawn edge. */
function hubPayload(callers: number, unlinked: number): KnowledgeGraphPayload {
  const p = payload();
  p.nodes = [symbol("utils.py::run_sync", "utils.py")];
  p.edges = [];
  for (let i = 0; i < callers; i++) {
    const id = `routes/r${i}.py::handler`;
    p.nodes.push(symbol(id, `routes/r${i}.py`));
    p.edges.push({ source: id, target: "utils.py::run_sync", kind: "calls_direct", hops: 1 });
  }
  for (let i = 0; i < unlinked; i++) {
    p.nodes.push(symbol(`lone${i}.py::job`, `lone${i}.py`));
  }
  return p;
}

function widestRow(positions: Record<string, NodeBox>): number {
  const rows = new Map<number, number>();
  for (const box of Object.values(positions)) {
    rows.set(Math.round(box.y), (rows.get(Math.round(box.y)) ?? 0) + 1);
  }
  return Math.max(...rows.values());
}

function overlaps(a: NodeBox, b: NodeBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("buildFunctionGraph", () => {
  it("includes every linked node and maps edges by id", () => {
    const graph = buildFunctionGraph(payload());
    expect(graph.children?.map((c) => c.id)).toEqual(["a.py::f", "a.py::g"]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges?.[0].id).toBe("a.py::f->a.py::g");
  });

  it("drops self-loop edges", () => {
    const p = payload();
    p.edges.push({
      source: "a.py::f",
      target: "a.py::f",
      kind: "calls_direct",
      hops: 1,
    });
    const graph = buildFunctionGraph(p);
    expect(graph.edges).toHaveLength(1);
  });

  it("leaves symbols with no drawn edge to the grid, not to ELK", () => {
    const graph = buildFunctionGraph(hubPayload(2, 3));
    expect(graph.children?.map((c) => c.id).sort()).toEqual([
      "routes/r0.py::handler",
      "routes/r1.py::handler",
      "utils.py::run_sync",
    ]);
  });

  it("asks ELK for the width-minimising layering", () => {
    expect(buildFunctionGraph(payload()).layoutOptions?.["elk.layered.layering.strategy"]).toBe("MIN_WIDTH");
  });
});

describe("placeUnlinked", () => {
  it("fills rows under the graph, as wide as it, in the order given", () => {
    const above: Record<string, NodeBox> = {
      a: { id: "a", x: 100, y: 0, width: SYMBOL_NODE_WIDTH, height: SYMBOL_NODE_HEIGHT },
      b: { id: "b", x: 1400, y: 300, width: SYMBOL_NODE_WIDTH, height: SYMBOL_NODE_HEIGHT },
    };
    const placed = placeUnlinked(["u0", "u1", "u2", "u3", "u4", "u5", "u6"], above);

    expect(placed.u0.x).toBe(100); // starts at the graph's left edge
    expect(placed.u0.y).toBeGreaterThan(300 + SYMBOL_NODE_HEIGHT); // below everything
    expect(placed.u1.y).toBe(placed.u0.y);
    expect(placed.u5.y).toBe(placed.u0.y); // a 1500px-wide graph has room for six columns
    expect(placed.u6.y).toBeGreaterThan(placed.u0.y);
    expect(Math.max(...Object.values(placed).map((b) => b.x + b.width))).toBeLessThanOrEqual(1600 + 260);
  });

  it("keeps at least four columns under a narrow graph, and a square-ish grid with nothing above", () => {
    const narrow = placeUnlinked(["u0", "u1", "u2", "u3", "u4"], {
      a: { id: "a", x: 0, y: 0, width: SYMBOL_NODE_WIDTH, height: SYMBOL_NODE_HEIGHT },
    });
    expect(narrow.u3.y).toBe(narrow.u0.y);
    expect(narrow.u4.y).toBeGreaterThan(narrow.u0.y);

    const alone = placeUnlinked(Array.from({ length: 36 }, (_, i) => `u${i}`), {});
    expect(widestRow(alone)).toBe(6);
  });
});

describe("layoutFunctionGraph", () => {
  it("spreads a hub's callers over several rows and places every symbol without overlap", async () => {
    // Before T40 every caller sat in one row: 12 wide here, 31 on CodeKAVI before T30.
    const p = hubPayload(12, 8);
    const result = await layoutFunctionGraph(p);

    expect(result.usedFallback).toBe(false);
    expect(Object.keys(result.positions).sort()).toEqual(p.nodes.map((n) => n.id).sort());
    expect(widestRow(result.positions)).toBeLessThan(12);
    const boxes = Object.values(result.positions);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlaps(boxes[i], boxes[j]), `${boxes[i].id} overlaps ${boxes[j].id}`).toBe(false);
      }
    }
  });

  it("lays out a graph with no edges at all as a grid", async () => {
    const result = await layoutFunctionGraph(hubPayload(0, 9));
    expect(result.usedFallback).toBe(false);
    expect(Object.keys(result.positions)).toHaveLength(10);
    expect(widestRow(result.positions)).toBe(4);
  });
});
