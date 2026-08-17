// dataflow/theming.ts — maps node/edge categories to live CSS tokens
import { catVar, inkDimVar } from "@/lib/viz/tokens";
import type { NodeKind, EdgeKind, RFHighlight } from "./model";
import type { CSSProperties } from "react";

// Node kind → categorical color slot (matches existing DFG convention)
export const KIND_SLOT: Record<NodeKind | "group", number> = {
  start: 1,   // viz-cat-1 — gold/amber
  end: 1,
  action: 5,   // viz-cat-5 — blue
  decision: 2,   // viz-cat-2 — teal/green
  transform: 2,
  data_store: 3,   // viz-cat-3 — orange
  group: 0,   // inkDim
};

export function nodeBorderColor(kind: NodeKind | "group"): string {
  if (kind === "group") return inkDimVar(0.4);
  return catVar(KIND_SLOT[kind]);
}

export function nodeBackgroundColor(kind: NodeKind | "group"): string {
  // Groups should not impose a heavy translucent fill — keep them visually
  // unobtrusive so child nodes remain readable. Use transparent background
  // and rely on borders/labels for grouping.
  if (kind === "group") return "transparent";
  return catVar(KIND_SLOT[kind], 0.06);
}

// Edge type → categorical color slot
const EDGE_SLOT: Record<EdgeKind, number> = {
  http: 0,   // viz-cat-1
  db: 3,   // viz-cat-3
  file: 1,   // viz-cat-2
  event: 2,   // viz-cat-2
  internal: 7,   // muted
};

export function edgeColor(kind?: EdgeKind): string {
  if (!kind || !(kind in EDGE_SLOT)) return "hsl(var(--muted-foreground))";
  return catVar(EDGE_SLOT[kind]);
}

export function highlightToStyle(h: RFHighlight): CSSProperties {
  switch (h) {
    case "off":
      return { opacity: 1, transition: "opacity 200ms, outline 150ms" };
    case "dim":
      return { opacity: 0.2, transition: "opacity 200ms" };
    case "hover":
      return { opacity: 1 };
    case "trace-up":
      return {
        outline: `2px solid ${catVar(5)}`,
        outlineOffset: "2px",
      };
    case "trace-down":
      return {
        outline: `2px solid ${catVar(7)}`,
        outlineOffset: "2px",
      };
    case "select":
      return {
        boxShadow: "0 10px 24px hsl(var(--foreground) / 0.12)",
        transition: "box-shadow 150ms",
      };
  }
}

// Minimap node color
export function minimapNodeColor(kind: NodeKind | "group"): string {
  return catVar(KIND_SLOT[kind], 0.7);
}
