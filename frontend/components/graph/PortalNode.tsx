import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { layerColor } from "@/lib/graph/theme";
import type { RepoGraphLayer, RepoGraphPortal } from "@/lib/api";

export interface PortalNodeData extends Record<string, unknown> {
  portal: RepoGraphPortal;
  toLayer: RepoGraphLayer;
  onNavigate: (layerId: string) => void;
}

export type PortalNodeType = Node<PortalNodeData, "portal">;

function PortalNodeComponent({ data, selected }: NodeProps<PortalNodeType>) {
  const { portal, toLayer, onNavigate } = data;
  const accent = layerColor(toLayer.id);

  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center rounded-full border border-dashed bg-card shadow-sm",
        selected &&
          "ring-2 ring-[hsl(var(--viz-highlight))] ring-offset-1 ring-offset-background",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <button
        type="button"
        onClick={() => onNavigate(toLayer.id)}
        className="flex w-full min-w-0 items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground"
        title={`${portal.connection_count} connection${portal.connection_count === 1 ? "" : "s"} to ${toLayer.label}`}
      >
        <ArrowRight className="h-3 w-3 shrink-0" style={{ color: accent }} />
        <span className="truncate">{toLayer.label}</span>
        <span className="shrink-0 rounded-full border px-1.5 py-0.5">
          {portal.connection_count}
        </span>
      </button>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}

export const PortalNode = memo(PortalNodeComponent);
