"use client";
// dataflow/nodes/shared.tsx — shared handle components
import { Handle, Position } from "@xyflow/react";

export function LeftHandle({ id }: { id: string }) {
  return (
    <Handle
      id={id}
      type="target"
      position={Position.Left}
      className="!h-2 !w-2 !rounded-full !border-0 !opacity-0"
    />
  );
}

export function RightHandle({ id }: { id: string }) {
  return (
    <Handle
      id={id}
      type="source"
      position={Position.Right}
      className="!h-2 !w-2 !rounded-full !border-0 !opacity-0"
    />
  );
}

/** Visible affordance: clicking the node toggles its implementation detail. */
export function DetailToggleHint({ count, expanded }: { count?: number; expanded?: boolean }) {
  if (!count) return null;
  return (
    <span
      className="absolute -right-2 -top-2 rounded-full border border-border bg-card px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground shadow-sm"
      aria-hidden
    >
      {expanded ? `− ${count}` : `+ ${count}`}
    </span>
  );
}
