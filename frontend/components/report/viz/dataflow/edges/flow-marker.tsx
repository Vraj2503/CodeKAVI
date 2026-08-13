"use client";
// dataflow/edges/flow-marker.tsx — SVG <defs> arrowheads for all edge colors
import { ALL_EDGE_KINDS } from "../model";
import { edgeColor } from "../theming";
import type { EdgeKind } from "../model";

function cssId(color: string): string {
  return color.replace(/[^a-z0-9]/gi, "_");
}

export function FlowMarkerDefs() {
  const colors: { kind: string; css: string }[] = [
    ...ALL_EDGE_KINDS.map((k: EdgeKind) => ({ kind: k, css: edgeColor(k) })),
    { kind: "fallback", css: "hsl(var(--muted-foreground))" },
  ];

  return (
    <svg
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      aria-hidden
    >
      <defs>
        {colors.flatMap(({ kind, css }) => [
          <marker
            key={`f-${kind}`}
            id={`flow-arrow-${cssId(kind)}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={css} />
          </marker>,
          <marker
            key={`r-${kind}`}
            id={`flow-arrow-${cssId(kind)}-dashed`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={css} opacity="0.7" />
          </marker>,
        ])}
      </defs>
    </svg>
  );
}
