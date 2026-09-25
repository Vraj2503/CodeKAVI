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
    // Draw every section ELK produced. Hierarchical edges can arrive split
    // across multiple sections; drawing only the first truncated the path.
    const sectionPoints = data.sections.map((section) => [
      section.startPoint,
      ...(section.bendPoints || []),
      section.endPoint,
    ]);

    edgePath = sectionPoints
      .map((points) =>
        points.map((p, index) => `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
      )
      .join(" ");

    // The layout pass scored on-path positions (horizontal and vertical
    // segment points) against card rects and stored a collision-free anchor
    // where the pill renders centered ON the line. Centering on the longest
    // segment here instead would park labels back on top of the node cards.
    if (typeof data.labelX === "number" && typeof data.labelY === "number") {
      labelX = data.labelX;
      labelY = data.labelY;
    } else {
      // Legacy data without a layout-time anchor: longest horizontal segment.
      let best: { from: { x: number; y: number }; to: { x: number; y: number }; length: number } | null =
        null;
      for (const points of sectionPoints) {
        for (let i = 1; i < points.length; i++) {
          const from = points[i - 1];
          const to = points[i];
          const length = from.y === to.y ? Math.abs(from.x - to.x) : 0;
          if (!best || length > best.length) best = { from, to, length };
        }
      }
      const seg =
        best && best.length > 0
          ? best
          : {
              from: data.sections[0].startPoint,
              to: data.sections[data.sections.length - 1].endPoint,
            };
      labelX = (seg.from.x + seg.to.x) / 2;
      labelY = (seg.from.y + seg.to.y) / 2 - 14;
    }
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
              zIndex: 30,
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
