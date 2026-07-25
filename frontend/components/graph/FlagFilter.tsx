import { cn } from "@/lib/utils";
import { countFlags, FLAG_META, type GraphFlag } from "@/lib/graph/flags";
import type { RepoGraphFile } from "@/lib/api";

const CHIP_LABEL: Record<GraphFlag, (count: number) => string> = {
  entry_point: (n) => `${n} entry point${n === 1 ? "" : "s"}`,
  hub: (n) => `${n} hub${n === 1 ? "" : "s"}`,
  orphan: (n) => `${n} file${n === 1 ? "" : "s"} nothing imports`,
  in_cycle: (n) => `${n} file${n === 1 ? "" : "s"} in a circular dependency`,
  god_file: (n) => `${n} god file${n === 1 ? "" : "s"}`,
};

export interface FlagFilterProps {
  files: RepoGraphFile[];
  activeFlags: ReadonlySet<GraphFlag>;
  onToggle: (flag: GraphFlag) => void;
}

export function FlagFilter({ files, activeFlags, onToggle }: FlagFilterProps) {
  const counts = countFlags(files);

  if (counts.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="flag filters"
      className="flex flex-wrap items-center gap-1.5 font-mono text-xs"
    >
      {counts.map(({ flag, count }) => {
        const Icon = FLAG_META[flag].icon;
        const active = activeFlags.has(flag);
        return (
          <button
            key={flag}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(flag)}
            title={FLAG_META[flag].description}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-1 text-muted-foreground transition-colors hover:text-foreground",
              active && "border-[hsl(var(--viz-highlight))] text-foreground",
            )}
            style={
              active
                ? {
                    background:
                      "color-mix(in oklab, hsl(var(--viz-highlight)) 12%, transparent)",
                  }
                : undefined
            }
          >
            <Icon className="h-3 w-3" />
            {CHIP_LABEL[flag](count)}
          </button>
        );
      })}
    </div>
  );
}
