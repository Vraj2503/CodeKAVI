import { describe, expect, it } from "vitest";
import { buildFunctionGraph } from "../elkLayout";
import type { KnowledgeGraphPayload, KnowledgeSymbol } from "@/lib/api";

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

describe("buildFunctionGraph", () => {
  it("includes every node and maps edges by id", () => {
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
});
