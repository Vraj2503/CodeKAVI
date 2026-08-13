"use client";
// dataflow/nodes/transform-node.tsx — parallelogram transform node
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { RFNode } from "../model";
import { highlightToStyle, nodeBorderColor } from "../theming";
import { DetailToggleHint, LeftHandle, RightHandle } from "./shared";

export const TransformNode = memo(function TransformNode(props: NodeProps<RFNode>) {
  const { flow, highlight } = props.data;
  const w = 160, h = 46, skew = 18;
  const points = `${skew},0 ${w},0 ${w - skew},${h} 0,${h}`;
  return (
    <div className="relative" style={highlightToStyle(highlight)}>
      <LeftHandle id="in" />
      <DetailToggleHint count={props.data.detailCount} expanded={props.data.expanded} />
      <svg width={w} height={h} style={{ display: "block" }}>
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          rx={h / 2}
          ry={h / 2}
          fill="hsl(var(--card))"
          stroke={nodeBorderColor("transform")}
          strokeWidth={2}
        />
        <text
          x={w / 2}
          y={h / 2 + 4}
          textAnchor="middle"
          fontSize="11"
          fill="hsl(var(--foreground))"
          fontWeight={500}
        >
          {flow.label}
        </text>
      </svg>
      <RightHandle id="out" />
    </div>
  );
});
