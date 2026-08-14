"use client";
// dataflow/edges/flow-edge.tsx — custom edge with double-label + response indicator
import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  type EdgeProps,
} from "@xyflow/react";
import { edgeStyle, edgeKindLabel, isResponse } from "./edge-styles";
import type { FlowEdge as FlowEdgeType, RFHighlight } from "../model";

// Use a looser type to avoid node_modules type incompatibility with generic Edge
type FlowEdgeProps = EdgeProps & {
  data?: {
    flow?: FlowEdgeType;
    highlight?: RFHighlight;
    replayToken?: number;
    replayRun?: number;
    replayStep?: number;
  };
};

function arrowPoints(x: number, y: number, targetPosition: Position | undefined): string {
  const size = 8;
  switch (targetPosition) {
    case Position.Right:
      return `${x},${y} ${x + size},${y - size / 2} ${x + size},${y + size / 2}`;
    case Position.Top:
      return `${x},${y} ${x - size / 2},${y + size} ${x + size / 2},${y + size}`;
    case Position.Bottom:
      return `${x},${y} ${x - size / 2},${y - size} ${x + size / 2},${y - size}`;
    case Position.Left:
    default:
      return `${x},${y} ${x - size},${y - size / 2} ${x - size},${y + size / 2}`;
  }
}

export const FlowEdge = memo(function FlowEdge(props: FlowEdgeProps) {
  const {
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    markerEnd, data,
  } = props;

  const flow = data?.flow;
  const highlight = data?.highlight ?? "off";

  const [path, midX, midY] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    curvature: 0.15,
  });

  if (!flow) {
    // Minimal fallback — no label, just the path
    return <BaseEdge id={props.id} path={path} markerEnd={markerEnd} />;
  }

  const resp = isResponse(flow);
  const style = edgeStyle(flow, highlight);
  const kindLabel = edgeKindLabel(flow.data_type);
  const replayStep = data?.replayStep;
  const replayRun = data?.replayRun;

  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={markerEnd}
        style={style}
      />
      {replayRun != null && replayStep != null && (
        <path
          key={`replay-${replayRun}-${replayStep}`}
          d={path}
          fill="none"
          stroke="hsl(var(--viz-highlight))"
          strokeWidth="3"
          strokeLinecap="round"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset="1"
        >
          <animate
            attributeName="stroke-dashoffset"
            from="1"
            to="0"
            dur="700ms"
            begin={`${replayStep * 700}ms`}
            fill="freeze"
          />
        </path>
      )}

      {/* Double label: edge kind on top, payload below */}
      {(kindLabel || flow.payload || resp || flow.label) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${midX}px,${midY}px)`,
              pointerEvents: "all",
              opacity: highlight === "dim" ? 0.1 : 1,
              transition: "opacity 200ms",
            }}
            className="flex flex-col items-center gap-0.5"
          >
            {kindLabel && (
              <span
                className="px-1 py-0.5 text-[10px] font-bold tracking-wide whitespace-nowrap"
                style={{ color: style.stroke, textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
              >
                {kindLabel}
              </span>
            )}
            {flow.payload && (
              <span 
                className="px-1 py-0.5 text-[10px] font-medium text-muted-foreground whitespace-nowrap"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
              >
                {flow.payload}
              </span>
            )}
            {resp && (
              <span className="text-[10px] italic text-amber-400" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>↩ returns</span>
            )}
            {flow.label && !kindLabel && (
              <span 
                className="px-1 py-0.5 text-[10px] font-medium text-muted-foreground whitespace-nowrap"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
              >
                {flow.label}
              </span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
