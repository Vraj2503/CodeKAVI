import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { layerColor } from "@/lib/graph/theme";
import { FLAG_META, type GraphFlag } from "@/lib/graph/flags";
import type { RepoGraphLayer } from "@/lib/api";

export interface LayerNodeData extends Record<string, unknown> {
  layer: RepoGraphLayer;
  flagCounts: { flag: GraphFlag; count: number }[];
  inCount: number;
  outCount: number;
  onOpen: (layerId: string) => void;
}

export type LayerNodeType = Node<LayerNodeData, "layer">;

function LayerNodeComponent({ data, selected }: NodeProps<LayerNodeType>) {
  const { layer, flagCounts, inCount, outCount, onOpen } = data;
  const accent = layerColor(layer.id);
  const fileCount = layer.file_count;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 shadow-sm",
        selected &&
          "ring-2 ring-[hsl(var(--viz-highlight))] ring-offset-1 ring-offset-background",
      )}
      style={{
        background: `color-mix(in oklab, ${accent} 8%, hsl(var(--card)))`,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <button
        type="button"
        onClick={() => onOpen(layer.id)}
        className="flex w-full min-w-0 items-center gap-1.5 text-left"
        title={`${layer.label} (${fileCount} file${fileCount === 1 ? "" : "s"})`}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: accent }}
        />
        <span className="truncate font-mono text-xs font-medium">
          {layer.label}
        </span>
        <span className="ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground">
          {fileCount}
        </span>
      </button>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className="flex items-center gap-0.5"
          title="incoming layer edges"
        >
          <ArrowDownToLine className="h-3 w-3" />
          {inCount}
        </span>
        <span
          className="flex items-center gap-0.5"
          title="outgoing layer edges"
        >
          <ArrowUpFromLine className="h-3 w-3" />
          {outCount}
        </span>
      </div>
      {flagCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {flagCounts.map(({ flag, count }) => {
            const Icon = FLAG_META[flag].icon;
            return (
              <span
                key={flag}
                className="flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground"
                title={FLAG_META[flag].label}
              >
                <Icon className="h-3 w-3" />
                {count}
              </span>
            );
          })}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}

export const LayerNode = memo(LayerNodeComponent);
