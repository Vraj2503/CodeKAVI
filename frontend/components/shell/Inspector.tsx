"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The inspector: everything *about* the thing you are looking at, on the right,
 * where a reference column belongs — and out of the way of navigation, which
 * now lives on the rail.
 *
 * Its contents follow the route. On `visualize` it is the chart index; on every
 * other view it is the repository itself — size, languages, tree. One panel,
 * one job per view, instead of one panel doing four jobs at once.
 *
 * The open/close toggle is deliberately *not* animated on desktop: it is a
 * layout width change (expensive to animate honestly) on a control people hit
 * repeatedly. On a narrow viewport it becomes an overlay drawer, where the
 * slide is the thing that explains where the panel came from.
 */

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalyzeResponse } from "@/lib/api";
import { VIZ_CONFIG } from "@/components/visualize/VisualizationPanel";
import { useMediaQuery, NARROW_QUERY } from "@/hooks/useMediaQuery";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Skeleton } from "@/components/ui/Skeleton";
import { FileTree } from "@/components/ui/FileTree";

interface InspectorProps {
  repoData: AnalyzeResponse | null;
  repoId: string;
  isAnalyzing: boolean;
  onAnalyze: (url: string) => void;
  onClose: () => void;
  error: string | null;
  open: boolean;
}

export function Inspector({
  repoData,
  repoId,
  isAnalyzing,
  onAnalyze,
  onClose,
  error,
  open,
}: InspectorProps) {
  const pathname = usePathname();
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const isVisualize = pathname.includes("/visualize");

  // On a narrow viewport the panel floats over the canvas: at 375px a 320px
  // column left the chart 55px wide.
  const overlay = isNarrow;

  if (!open && !overlay) return null;

  return (
    <>
      {overlay && open && (
        <button
          type="button"
          aria-label="Close inspector"
          onClick={onClose}
          className="absolute inset-0 z-30 bg-background/60 backdrop-blur-[2px]"
        />
      )}

      <aside
        aria-label="Inspector"
        className={cn(
          "flex w-80 flex-shrink-0 flex-col border-l border-border bg-card/40",
          overlay &&
            "absolute inset-y-0 right-0 z-40 bg-card shadow-panel transition-transform duration-300 ease-drawer",
          overlay && (open ? "translate-x-0" : "translate-x-full"),
        )}
      >
        {isVisualize ? (
          <VizIndex repoId={repoId} />
        ) : (
          <RepoIndex repoData={repoData} isAnalyzing={isAnalyzing} />
        )}

        <AnalyzeAnother
          isAnalyzing={isAnalyzing}
          onAnalyze={onAnalyze}
          error={error}
        />
      </aside>
    </>
  );
}

/* ── Repository ─────────────────────────────────────────────── */

