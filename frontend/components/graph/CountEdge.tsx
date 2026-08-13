import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export interface CountEdgeData extends Record<string, unknown> {
  count: number;
}

export type CountEdgeType = Edge<CountEdgeData, "countEdge">;

function CountEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<CountEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const count = data?.count ?? 0;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: "hsl(var(--muted-foreground))",
          strokeWidth: 1.5,
          opacity: 0.6,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-none"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
        >
          <span
            className="flex h-5 min-w-5 items-center justify-center rounded-full border bg-card px-1 font-mono text-[10px] leading-none text-muted-foreground shadow-sm"
          >
            {count}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const CountEdge = memo(CountEdgeComponent);
