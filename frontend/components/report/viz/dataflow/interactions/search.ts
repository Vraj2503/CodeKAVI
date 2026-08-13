// dataflow/interactions/search.ts — fuzzy match + scoring
import type { FlowNode } from "../model";

export function searchMatches(q: string, nodes: FlowNode[]): Set<string> {
  const needle = q.trim().toLowerCase();
  if (!needle) return new Set();
  const out = new Set<string>();
  for (const n of nodes) {
    let score = 0;
    if (n.label.toLowerCase().includes(needle)) score += 3;
    if (n.description?.toLowerCase().includes(needle)) score += 1;
    if (n.source_files?.some((f) => f.toLowerCase().includes(needle))) score += 2;
    if (score > 0) out.add(n.id);
  }
  return out;
}
