import { useState, useRef, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  GitBranch,
  Loader2,
  Search,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { AnalyzeResponse } from "../lib/api";
import { ScrollArea } from "./ui/ScrollArea";
import { Skeleton } from "./ui/Skeleton";
import { FileTree } from "./ui/FileTree";

interface SidebarProps {
  repoData: AnalyzeResponse | null;
  isAnalyzing: boolean;
  onAnalyze: (url: string) => void;
  error: string | null;
}

export function Sidebar({ repoData, isAnalyzing, onAnalyze, error }: SidebarProps) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !isAnalyzing) {
      onAnalyze(url.trim());
    }
  };

  return (
    <aside className="w-80 flex-shrink-0 bg-card/40 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl flex flex-col h-full overflow-hidden">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center glow-pulse">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-foreground">
              CodeKavi
            </h1>
            <p className="text-xs text-muted-foreground leading-none mt-1">
              NotebookLM for GitHub
            </p>
          </div>
        </div>
      </div>

      {/* Repo Input */}
      <div className="px-4 py-4 border-b border-border/30">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Source Repository
          </label>
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
            <p className="text-[11px] text-error mt-1">{error}</p>
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
                <Stat label="Languages" value={Object.keys(repoData.languages).length} />
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
                {Object.entries(repoData.languages)
                  .sort(([, a], [, b]) => b - a)
                  .map(([lang, count]) => {
                    const max = Math.max(...Object.values(repoData.languages));
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
