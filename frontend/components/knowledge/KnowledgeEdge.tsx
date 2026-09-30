import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";

export interface KnowledgeEdgeData extends Record<string, unknown> {
  kind?: "calls_direct" | "calls_transitive" | "inherits";
  /** Path length; >1 for calls_transitive (routed through cut glue functions). */
  hops?: number;
  /** Up to 3 intermediate symbol ids, only present for calls_transitive. */
  via?: string[];
}

export type KnowledgeEdgeType = Edge<KnowledgeEdgeData, "knowledgeEdge">;

function KnowledgeEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<KnowledgeEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const { kind, hops, via } = data ?? {};
  const isTransitive = kind === "calls_transitive";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: "hsl(var(--muted-foreground))",
          strokeWidth: 1.5,
          strokeDasharray:
            kind === "inherits" ? "4 3" : isTransitive ? "1.5 3" : undefined,
          opacity: isTransitive ? 0.4 : 0.6,
        }}
      />
      {isTransitive && hops !== undefined && (
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
              title={via?.length ? `via ${via.join(" → ")}` : undefined}
            >
              {hops}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const KnowledgeEdge = memo(KnowledgeEdgeComponent);
