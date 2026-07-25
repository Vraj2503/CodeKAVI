import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { layerColor } from "@/lib/graph/theme";
import { FLAG_ORDER, FLAG_META, type GraphFlag } from "@/lib/graph/flags";
import type { RepoGraphFile } from "@/lib/api";

export interface FileNodeData extends Record<string, unknown> {
  file: RepoGraphFile;
}

export type FileNodeType = Node<FileNodeData, "file">;

function isGraphFlag(flag: string): flag is GraphFlag {
  return flag in FLAG_META;
}

function FileNodeComponent({ data, selected }: NodeProps<FileNodeType>) {
  const { file } = data;
  const accent = layerColor(file.layer_id);
  // Backend importance_score is 0-100; the node box is layout-fixed (see
  // elkLayout.ts FILE_NODE_WIDTH/HEIGHT), so importance reads as accent
  // opacity rather than box size.
  const importance = Math.max(0, Math.min(file.importance, 100)) / 100;
  const flags = file.flags
    .filter(isGraphFlag)
    .sort((a, b) => FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(b));

  return (
    <div
      className={cn(
        "flex h-full w-full items-center gap-2 overflow-hidden rounded-md border bg-card px-2.5 py-1.5 text-card-foreground shadow-sm",
        selected &&
          "ring-2 ring-[hsl(var(--viz-highlight))] ring-offset-1 ring-offset-background",
      )}
      title={file.path}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <span
        className="h-full w-1 shrink-0 rounded-full"
        style={{ background: accent, opacity: 0.35 + importance * 0.65 }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs font-medium">
          {file.name}
        </div>
        {file.role_label && (
          <div className="truncate text-xs text-muted-foreground">
            {file.role_label}
          </div>
        )}
      </div>
      {flags.length > 0 && (
        <div className="flex shrink-0 items-center gap-0.5">
          {flags.slice(0, 3).map((flag) => {
            const Icon = FLAG_META[flag].icon;
            return (
              <Icon
                key={flag}
                className="h-3 w-3 text-muted-foreground"
                aria-label={FLAG_META[flag].label}
              />
            );
          })}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}

export const FileNode = memo(FileNodeComponent);
