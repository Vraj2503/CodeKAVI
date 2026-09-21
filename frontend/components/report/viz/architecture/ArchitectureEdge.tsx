import React from "react";
import { EdgeProps, BaseEdge, getSmoothStepPath, EdgeLabelRenderer, Edge } from "@xyflow/react";
import { ArchitectureEdgeData } from "./types";

/**
 * Custom edge that reads ELK-routed sections (orthogonal) to draw the path,
 * falling back to a standard Bezier edge if ELK hasn't run or is not available.
 */
export default function ArchitectureEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
}: EdgeProps<Edge<ArchitectureEdgeData>>) {
  let edgePath = "";
  let labelX = (sourceX + targetX) / 2;
  let labelY = (sourceY + targetY) / 2;

  // Use ELK sections if available. Choose the longest horizontal section for
  // its label: it keeps labels out of vertical routing channels and makes the
  // primary action readable even in a dense graph.
  if (data?.sections && data.sections.length > 0) {
    const section = data.sections[0];
    const points = [section.startPoint, ...(section.bendPoints || []), section.endPoint];
    
    // Convert points to M/L SVG command string
    edgePath = points
      .map((p, index) => `${index === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");

    const horizontal = points.slice(1).map((point, index) => ({
      from: points[index], to: point,
      length: points[index].y === point.y ? Math.abs(points[index].x - point.x) : 0,
    })).sort((a, b) => b.length - a.length)[0];
    const segment = horizontal?.length ? horizontal : { from: points[0], to: points[points.length - 1] };
    labelX = (segment.from.x + segment.to.x) / 2;
    labelY = (segment.from.y + segment.to.y) / 2 - 12;
  } else {
    // The fallback remains orthogonal while layout is resolving.
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
    labelY = bCenterY;
  }

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ ...(style || {}), strokeWidth: 1.5, stroke: "hsl(var(--muted-foreground))" }} />
      
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
            }}
            className="nodrag nopan rounded border border-border bg-background px-1.5 py-0.5 text-[10px] italic text-muted-foreground shadow-sm"
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
