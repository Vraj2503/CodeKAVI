import type { FlowEdge, FlowNode } from "./model";

/** Find one shortest directed path from any entry to any exit. */
export function entryToExitPath(nodes: FlowNode[], edges: FlowEdge[]): string[] {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Set(edges.map((edge) => edge.target));
  const outgoing = new Set(edges.map((edge) => edge.source));
  const starts = nodes.filter((node) => node.kind === "start" || !incoming.has(node.id));
  // A web application's Dashboard is the canonical destination even when a
  // branch contains other terminal implementation nodes.
  const dashboard = nodes.find((node) => /dashboard/i.test(node.label));
  const exits = new Set(
    dashboard
      ? [dashboard.id]
      : nodes.filter((node) => node.kind === "end" || !outgoing.has(node.id)).map((node) => node.id),
  );
  const adjacency = new Map<string, FlowEdge[]>();
  for (const edge of edges) {
    if (edge.direction === "response" || !ids.has(edge.source) || !ids.has(edge.target)) continue;
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge]);
  }

  for (const start of starts) {
    const queue: Array<{ id: string; path: string[] }> = [{ id: start.id, path: [] }];
    const visited = new Set([start.id]);
    while (queue.length) {
      const current = queue.shift()!;
      if (current.path.length && exits.has(current.id)) return current.path;
      for (const edge of adjacency.get(current.id) ?? []) {
        if (!visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push({ id: edge.target, path: [...current.path, `${edge.source}->${edge.target}`] });
        }
      }
    }
  }
  return [];
}
