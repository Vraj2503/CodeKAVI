"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useRef, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { VIZ_CONFIG } from "@/components/visualize/VisualizationPanel";
import {
  Search,
  MessageSquare,
  GitBranch,
  Loader2,
  FileText,
  BarChart3,
  Network,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeRepoUrl } from "@/lib/repoUrl";
import { useRepo } from "@/components/RepoProvider";
import { useMediaQuery, NARROW_QUERY } from "@/hooks/useMediaQuery";
import type { AnalyzeResponse } from "@/lib/api";
import { ScrollArea } from "./ui/ScrollArea";
import { Skeleton } from "./ui/Skeleton";
import { FileTree } from "./ui/FileTree";
import { Button } from "./ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./ui/Tooltip";

interface SidebarProps {
  repoData: AnalyzeResponse | null;
  repoId: string;
  isAnalyzing: boolean;
  onAnalyze: (url: string) => void;
  error: string | null;
}

export function Sidebar({
  repoData,
  repoId,
  isAnalyzing,
  onAnalyze,
  error,
}: SidebarProps) {
  const [url, setUrl] = useState("");
  const { sidebarCollapsed: isCollapsed, setSidebarCollapsed: setIsCollapsed } =
    useRepo();
  const inputRef = useRef<HTMLInputElement>(null);
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeViz = searchParams.get("type") || "dependencies";

  // Determine active tab from URL
  const activeTab = pathname.includes("/report")
    ? "report"
    : pathname.includes("/visualize")
      ? "visualize"
      : pathname.includes("/graph")
        ? "graph"
        : "chat";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !isAnalyzing) {
      onAnalyze(normalizeRepoUrl(url));
    }
  };

  const tabs = [
    {
      key: "chat",
      label: "Chat",
      icon: MessageSquare,
      href: `/repo/${repoId}/chat`,
    },
    {
      key: "report",
      label: "Report",
      icon: FileText,
      href: `/repo/${repoId}/report`,
    },
    {
      key: "visualize",
      label: "Visualize",
      icon: BarChart3,
      href: `/repo/${repoId}/visualize`,
    },
    {
      key: "graph",
      label: "Graph",
      icon: Network,
      href: `/repo/${repoId}/graph`,
    },
  ];

  return (
    <>
      {/*
        On a narrow viewport an expanded sidebar floats over the canvas rather
        than taking a 320px bite out of it — at 375px that bite left the chart
        5px wide (QA-001). The backdrop gives a tap target to dismiss it, which
        matters because the collapse button is a 14px icon.
      */}
      {isNarrow && !isCollapsed && (
        <button
          type="button"
          aria-label="Close sidebar"
          onClick={() => setIsCollapsed(true)}
          className="absolute inset-0 z-20 bg-background/60 backdrop-blur-sm lg:hidden"
        />
      )}
    <aside
      className={cn(
        "flex h-full flex-shrink-0 flex-col overflow-hidden border-r border-border",
        "bg-sidebar",
        // `transition-all` was animating every property including width's
        // layout pass; only the width actually changes here.
        "transition-[width] duration-300 ease-swift",
        isCollapsed ? "w-14" : "w-80",
        // Flat while docked, lifted only when it floats over the canvas.
        isNarrow && !isCollapsed && "absolute inset-y-0 left-0 z-30 shadow-float",
      )}
    >
      {/* View Mode Tabs */}
      {/*
        QA-005: four labels across a 320px column left ~27px each, so every tab
        rendered as two characters and an ellipsis — "Ch…", "Re…", "Vi…", "Gr…".
        Two rows of two gives each label the width it needs. The cost is ~36px
        of height, which the list below absorbs by scrolling.
      */}
      {/*
        A segmented control in a hairlined well, rather than four
        independent buttons where the active one grew a coloured border.
        The well makes the four read as one control with one selection,
        and the selected segment takes a solid signal fill — on this
        surface the brightest thing in a group is the chosen thing.

        `delayDuration`/`skipDelayDuration`: the first tooltip waits, but
        moving between adjacent tabs inside 300ms opens the next one with
        no delay and no animation (see `.overlay-pop[data-instant]`).
      */}
      <div className={cn("p-2", isCollapsed ? "" : "pb-2.5")}>
        <div
          className={cn(
            "border border-border bg-muted/40 p-1",
            isCollapsed ? "flex flex-col gap-1" : "grid grid-cols-2 gap-1",
          )}
        >
          <TooltipProvider delayDuration={400} skipDelayDuration={300}>
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <Tooltip key={tab.key}>
                  <TooltipTrigger asChild>
                    <Link
                      href={tab.href}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.06em]",
                        "transition-[background-color,color,box-shadow] duration-150 ease-out",
                        isCollapsed ? "p-2.5" : "min-w-0 px-2.5 py-1.5",
                        isActive
                          ? "bg-signal text-signal-foreground"
                          : "text-muted-foreground [@media(hover:hover)]:hover:text-foreground",
                      )}
                    >
                      <tab.icon
                        size={isCollapsed ? 18 : 14}
                        className={cn(
                          "flex-shrink-0 transition-colors",
                          isActive && "text-signal-foreground",
                        )}
                      />
                      {!isCollapsed && (
                        <span className="truncate">{tab.label}</span>
                      )}
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side={isCollapsed ? "right" : "bottom"}>
                    {tab.label}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </TooltipProvider>
        </div>
      </div>

      {/* Toggle Header (Always visible) */}
      <div
        className={cn(
          "flex items-center border-b border-border/60",
          isCollapsed ? "justify-center p-3" : "justify-between px-4 py-2.5",
        )}
      >
        {!isCollapsed && <span className="eyebrow">Source</span>}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "p-1.5 text-muted-foreground transition-colors duration-150",
            "[@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-foreground",
            !isCollapsed && "-mr-1.5",
          )}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? (
            <PanelLeft className="h-[18px] w-[18px]" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      <div
        className={cn(
          "flex flex-col flex-1 min-h-0 transition-opacity duration-300",
          isCollapsed ? "hidden" : "flex",
        )}
      >
        {activeTab === "visualize" ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Header / Repo Name */}
            <div className="border-b border-border/60 px-4 py-4">
              <h2 className="eyebrow mb-2">Visualizations</h2>
              {repoData && (
                <p className="truncate font-mono text-[13px] text-foreground">
                  <span className="text-muted-foreground/60">
                    {repoData.owner}/
                  </span>
                  {repoData.repo_name}
                </p>
              )}
            </div>

            {/* List of visualizations */}
            <ScrollArea className="flex-1 px-3 py-4">
              <div className="space-y-1.5">
                {VIZ_CONFIG.filter((viz) => {
                  if (
                    viz.type === "neural_network" &&
                    (!repoData?.nn_models || repoData.nn_models.length === 0)
                  ) {
                    return false;
                  }
                  return true;
                }).map((viz) => {
                  const isActive = activeViz === viz.type;
                  const Icon = viz.icon as any;
                  return (
                    <Link
                      key={viz.type}
                      href={`/repo/${repoId}/visualize?type=${viz.type}`}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "flex w-full flex-col items-start border p-2.5 text-left",
                        "transition-[background-color,border-color,color] duration-150 ease-out",
                        isActive
                          ? "border-signal/50 bg-signal/[0.09]"
                          : "border-transparent text-muted-foreground [@media(hover:hover)]:hover:bg-accent/50 [@media(hover:hover)]:hover:text-foreground",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon
                          size={15}
                          className={cn(
                            "shrink-0",
                            isActive ? "text-signal" : "text-muted-foreground",
                          )}
                        />
                        <span
                          className={cn(
                            "font-sans text-[13px] font-medium",
                            isActive ? "text-foreground" : "text-inherit",
                          )}
                        >
                          {viz.label}
                        </span>
                      </div>
                      {isActive && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                          className="mt-1.5 overflow-hidden pl-[25px] font-sans text-[11.5px] leading-relaxed text-muted-foreground"
                        >
                          {viz.description}
                        </motion.p>
                      )}
                    </Link>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Bottom info panel */}
            <div className="border-t border-border/60 p-3">
              <div className="flex items-start gap-2.5 border border-border bg-background/50 p-3 font-sans text-[11.5px] leading-relaxed text-muted-foreground">
                <div className="live-dot mt-[5px] h-1.5 w-1.5 flex-shrink-0 bg-signal" />
                <span className="leading-relaxed">
                  {/* T13 changed what this describes: charts now render on
                      arrival, so "on-demand generation" was no longer true of
                      five of the six. */}
                  Charts render as you open them. Only Data Flow and AI
                  Insights spend tokens.
                </span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Repo Input */}
            <div className="border-b border-border/60 px-4 pb-4 pt-3">
              <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                <div className="relative">
                  <GitBranch className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="github.com/owner/repo"
                    aria-label="Repository to analyze"
                    className={cn(
                      "w-full py-2 pl-9 pr-3 font-mono text-[12.5px]",
                      "border border-border bg-background/60",
                      "text-foreground placeholder:text-muted-foreground/55",
                      "transition-[border-color,box-shadow] duration-150 ease-out",
                      "focus:border-signal focus:outline-none",
                    )}
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!url.trim() || isAnalyzing}
                  className="w-full"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Analyzing…
                    </>
                  ) : (
                    <>
                      <Search />
                      Analyze
                    </>
                  )}
                </Button>
                {error && (
                  <p role="alert" className="mt-0.5 font-sans text-[11px] text-destructive">
                    {error}
                  </p>
                )}
              </form>
            </div>

            {/* Repo Metadata */}
            <AnimatePresence mode="wait">
              {isAnalyzing ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex-1 px-4 py-5 space-y-6"
                >
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-24" />
                    <div className="grid grid-cols-2 gap-2">
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                      <Skeleton className="h-14 w-full" />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                    <Skeleton className="h-3 w-5/6" />
                  </div>
                </motion.div>
              ) : repoData ? (
                <motion.div
                  key="content"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex-1 min-h-0"
                >
                  <ScrollArea className="h-full">
                    {/* Stats */}
                    <div className="border-b border-border/60 px-4 py-4">
                      <h2 className="eyebrow mb-2.5">Repository</h2>
                      <p className="mb-3 truncate font-mono text-[13px] text-foreground">
                        <span className="text-muted-foreground/60">
                          {repoData.owner}/
                        </span>
                        {repoData.repo_name}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Stat label="Files" value={repoData.total_files} />
                        <Stat
                          label="Size"
                          value={repoData.total_size_formatted}
                        />
                        <Stat
                          label="Languages"
                          value={Object.keys(repoData.languages || {}).length}
                        />
                        <Stat
                          label="Deps"
                          value={repoData.graph?.metadata?.total_edges ?? 0}
                        />
                      </div>
                    </div>

                    {/* Language Breakdown */}
                    <div className="border-b border-border/60 px-4 py-4">
                      <h2 className="eyebrow mb-3">Languages</h2>
                      <div className="space-y-2">
                        {Object.entries(repoData.languages || {})
                          .sort(([, a], [, b]) => b - a)
                          .map(([lang, count], i) => {
                            const max = Math.max(
                              ...Object.values(repoData.languages || {}),
                            );
                            const pct = (count / max) * 100;
                            return (
                              /*
                               * Label over bar, not label | bar | count in
                               * three columns — the old layout gave the
                               * name a fixed 80px and right-aligned it,
                               * so "TypeScript" and "Go" started in
                               * different places and the eye had nothing
                               * to run down.
                               *
                               * The bar grows with scaleX rather than
                               * width. Width animates layout on every
                               * frame, once per language, on mount.
                               */
                              <div key={lang}>
                                <div className="mb-1 flex items-baseline justify-between gap-2">
                                  <span className="truncate font-sans text-[11.5px] text-foreground/85">
                                    {lang}
                                  </span>
                                  <span className="tabular shrink-0 text-[10.5px] text-muted-foreground">
                                    {count}
                                  </span>
                                </div>
                                <div className="h-[3px] overflow-hidden bg-muted">
                                  <motion.div
                                    initial={{ transform: "scaleX(0)" }}
                                    animate={{ transform: `scaleX(${pct / 100})` }}
                                    transition={{
                                      duration: 0.5,
                                      ease: [0.23, 1, 0.32, 1],
                                      delay: Math.min(i * 0.04, 0.32),
                                    }}
                                    style={{ transformOrigin: "left" }}
                                    className="h-full bg-signal"
                                  />
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>

                    <div className="px-4 py-3 h-full pb-20">
                      <FileTree data={repoData.tree} />
                    </div>
                  </ScrollArea>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </>
        )}
      </div>
    </aside>
    </>
  );
}

// ── Stat pill ──
// Value above label, and the value set in tabular mono: these numbers
// change when a repo is re-analyzed, and tabular figures keep the four
// cells from reflowing as digit counts change.
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border bg-background/60 px-2.5 py-2">
      <p className="readout text-[16px] text-foreground">{value}</p>
      <p className="mt-1.5 font-sans text-[10.5px] leading-none text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
