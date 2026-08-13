"use client";
// dataflow/nodes/data-store-node.tsx — cylinder data store node
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { RFNode } from "../model";
import { highlightToStyle, nodeBorderColor } from "../theming";
import { DetailToggleHint, LeftHandle, RightHandle } from "./shared";

export const DataStoreNode = memo(function DataStoreNode(props: NodeProps<RFNode>) {
  const { flow, highlight } = props.data;
  const w = 150, h = 46, ry = 9;
  const rx = w / 2;

  return (
    <div className="relative" style={highlightToStyle(highlight)}>
      <LeftHandle id="in" />
      <DetailToggleHint count={props.data.detailCount} expanded={props.data.expanded} />
      <svg width={w} height={h + ry} style={{ display: "block" }}>
        {/* Cylinder body */}
        <path
          d={`M0,${ry} L0,${h} A${rx},${ry} 0 0 0 ${w},${h} L${w},${ry}`}
          fill="hsl(var(--card))"
          stroke={nodeBorderColor("data_store")}
          strokeWidth={2}
        />
        {/* Top ellipse */}
        <ellipse
          cx={w / 2}
          cy={ry}
          rx={rx}
          ry={ry}
          fill="hsl(var(--card))"
          stroke={nodeBorderColor("data_store")}
          strokeWidth={2}
        />
        <text
          x={w / 2}
          y={h / 2 + 5}
          textAnchor="middle"
          fontSize="11"
          fill="hsl(var(--foreground))"
          fontWeight={500}
        >
          {flow.label}
        </text>
      </svg>
      {/* R/W indicators */}
      <div className="mt-0.5 flex justify-center gap-1">
        {(flow.reads ?? []).slice(0, 5).map((r) => (
          <span key={r} className="rounded bg-emerald-500/20 px-1 text-[9px] text-emerald-400">
            R
          </span>
        ))}
        {(flow.writes ?? []).slice(0, 5).map((w_) => (
          <span key={w_} className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-400">
            W
          </span>
        ))}
      </div>
      <RightHandle id="out" />
    </div>
  );
});
