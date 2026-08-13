"use client";
// dataflow/nodes/decision-node.tsx — branch / hexagon node
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { RFNode } from "../model";
import { highlightToStyle, nodeBorderColor } from "../theming";
import { DetailToggleHint, LeftHandle, RightHandle } from "./shared";

export const DecisionNode = memo(function DecisionNode(props: NodeProps<RFNode>) {
  const { flow, highlight } = props.data;
  const w = 140, h = 50, cut = 25;
  return (
    <div className="relative" style={highlightToStyle(highlight)}>
      <LeftHandle id="in" />
      <DetailToggleHint count={props.data.detailCount} expanded={props.data.expanded} />
      <svg width={w} height={h} style={{ display: "block" }}>
        <polygon
          points={`${cut},0 ${w - cut},0 ${w},${h / 2} ${w - cut},${h} ${cut},${h} 0,${h / 2}`}
          fill="hsl(var(--card))"
          stroke={nodeBorderColor("decision")}
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
