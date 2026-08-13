"use client";
// dataflow/nodes/action-node.tsx — process / action stage node
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { RFNode } from "../model";
import { highlightToStyle, nodeBorderColor } from "../theming";
import { DetailToggleHint, LeftHandle, RightHandle } from "./shared";

export const ActionNode = memo(function ActionNode(props: NodeProps<RFNode>) {
  const { flow, highlight } = props.data;
  const file = flow.source_files?.[0]?.split("/").pop();
  return (
    <div
      className="relative rounded-md border bg-card px-3 py-2 text-xs shadow-sm min-w-[120px]"
      style={{
        ...highlightToStyle(highlight),
        borderColor: nodeBorderColor("action"),
      }}
    >
      <LeftHandle id="in" />
      <DetailToggleHint count={props.data.detailCount} expanded={props.data.expanded} />
      <div className="font-medium text-foreground leading-tight">{flow.label}</div>
      {file && (
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {file}
        </div>
      )}
      <RightHandle id="out" />
    </div>
  );
});
