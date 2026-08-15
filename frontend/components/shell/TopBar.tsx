"use client";

/**
 * The identity bar: which repository, which view, how big, where the source
 * lives. It is 44px of hairline-separated text — no card, no glass, no shadow
 * — because it is a label for the work below it, not an object in front of it.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ExternalLink, PanelRight, PanelRightClose } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalyzeResponse } from "@/lib/api";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/Tooltip";

const VIEW_TITLES: Record<string, string> = {
  chat: "Chat",
  report: "Report",
  visualize: "Visualize",
  graph: "Graph",
};

export function TopBar({
  repoData,
  inspectorOpen,
  onToggleInspector,
}: {
  repoData: AnalyzeResponse | null;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}) {
  const pathname = usePathname();
  const view =
    Object.keys(VIEW_TITLES).find((key) => pathname.includes(`/${key}`)) ??
    "graph";

  return (
    <header className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md">
      <div className="flex min-w-0 items-baseline gap-2">
        {repoData ? (
          <>
            <span className="truncate font-mono text-[13px] text-muted-foreground">
              {repoData.owner}
              <span className="px-1 text-border">/</span>
            </span>
            <span className="truncate font-mono text-[13px] font-medium text-foreground">
              {repoData.repo_name}
            </span>
          </>
        ) : (
          <Skeleton className="h-3.5 w-40" />
        )}

        <span className="hidden text-border sm:inline">·</span>
        <span className="hidden text-[13px] text-muted-foreground sm:inline">
          {VIEW_TITLES[view]}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        {repoData && (
          <div className="mr-2 hidden items-center gap-4 md:flex">
            <Metric label="files" value={repoData.total_files} />
            <Metric label="size" value={repoData.total_size_formatted} />
            <Metric
              label="deps"
              value={repoData.graph?.metadata?.total_edges ?? 0}
            />
          </div>
        )}

        <TooltipProvider delayDuration={250}>
          {repoData?.github_url && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={repoData.github_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="press grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-foreground"
                >
                  <ExternalLink size={15} strokeWidth={1.75} />
                  <span className="sr-only">Open on GitHub</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="bottom">Open on GitHub</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleInspector}
                aria-expanded={inspectorOpen}
                className={cn(
                  "press grid h-8 w-8 place-items-center rounded-md transition-colors duration-150 ease-out",
                  inspectorOpen
                    ? "text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {inspectorOpen ? (
                  <PanelRightClose size={16} strokeWidth={1.75} />
                ) : (
                  <PanelRight size={16} strokeWidth={1.75} />
                )}
                <span className="sr-only">
                  {inspectorOpen ? "Hide inspector" : "Show inspector"}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {inspectorOpen ? "Hide inspector" : "Show inspector"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </header>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="tnum font-mono text-[13px] text-foreground">{value}</span>
      <span className="eyebrow">{label}</span>
    </span>
  );
}
