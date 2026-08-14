// dataflow/layout.ts — ELK layered layout with manual fallback
import type { RFNode, RFEdge } from "./model";

export interface LayoutOutput {
  nodes: RFNode[];
}

interface ElkNode {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNode[];
  edges?: { id: string; sources: string[]; targets: string[] }[];
  layoutOptions?: Record<string, string>;
}

interface ElkGraph {
  id: string;
  layoutOptions: Record<string, string>;
  children: ElkNode[];
  edges: { id: string; sources: string[]; targets: string[] }[];
}

async function getElk() {
  // Dynamic import keeps ELK out of the initial bundle
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  return new ELK();
}

export async function runLayout(
  nodes: RFNode[],
  edges: RFEdge[],
): Promise<LayoutOutput> {
  // Tiny graphs or empty → skip ELK, return nodes as-is (Fit button handles it)
  if (nodes.length <= 1) return { nodes };

  try {
    const elk = await getElk();

    // Separate group nodes from leaf nodes
    const groupIds = new Set(
      nodes.filter((n) => n.type === "group").map((n) => n.id),
    );

    const elkGraph: ElkGraph = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.layered.spacing.nodeNodeBetweenLayers": "100",
        "elk.spacing.nodeNode": "60",
        "elk.spacing.edgeNode": "60",
        "elk.spacing.edgeEdge": "25",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
        "elk.layered.layering.strategy": "NETWORK_SIMPLEX",
        "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      },
      children: nodes
        .filter((n) => !n.parentId)
        .map((n) => ({
          id: n.id,
          width: n.width ?? 160,
          height: n.height ?? 52,
          // Group nodes contain children
          ...(groupIds.has(n.id)
            ? {
              children: nodes
                .filter((c) => c.parentId === n.id)
                .map((c) => ({
                  id: c.id,
                  width: c.width ?? 160,
                  height: c.height ?? 52,
                })),
              layoutOptions: {
                "elk.algorithm": "box",
                "elk.aspectRatio": "0.1",
                "elk.spacing.nodeNode": "24",
                "elk.padding": "[top=40,left=32,bottom=24,right=32]",
              },
            }
            : {}),
        })),
      edges: edges
        .filter((e) => e.data?.flow?.direction !== "response")
        .map((e) => {
          const sourceParentId = nodes.find(n => n.id === e.source)?.parentId || e.source;
          const targetParentId = nodes.find(n => n.id === e.target)?.parentId || e.target;
          return {
            id: e.id,
            sources: [sourceParentId],
            targets: [targetParentId],
          };
        }),
    };

    const result = await elk.layout(elkGraph);

    // Build a map of id -> { x, y, width, height }
    const posMap = new Map<string, { x: number; y: number; width?: number; height?: number }>();

    function flattenChildren(children: ElkNode[]) {
      for (const c of children) {
        if (c.x != null && c.y != null) {
          posMap.set(c.id, { x: c.x, y: c.y, width: c.width, height: c.height });
        }
        if (c.children?.length) {
          flattenChildren(c.children);
        }
      }
    }

    flattenChildren(result.children ?? []);

    return {
      nodes: nodes.map((n) => {
        const pos = posMap.get(n.id);
        if (!pos) return n;
        if (n.type === "group") {
          return {
            ...n,
            position: { x: pos.x, y: pos.y },
            width: pos.width,
            height: pos.height,
            style: { ...n.style, width: pos.width, height: pos.height }
          };
        }
        return { ...n, position: { x: pos.x, y: pos.y } };
      }),
    };
  } catch (err) {
    console.warn("[DataFlowGraph] ELK layout failed, using tier fallback:", err);
    // Manual tier-based fallback
    return tierFallback(nodes, edges);
  }
}

function tierFallback(nodes: RFNode[], _edges: RFEdge[]): LayoutOutput {
  const COL_W = 220;
  const ROW_H = 80;
  const tierMap = new Map<number, RFNode[]>();

  for (const n of nodes) {
    const t = n.data?.flow?.tier ?? 0;
    if (!tierMap.has(t)) tierMap.set(t, []);
    tierMap.get(t)!.push(n);
  }

  const positioned = nodes.map((n) => {
    const t = n.data?.flow?.tier ?? 0;
    const col = tierMap.get(t)!;
    const idx = col.indexOf(n);
    return {
      ...n,
      position: {
        x: t * COL_W,
        y: idx * ROW_H,
      },
    };
  });

  return { nodes: positioned };
}
