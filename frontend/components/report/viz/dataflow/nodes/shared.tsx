"use client";
// dataflow/nodes/shared.tsx — shared handle components
import { Fragment } from "react";
import { Handle, Position } from "@xyflow/react";

const SIDES = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
} as const;

/**
 * Places source + target handles on all 4 sides so edges can connect
 * from whichever direction gives the shortest path. Handle ids are
 * `<side>-src` / `<side>-tgt` — assignClosestHandles() picks the pair.
 */
export function NodeHandles() {
  return (
    <>
      {Object.entries(SIDES).map(([side, position]) => (
        <Fragment key={side}>
          <Handle
            id={`${side}-tgt`}
            type="target"
            position={position}
            className="!h-2 !w-2 !rounded-full !border-0 !opacity-0"
          />
          <Handle
            id={`${side}-src`}
            type="source"
            position={position}
            className="!h-2 !w-2 !rounded-full !border-0 !opacity-0"
          />
        </Fragment>
      ))}
    </>
  );
}

/** Visible affordance: clicking the node toggles its implementation detail. */
export function DetailToggleHint({
  count,
  expanded,
}: {
  count?: number;
  expanded?: boolean;
}) {
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
