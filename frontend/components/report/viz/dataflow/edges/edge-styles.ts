// dataflow/edges/edge-styles.ts — color + dash helpers for FlowEdge
import type { FlowEdge, RFHighlight } from "../model";
import { edgeColor } from "../theming";
import type { CSSProperties } from "react";

export function isResponse(flow: FlowEdge): boolean {
  return flow.direction === "response";
}

export function edgeKindLabel(kind?: string): string {
  const labels: Record<string, string> = {
    http:     "HTTP",
    db:       "DB",
    file:     "File",
    event:    "Event",
    internal: "Internal",
  };
  return kind ? (labels[kind] ?? kind) : "";
}

export function edgeStyle(
  flow: FlowEdge,
  highlight: RFHighlight,
): CSSProperties & { stroke: string; strokeWidth: number; strokeDasharray?: string } {
  const base = edgeColor(flow.data_type);
  const resp = isResponse(flow);

  let opacity = 1;
  if (highlight === "dim") opacity = 0.12;

  return {
    stroke:           base,
    strokeWidth:      highlight === "hover" ? 3 : 2,
    // Response edges were already dashed; inferred continuity edges
    // should also be visibly distinct (lighter dashed). Preserve
    // response dash when both apply.
    strokeDasharray:  resp ? "7 4" : flow.inferred ? "6 6" : undefined,
    strokeOpacity:    opacity,
    transition:       "stroke-opacity 200ms, stroke-width 150ms",
  };
}
