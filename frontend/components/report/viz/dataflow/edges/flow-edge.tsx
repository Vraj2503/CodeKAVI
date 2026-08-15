"use client";
// dataflow/edges/flow-edge.tsx — custom edge with directional animation
import { memo } from "react";
import {
  EdgeLabelRenderer,
  getBezierPath,
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
    return <path id={props.id} className="react-flow__edge-path" d={path} markerEnd={markerEnd} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={2} />;
  }

  const resp = isResponse(flow);
  const style = edgeStyle(flow, highlight);
  const kindLabel = edgeKindLabel(flow.data_type);
  const replayStep = data?.replayStep;
  const replayRun = data?.replayRun;
  const isDimmed = highlight === "dim";

  // Both edge types animate forward along their path (0→1).
  // Response edges already have swapped source/target from the backend,
  // so their path naturally goes in the return direction — no keyPoints
  // reversal needed; the path direction itself handles it.
  const motionDur = resp ? "2.5s" : "1.8s";

  return (
    <>
      {/* Static base path (the visible line) */}
      <path
        id={props.id}
        className="react-flow__edge-path"
        d={path}
        markerEnd={markerEnd}
        style={style}
        fill="none"
      />

      {/* Animated travelling dot — direct path attribute for reliable direction control */}
      {!isDimmed && (
        <circle
          r={4}
          fill={style.stroke}
          opacity={0.9}
        >
          <animateMotion
            dur={motionDur}
            repeatCount="indefinite"
            path={path}
            keyPoints="0;1"
            keyTimes="0;1"
            calcMode="linear"
          />
        </circle>
      )}

      {/* Replay overlay */}
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
              opacity: isDimmed ? 0.1 : 1,
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
