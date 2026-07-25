import { X } from "lucide-react";
import { FLAG_ORDER, FLAG_META, type GraphFlag } from "@/lib/graph/flags";
import type { RepoGraphFile } from "@/lib/api";

function isGraphFlag(flag: string): flag is GraphFlag {
  return flag in FLAG_META;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export interface NodePanelProps {
  file: RepoGraphFile;
  cycles: string[][];
  onClose: () => void;
}

/** Phase 1: deterministic facts only. Prose + "Ask about this file" land in phase 2. */
export function NodePanel({ file, cycles, onClose }: NodePanelProps) {
  const flags = file.flags
    .filter(isGraphFlag)
    .filter((flag) => flag !== "in_cycle")
    .sort((a, b) => FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(b));

  const cyclePartners = (cycles.find((cycle) => cycle.includes(file.id)) ?? [])
    .filter((id) => id !== file.id)
    .map(basename);

  return (
    <aside
      aria-label={`details for ${file.name}`}
      className="flex w-72 shrink-0 flex-col gap-3 border-l bg-card p-3 font-mono text-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{file.name}</div>
          <div className="truncate text-muted-foreground" title={file.path}>
            {file.path}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close panel"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <dl className="flex flex-col gap-1.5 text-muted-foreground">
        <div className="flex justify-between">
          <dt>imported by</dt>
          <dd className="text-foreground">{file.in_degree}</dd>
        </div>
        <div className="flex justify-between">
          <dt>imports</dt>
          <dd className="text-foreground">{file.out_degree}</dd>
        </div>
        {file.role_label && (
          <div className="flex justify-between gap-2">
            <dt>role</dt>
            <dd className="truncate text-foreground">{file.role_label}</dd>
          </div>
        )}
      </dl>

      {flags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {flags.map((flag) => {
            const Icon = FLAG_META[flag].icon;
            return (
              <span
                key={flag}
                title={FLAG_META[flag].description}
                className="flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-muted-foreground"
              >
                <Icon className="h-3 w-3" />
                {FLAG_META[flag].label}
              </span>
            );
          })}
        </div>
      )}

      {cyclePartners.length > 0 && (
        <div className="text-muted-foreground">
          in cycle with{" "}
          <span className="text-foreground">{cyclePartners.join(", ")}</span>
        </div>
      )}
    </aside>
  );
}
