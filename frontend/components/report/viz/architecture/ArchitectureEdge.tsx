import React from "react";
import {
  EdgeProps,
  BaseEdge,
  getSmoothStepPath,
  EdgeLabelRenderer,
  Edge,
} from "@xyflow/react";
import { ArchitectureEdgeData } from "./types";

/**
 * Custom edge that reads ELK-routed sections (orthogonal) to draw the path,
 * falling back to a smooth step edge when ELK hasn't run yet.
 *
 * Renders a short edge label along the longest horizontal segment so it stays
 * readable even in dense graphs.
 */
export default function ArchitectureEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
}: EdgeProps<Edge<ArchitectureEdgeData>>) {
  let edgePath = "";
  let labelX = (sourceX + targetX) / 2;
  let labelY = (sourceY + targetY) / 2;

  if (data?.sections && data.sections.length > 0) {
    const section = data.sections[0];
    const points = [
      section.startPoint,
      ...(section.bendPoints || []),
      section.endPoint,
    ];

    edgePath = points
      .map((p, index) => `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");

    // Place the label on the longest horizontal segment so it doesn't collide
    // with vertical routing channels.
    const segments = points.slice(1).map((pt, i) => ({
      from: points[i],
      to: pt,
      length: points[i].y === pt.y ? Math.abs(points[i].x - pt.x) : 0,
    }));
    const best = segments.sort((a, b) => b.length - a.length)[0];
    const seg =
      best?.length > 0
        ? best
        : { from: points[0], to: points[points.length - 1] };
    labelX = (seg.from.x + seg.to.x) / 2;
    labelY = (seg.from.y + seg.to.y) / 2 - 14;
  } else {
    const [bPath, bCenterX, bCenterY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });
    edgePath = bPath;
    labelX = bCenterX;
    labelY = bCenterY - 14;
  }

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          ...(style || {}),
          strokeWidth: 1.5,
          stroke: "hsl(var(--muted-foreground) / 0.55)",
        }}
        markerEnd=""
        markerStart=""
      />

      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan max-w-[180px] truncate rounded-md border border-border/60 bg-background/90 px-2 py-0.5 text-[10px] leading-tight text-muted-foreground shadow-sm backdrop-blur-sm"
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
