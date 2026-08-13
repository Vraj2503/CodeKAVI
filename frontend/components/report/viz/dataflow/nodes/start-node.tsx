"use client";
// dataflow/nodes/start-node.tsx and end-node.tsx — io entry/exit nodes
import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { RFNode } from "../model";
import { highlightToStyle, nodeBorderColor } from "../theming";
import { DetailToggleHint, LeftHandle, RightHandle } from "./shared";

const SOURCE_ICON: Record<string, string> = {
  http: "🌐",
  queue: "📨",
  file: "📄",
  cron: "⏱",
  event: "⚡",
};

export const StartNode = memo(function StartNode(props: NodeProps<RFNode>) {
  const { flow, highlight } = props.data;
  return (
    <div
      className="relative rounded-md border-2 bg-card px-3 py-2 text-xs shadow-sm min-w-[120px]"
      style={{
        ...highlightToStyle(highlight),
        borderColor: nodeBorderColor("start"),
      }}
    >
      <RightHandle id="out" />
      <DetailToggleHint count={props.data.detailCount} expanded={props.data.expanded} />
      <div className="font-semibold text-foreground leading-tight">{flow.label}</div>
      {flow.source && (
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>{SOURCE_ICON[flow.source.kind] ?? "→"}</span>
          <span className="truncate font-mono">{flow.source.spec}</span>
        </div>
      )}
    </div>
  );
});

export const EndNode = memo(function EndNode(props: NodeProps<RFNode>) {
  const { flow, highlight } = props.data;
  return (
    <div
      className="relative rounded-md border-2 bg-card px-3 py-2 text-xs shadow-sm min-w-[120px]"
      style={{
        ...highlightToStyle(highlight),
        borderColor: nodeBorderColor("end"),
        background: "hsl(var(--viz-cat-1) / 0.06)",
      }}
    >
      <LeftHandle id="in" />
      <DetailToggleHint count={props.data.detailCount} expanded={props.data.expanded} />
      <div className="font-semibold text-foreground leading-tight">{flow.label}</div>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {(flow.outputs ?? []).slice(0, 3).map((o) => (
          <span
            key={o.name}
            className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground"
          >
            → {o.name}: {o.type}
          </span>
        ))}
      </div>
    </div>
  );
});