function RepoIndex({
  repoData,
  isAnalyzing,
}: {
  repoData: AnalyzeResponse | null;
  isAnalyzing: boolean;
}) {
  if (isAnalyzing || !repoData) {
    return (
      <div className="flex-1 space-y-6 p-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <div className="grid grid-cols-2 gap-px bg-border">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 rounded-none" />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-4/5" />
          <Skeleton className="h-2.5 w-2/3" />
        </div>
      </div>
    );
  }

  const languages = Object.entries(repoData.languages || {}).sort(
    ([, a], [, b]) => b - a,
  );
  const maxLang = languages.length ? languages[0][1] : 1;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <section className="border-b border-border p-4">
        <h2 className="eyebrow mb-3">Repository</h2>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border">
          <Stat label="Files" value={repoData.total_files} />
          <Stat label="Size" value={repoData.total_size_formatted} />
          <Stat label="Languages" value={languages.length} />
          <Stat
            label="Dependencies"
            value={repoData.graph?.metadata?.total_edges ?? 0}
          />
        </div>
      </section>

      {languages.length > 0 && (
        <section className="border-b border-border p-4">
          <h2 className="eyebrow mb-3">Languages</h2>
          <ul className="space-y-2">
            {languages.map(([lang, count], i) => (
              <li key={lang} className="flex items-center gap-2.5">
                <span className="w-20 truncate text-right text-[12px] text-foreground/80">
                  {lang}
                </span>
                <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(count / maxLang) * 100}%`,
                      background:
                        i === 0
                          ? "hsl(var(--signal))"
                          : "hsl(var(--foreground) / 0.35)",
                    }}
                  />
                </span>
                <span className="tnum w-6 text-right font-mono text-[11px] text-muted-foreground">
                  {count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="p-4">
        <h2 className="eyebrow mb-3">Files</h2>
        <FileTree data={repoData.tree} />
      </section>
    </ScrollArea>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <p className="tnum font-mono text-[15px] leading-none text-foreground">
        {value}
      </p>
      <p className="eyebrow mt-1.5">{label}</p>
    </div>
  );
}

/* ── Visualization index ────────────────────────────────────── */

function VizIndex({ repoId }: { repoId: string }) {
  const searchParams = useSearchParams();
  const active = searchParams.get("type") || "dependencies";

  /*
    Every chart is always listed, Neural Network included. Hiding it when
    `nn_models` came back empty made the feature invisible to exactly the
    people who needed to learn it exists, and an entry that appears for some
    repos and not others reads as a bug rather than as a result. When there is
    nothing to draw, the view itself says so and names which frameworks it can
    read — same as every other chart here handles its own empty case.
  */
  const charts = VIZ_CONFIG;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="border-b border-border p-4">
        <h2 className="eyebrow">Charts</h2>
      </div>

      <ul>
        {charts.map((viz) => {
          const isActive = active === viz.type;
          const Icon = viz.icon as any;
          return (
            <li key={viz.type}>
              <Link
                href={`/repo/${repoId}/visualize?type=${viz.type}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative flex flex-col gap-1 border-b border-border px-4 py-3",
                  "transition-colors duration-150 ease-out",
                  isActive ? "bg-accent/50" : "hover:bg-accent/30",
                )}
              >
                {isActive && (
                  <span className="absolute inset-y-0 left-0 w-[2px] bg-signal" />
                )}
                <span className="flex items-center gap-2.5">
                  <Icon
                    size={15}
                    strokeWidth={1.75}
                    className={cn(
                      "flex-shrink-0",
                      isActive ? "text-signal" : "text-muted-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[13px] font-medium",
                      isActive ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {viz.label}
                  </span>
                </span>
                {isActive && (
                  <span className="pl-[26px] text-[12px] leading-relaxed text-muted-foreground">
                    {viz.description}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <p className="p-4 text-[12px] leading-relaxed text-muted-foreground">
        Charts render as you open them. Only{" "}
        <span className="text-foreground">Data Flow</span> and AI insights spend
        tokens.
      </p>
    </ScrollArea>
  );
}

/* ── Analyze another ────────────────────────────────────────── */

function AnalyzeAnother({
  isAnalyzing,
  onAnalyze,
  error,
}: {
  isAnalyzing: boolean;
  onAnalyze: (url: string) => void;
  error: string | null;
}) {
  const [url, setUrl] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !isAnalyzing) onAnalyze(url.trim());
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex-shrink-0 border-t border-border bg-background/40 p-3"
    >
      <label htmlFor="inspector-url" className="eyebrow mb-2 block">
        Analyze another
      </label>
      <div className="flex gap-1.5">
        <input
          id="inspector-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="github.com/user/repo"
          spellCheck={false}
          className={cn(
            "h-8 min-w-0 flex-1 rounded-md border border-border bg-card px-2.5",
            "font-mono text-[12px] text-foreground placeholder:text-muted-foreground/70",
            "transition-[border-color,box-shadow] duration-150 ease-out",
            "focus:border-signal/60 focus:outline-none focus:ring-2 focus:ring-signal/15",
          )}
        />
        <button
          type="submit"
          disabled={!url.trim() || isAnalyzing}
          aria-label="Analyze repository"
          className={cn(
            "press grid h-8 w-8 flex-shrink-0 place-items-center rounded-md",
            "bg-foreground text-background transition-colors duration-150 ease-out",
            "hover:bg-foreground/88 disabled:opacity-30",
          )}
        >
          {isAnalyzing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Search size={14} strokeWidth={2} />
          )}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-destructive">{error}</p>
      )}
    </form>
  );
}
