"use client";
// dataflow/nodes/group-frame.tsx — collapsible subgraph container
import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { KIND_SLOT, nodeBorderColor } from "../theming";
import { catVar } from "@/lib/viz/tokens";
import type { FlowNode, RFNodeKind } from "../model";

interface GroupData extends Record<string, unknown> {
  flow?: FlowNode;
  label?: string;
  collapsed?: boolean;
}

type GroupNode = Node<GroupData, "group">;

export const GroupFrame = memo(function GroupFrame(
  props: NodeProps<GroupNode>,
) {
  const label = props.data.flow?.label || props.data.label;
  const kind = props.data.flow?.kind as RFNodeKind | undefined;

  const slot = kind ? (KIND_SLOT[kind] ?? 0) : 0;

  return (
    <div
      className="h-full w-full rounded-2xl border-2 transition-all duration-300"
      style={{
        borderColor: nodeBorderColor(kind ?? "group"),
        backgroundColor: catVar(slot, 0.08),
      }}
    >
      <div
        className="absolute -top-3 left-4 rounded-md px-2 py-0.5"
        style={{
          backgroundColor: kind ? catVar(slot, 0.95) : "hsl(var(--card))",
        }}
      >
        <span
          className="text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
          style={{ color: "hsl(var(--background))" }}
        >
          {label}
        </span>
      </div>
    </div>
  );
});
