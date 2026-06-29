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
  PanelLeftClose,
  PanelLeft
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalyzeResponse } from "@/lib/api";
import { ScrollArea } from "./ui/ScrollArea";
import { Skeleton } from "./ui/Skeleton";
import { FileTree } from "./ui/FileTree";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./ui/Tooltip";

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
  const [isCollapsed, setIsCollapsed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeViz = searchParams.get("type") || "dependencies";

  // Determine active tab from URL
  const activeTab = pathname.includes("/report")
    ? "report"
    : pathname.includes("/visualize")
      ? "visualize"
      : "chat";

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !isAnalyzing) {
      onAnalyze(url.trim());
    }
  };

  const tabs = [
    { key: "chat", label: "Chat", icon: MessageSquare, href: `/repo/${repoId}/chat` },
    { key: "report", label: "Report", icon: FileText, href: `/repo/${repoId}/report` },
    { key: "visualize", label: "Visualize", icon: BarChart3, href: `/repo/${repoId}/visualize` },
  ];

  return (
    <aside className={cn(
      "flex-shrink-0 bg-card/40 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl flex flex-col h-full overflow-hidden transition-all duration-300",
      isCollapsed ? "w-14" : "w-80"
    )}>
      {/* View Mode Tabs */}
      <div className={cn("flex border-b border-border/40 p-2", isCollapsed ? "flex-col gap-2" : "gap-1")}>
        <TooltipProvider delayDuration={100}>
          {tabs.map((tab) => (
            <Tooltip key={tab.key}>
              <TooltipTrigger asChild>
                <Link
                  href={tab.href}
                  className={cn(
                    "rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2",
                    isCollapsed ? "p-3" : "flex-1 px-3 py-2",
                    activeTab === tab.key
                      ? "bg-primary/20 border border-primary/50 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  <tab.icon size={isCollapsed ? 20 : 14} />
                  {!isCollapsed && tab.label}
                </Link>
              </TooltipTrigger>
              {isCollapsed && (
                <TooltipContent side="right">
                  {tab.label}
                </TooltipContent>
              )}
            </Tooltip>
          ))}
        </TooltipProvider>
      </div>

      {/* Toggle Header (Always visible) */}
      <div className={cn("flex items-center border-b border-border/30", isCollapsed ? "justify-center p-3" : "justify-between px-4 py-3")}>
        {!isCollapsed && (
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Source Repository
          </label>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn("p-1.5 rounded-lg hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground", !isCollapsed && "-mr-1.5")}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      <div className={cn("flex flex-col flex-1 min-h-0 transition-opacity duration-300", isCollapsed ? "hidden" : "flex")}>
        {activeTab === "visualize" ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Header / Repo Name */}
            <div className="px-4 py-4 border-b border-border/30">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Visualization Studio
              </h2>
              {repoData && (
                <p className="text-sm font-bold text-foreground truncate">
                  {repoData.owner}/{repoData.repo_name}
                </p>
              )}
            </div>

            {/* List of visualizations */}
            <ScrollArea className="flex-1 px-3 py-4">
              <div className="space-y-1.5">
                {VIZ_CONFIG.map((viz) => {
                  const isActive = activeViz === viz.type;
                  const Icon = viz.icon as any;
                  return (
                    <Link
                      key={viz.type}
                      href={`/repo/${repoId}/visualize?type=${viz.type}`}
                      className={cn(
                        "w-full flex flex-col items-start p-3 rounded-xl transition-all duration-200 text-left border",
                        isActive
                          ? "bg-primary/10 border-primary/20 shadow-sm"
                          : "hover:bg-accent/40 border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          "p-1.5 rounded-md",
                          isActive ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                        )}>
                          <Icon size={16} />
                        </div>
                        <span className={cn(
                          "text-sm font-semibold",
                          isActive ? "text-foreground" : "text-muted-foreground"
                        )}>
                          {viz.label}
                        </span>
                      </div>
                      {isActive && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          className="text-xs text-muted-foreground mt-2 leading-relaxed"
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
            <div className="p-4 border-t border-border/30 bg-muted/10">
              <div className="flex items-start gap-2.5 text-xs text-muted-foreground bg-background/30 p-3 rounded-xl border border-border/40">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse mt-1 flex-shrink-0" />
                <span className="leading-relaxed">On-demand generation (zero LLM tokens unless insights requested)</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Repo Input */}
            <div className="px-4 pb-4 pt-2 border-b border-border/30">
              <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
                <div className="relative">
                  <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="github.com/user/repo"
                    className={cn(
                      "w-full pl-9 pr-3 py-2.5 text-sm rounded-xl",
                      "bg-background/50 border border-border/50",
                      "text-foreground placeholder:text-muted-foreground",
                      "focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20",
                      "transition-all duration-200"
                    )}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!url.trim() || isAnalyzing}
                  className={cn(
                    "flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold",
                    "bg-primary text-primary-foreground shadow-md shadow-primary/20",
                    "hover:bg-primary/90 active:scale-[0.98]",
                    "disabled:opacity-40 disabled:cursor-not-allowed",
                    "transition-all duration-200"
                  )}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Analyzing…
                    </>
                  ) : (
                    <>
                      <Search className="w-3.5 h-3.5" />
                      Analyze Repository
                    </>
                  )}
                </button>
                {error && (
                  <p className="text-[11px] text-destructive mt-1">{error}</p>
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
                    <div className="px-4 py-4 border-b border-border/30">
                      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Repository
                      </h2>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-sm font-bold text-foreground">
                          {repoData.owner}/{repoData.repo_name}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Stat label="Files" value={repoData.total_files} />
                        <Stat label="Size" value={repoData.total_size_formatted} />
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
                    <div className="px-4 py-4 border-b border-border/30">
                      <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                        Languages
                      </h2>
                      <div className="space-y-1.5">
                        {Object.entries(repoData.languages || {})
                          .sort(([, a], [, b]) => b - a)
                          .map(([lang, count]) => {
                            const max = Math.max(
                              ...Object.values(repoData.languages || {})
                            );
                            const pct = (count / max) * 100;
                            return (
                              <div key={lang} className="flex items-center gap-2">
                                <span className="text-[12px] text-foreground/80 w-20 truncate text-right">
                                  {lang}
                                </span>
                                <div className="flex-1 h-1.5 bg-accent rounded-full overflow-hidden">
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${pct}%` }}
                                    transition={{ duration: 0.8, ease: "easeOut" }}
                                    className="h-full rounded-full bg-gradient-to-r from-primary to-ring"
                                  />
                                </div>
                                <span className="text-[11px] text-muted-foreground font-mono w-5 text-right">
                                  {count}
                                </span>
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
  );
}

// ── Stat pill ──
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background rounded-md px-2.5 py-1.5 border border-border/50">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-[13px] font-semibold text-foreground">{value}</p>
    </div>
  );
}
