import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { FLAG_META, type GraphFlag } from "@/lib/graph/flags";
import type { RepoGraphLayer } from "@/lib/api";

export interface LayerNodeData extends Record<string, unknown> {
  layer: RepoGraphLayer;
  flagCounts: { flag: GraphFlag; count: number }[];
  outCount: number;
  onOpen: (layerId: string) => void;
}

export type LayerNodeType = Node<LayerNodeData, "layer">;

const HANDLE_STYLE = "!bg-transparent !border-0 !w-0 !h-0";

function LayerNodeComponent({ data, selected }: NodeProps<LayerNodeType>) {
  const { layer, flagCounts, outCount, onOpen } = data;
  const fileCount = layer.file_count;

  // Spelled-out stat lines rather than icon pills — a layer card is read at a
  // glance from across the overview, where a glyph is guesswork. Zero counts are
  // dropped, the way countFlags already drops them: "0 imports" is a line of
  // noise on every leaf layer.
  const stats = [
    `${fileCount} file${fileCount === 1 ? "" : "s"}`,
    ...flagCounts.map(({ flag, count }) => {
      const meta = FLAG_META[flag];
      return `${count} ${count === 1 ? meta.label : meta.plural}`;
    }),
    ...(outCount > 0 ? [`${outCount} import${outCount === 1 ? "" : "s"}`] : []),
  ];

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col gap-2.5 rounded-lg border border-dashed border-border/60 bg-card px-4 py-3 shadow-sm",
        selected &&
          "ring-2 ring-[hsl(var(--viz-highlight))] ring-offset-1 ring-offset-background",
      )}
    >
      <Handle type="target" position={Position.Top} className={HANDLE_STYLE} />
      <Handle type="target" id="left" position={Position.Left} className={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} className={HANDLE_STYLE} />
      <Handle type="source" id="right" position={Position.Right} className={HANDLE_STYLE} />
      <button
        type="button"
        onClick={() => onOpen(layer.id)}
        className="flex w-full min-w-0 items-center justify-between gap-2 text-left"
        title={`${layer.label} (${fileCount} file${fileCount === 1 ? "" : "s"})`}
      >
        <span className="truncate text-sm font-medium">{layer.label}</span>
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-muted px-1 font-mono text-[10px] leading-none text-muted-foreground">
          {fileCount}
        </span>
      </button>
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {stats.map((line) => (
          <span key={line} className="truncate">
            ↓ {line}
          </span>
        ))}
      </div>
    </div>
  );
}

export const LayerNode = memo(LayerNodeComponent);
