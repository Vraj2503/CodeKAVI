import { useState, useRef, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Loader2,
  Search,
  Layers,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { AnalyzeResponse, FileNode } from "../lib/api";
import { ScrollArea } from "./ui/ScrollArea";
import { Skeleton } from "./ui/Skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/Tooltip";

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
    <aside className="w-80 flex-shrink-0 border-r border-border bg-bg-secondary flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
            <BookOpen className="w-4.5 h-4.5 text-accent" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight text-text-primary">
              CodeKavi
            </h1>
            <p className="text-[11px] text-text-muted leading-none">
              NotebookLM for GitHub
            </p>
          </div>
        </div>
      </div>

      {/* Repo Input */}
      <div className="px-4 py-3 border-b border-border">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <label className="text-[11px] font-medium text-text-muted uppercase tracking-wider">
            Source Repository
          </label>
          <div className="relative">
            <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              ref={inputRef}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="github.com/user/repo"
              className={cn(
                "w-full pl-8 pr-3 py-2 text-[13px] rounded-lg",
                "bg-bg-primary border border-border",
                "text-text-primary placeholder:text-text-muted",
                "focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20",
                "transition-all duration-200"
              )}
            />
          </div>
          <button
            type="submit"
            disabled={!url.trim() || isAnalyzing}
            className={cn(
              "flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium",
              "bg-accent text-white",
              "hover:bg-accent-hover active:scale-[0.98]",
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
      <TooltipProvider>
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
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2.5">
                Repository
              </h2>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[13px] font-semibold text-text-primary">
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
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2.5">
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
                        <span className="text-[12px] text-text-secondary w-20 truncate text-right">
                          {lang}
                        </span>
                        <div className="flex-1 h-1.5 bg-bg-hover rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, ease: "easeOut" }}
                            className="h-full rounded-full bg-gradient-to-r from-accent to-info"
                          />
                        </div>
                        <span className="text-[11px] text-text-muted font-mono w-5 text-right">
                          {count}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Source Files */}
            <div className="px-4 py-3">
              <h2 className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Layers className="w-3 h-3" />
                Sources ({repoData.total_files})
              </h2>
              <div className="space-y-0.5">
                <FileTree nodes={repoData.tree} />
              </div>
            </div>
              </ScrollArea>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </TooltipProvider>
    </aside>
  );
}

// ── Stat pill ──
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-bg-primary rounded-md px-2.5 py-1.5 border border-border">
      <p className="text-[10px] text-text-muted">{label}</p>
      <p className="text-[13px] font-semibold text-text-primary">{value}</p>
    </div>
  );
}

// ── File Tree ──
function FileTree({ nodes }: { nodes: FileNode[] }) {
  return (
    <>
      {nodes.map((node) =>
        node.type === "dir" ? (
          <DirNode key={node.path} node={node} />
        ) : (
          <FileNodeItem key={node.path} node={node} />
        )
      )}
    </>
  );
}

function DirNode({ node }: { node: FileNode }) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full text-left py-0.5 px-1 rounded hover:bg-bg-hover transition-colors text-[12px] text-text-secondary"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-text-muted" />
        ) : (
          <ChevronRight className="w-3 h-3 text-text-muted" />
        )}
        {open ? (
          <FolderOpen className="w-3.5 h-3.5 text-warning" />
        ) : (
          <Folder className="w-3.5 h-3.5 text-warning" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {open && node.children && (
        <div className="ml-3 pl-2 border-l border-border/50">
          <FileTree nodes={node.children} />
        </div>
      )}
    </div>
  );
}

function FileNodeItem({ node }: { node: FileNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1.5 py-0.5 px-1 pl-6 rounded hover:bg-bg-hover transition-colors text-[12px] text-text-secondary cursor-default">
          <FileText className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          <span className="truncate flex-1 text-left">{node.name}</span>
          {node.size_formatted && (
            <span className="text-[10px] text-text-muted font-mono flex-shrink-0">
              {node.size_formatted}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="font-mono text-[10px]">
        {node.path}
      </TooltipContent>
    </Tooltip>
  );
}
