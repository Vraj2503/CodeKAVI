import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ChevronRight, ChevronDown, Folder, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { layerColor } from "@/lib/graph/theme";
import type { RepoGraphContainer } from "@/lib/api";

export interface ContainerNodeData extends Record<string, unknown> {
  container: RepoGraphContainer;
  expanded: boolean;
  onToggle: (containerId: string) => void;
}

export type ContainerNodeType = Node<ContainerNodeData, "container">;

const STRATEGY_ICON = { folder: Folder, community: Network } as const;
const STRATEGY_LABEL = { folder: "folder", community: "grouped" } as const;

function ContainerNodeComponent({
  data,
  selected,
}: NodeProps<ContainerNodeType>) {
  const { container, expanded, onToggle } = data;
  const accent = layerColor(container.layer_id);
  const StrategyIcon = STRATEGY_ICON[container.strategy];
  const fileCount = container.file_ids.length;

  const header = (
    <button
      type="button"
      onClick={() => onToggle(container.id)}
      className="flex w-full min-w-0 items-center gap-1.5 text-left"
      title={`${container.name} (${fileCount} file${fileCount === 1 ? "" : "s"})`}
    >
      {expanded ? (
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: accent }}
      />
      <span className="truncate font-mono text-xs font-medium">
        {container.name}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground">
        <StrategyIcon
          className="h-3 w-3"
          aria-label={STRATEGY_LABEL[container.strategy]}
        />
        {fileCount}
      </span>
    </button>
  );

  if (!expanded) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm",
          selected &&
            "ring-2 ring-[hsl(var(--viz-highlight))] ring-offset-1 ring-offset-background",
        )}
        style={{
          background: `color-mix(in oklab, ${accent} 8%, hsl(var(--card)))`,
        }}
      >
        <Handle type="target" position={Position.Top} className="!bg-border" />
        {header}
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-border"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col rounded-lg border-2 border-dashed bg-card/40",
        selected &&
          "ring-2 ring-[hsl(var(--viz-highlight))] ring-offset-1 ring-offset-background",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <div className="rounded-t-md border-b bg-card px-2.5 py-1.5">
        {header}
      </div>
      <div className="flex-1" />
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}

export const ContainerNode = memo(ContainerNodeComponent);
