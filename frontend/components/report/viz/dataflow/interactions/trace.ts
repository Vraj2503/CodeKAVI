// dataflow/interactions/trace.ts — BFS upstream/downstream
import type { FlowEdge } from "../model";

export function trace(
  edges: FlowEdge[],
  from: string,
  direction: "in" | "out",
): Set<string> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    // Skip response edges so trace doesn't loop back onto itself
    if (e.direction === "response") continue;
    if (!adj.has(e.source)) adj.set(e.source, new Set());
    if (!adj.has(e.target)) adj.set(e.target, new Set());
    if (direction === "out") adj.get(e.source)!.add(e.target);
    else adj.get(e.target)!.add(e.source);
  }
  const visited = new Set<string>([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  visited.delete(from); // caller adds "from" separately as "select"
  return visited;
}
