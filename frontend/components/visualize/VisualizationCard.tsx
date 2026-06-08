"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { VizState } from "@/hooks/useVisualization";
import type { ExplainState } from "@/hooks/useExplanation";
import type { VizType } from "@/lib/api";
import { DownloadMenu } from "./DownloadMenu";

// Lazy-load D3 viz components — they're heavy (~300KB) and need browser APIs
const DependencyGraph = dynamic(
  () =>
    import("@/components/report/viz/DependencyGraph").then((m) => ({
      default: m.DependencyGraph,
    })),
  { ssr: false, loading: () => <VizSkeleton /> }
);

const ArchitectureGraph = dynamic(
  () =>
    import("@/components/report/viz/ArchitectureGraph").then((m) => ({
      default: m.ArchitectureGraph,
    })),
  { ssr: false, loading: () => <VizSkeleton /> }
);

const DataFlowGraph = dynamic(
  () =>
    import("@/components/report/viz/DataFlowGraph").then((m) => ({
      default: m.DataFlowGraph,
    })),
  { ssr: false, loading: () => <VizSkeleton /> }
);

const TreemapViz = dynamic(
  () =>
    import("@/components/report/viz/TreemapViz").then((m) => ({
      default: m.TreemapViz,
    })),
  { ssr: false, loading: () => <VizSkeleton /> }
);

const RadialMindmap = dynamic(
  () =>
    import("@/components/report/viz/RadialMindmap").then((m) => ({
      default: m.RadialMindmap,
    })),
  { ssr: false, loading: () => <VizSkeleton /> }
);

function VizSkeleton({ height = 350 }: { height?: number }) {
  return (
    <div className={`w-full rounded-lg bg-muted animate-pulse flex items-center justify-center`} style={{ height }}>
      <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
    </div>
  );
}

interface VisualizationCardProps {
  type: VizType;
  label: string;
  description: string;
  icon: LucideIcon;
  state: VizState;
  explanationState: ExplainState;
  onGenerate: () => void;
  onRefresh: () => void;
  onExplain: () => void;
  includeExplanation: boolean;
  fullWidth?: boolean;
}

export function VisualizationCard({
  type,
  label,
  description,
  icon: Icon,
  state,
  explanationState,
  onGenerate,
  onRefresh,
  onExplain,
  includeExplanation,
  fullWidth = false,
}: VisualizationCardProps) {
  // Ref for the visualization container (used by DownloadMenu)
  const vizContainerRef = useRef<HTMLDivElement>(null);

  // Auto-trigger explanation when visualization completes and toggle is on
  useEffect(() => {
    if (
      includeExplanation &&
      state.status === "success" &&
      explanationState.status === "idle"
    ) {
      onExplain();
    }
  }, [includeExplanation, state.status, explanationState.status, onExplain]);

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden transition-all duration-300 hover:border-muted-foreground/40">
      {/* Card Header */}
      <div className="px-5 py-4 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-muted">
              <Icon size={18} className="text-foreground" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">{label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            </div>
          </div>

          {/* Status badge */}
          {state.status === "success" && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle size={14} />
              <span>Cached</span>
            </div>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="px-5 py-4">
        <AnimatePresence mode="wait">
          {/* IDLE state — show generate button */}
          {state.status === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`flex flex-col items-center ${fullWidth ? 'py-12' : 'py-8'}`}
            >
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-muted mb-4">
                <Icon size={28} className="text-muted-foreground" />
              </div>
              <button
                onClick={onGenerate}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-foreground text-background transition-all duration-200 hover:bg-foreground/90 active:scale-95"
              >
                Generate {label}
              </button>
              <p className="text-xs text-muted-foreground mt-2">
                {type === "mindmap" ? "Uses LLM when AI mode is on" : "Static data — zero LLM cost"}
              </p>
            </motion.div>
          )}

          {/* LOADING state — show skeleton */}
          {state.status === "loading" && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-4"
            >
              <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
                <Loader2 size={16} className="animate-spin text-foreground" />
                <span>Generating {label}…</span>
              </div>
              <VizSkeleton height={fullWidth ? 500 : 350} />
            </motion.div>
          )}

          {/* SUCCESS state — render visualization */}
          {state.status === "success" && state.data && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="py-2"
            >
              {/* Rendered visualization */}
              <div ref={vizContainerRef} className="w-full overflow-hidden rounded-lg border border-border/50">
                {renderVisualization(type, state.data.data)}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={onRefresh}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/80 transition-colors"
                >
                  <RefreshCw size={12} />
                  Refresh
                </button>

                {/* Download menu */}
                <DownloadMenu
                  containerRef={vizContainerRef}
                  data={state.data.data}
                  filename={`${type}-visualization`}
                />

                {!includeExplanation &&
                  explanationState.status === "idle" && (
                    <button
                      onClick={onExplain}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground bg-primary/10 hover:bg-primary/20 transition-colors"
                    >
                      <Sparkles size={12} />
                      Explain This Graph
                    </button>
                  )}
              </div>

              {/* Explanation section */}
              <AnimatePresence>
                {explanationState.status === "loading" && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 pt-4 border-t border-border/50"
                  >
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 size={14} className="animate-spin" />
                      Generating AI explanation…
                    </div>
                  </motion.div>
                )}

                {explanationState.status === "success" &&
                  explanationState.explanation && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-4 pt-4 border-t border-border/50"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles size={14} className="text-foreground" />
                        <span className="text-xs font-semibold text-foreground">
                          AI Explanation
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({explanationState.tokensUsed} tokens)
                        </span>
                      </div>
                      <div className="text-sm text-foreground/85 leading-relaxed prose dark:prose-invert prose-sm max-w-none prose-headings:text-foreground prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-strong:text-foreground">
                        <ReactMarkdown>
                          {explanationState.explanation}
                        </ReactMarkdown>
                      </div>
                    </motion.div>
                  )}

                {explanationState.status === "error" && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-4 pt-4 border-t border-border/50"
                  >
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertCircle size={14} />
                      {explanationState.error}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {/* ERROR state */}
          {state.status === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center py-8"
            >
              <AlertCircle size={32} className="text-destructive mb-3" />
              <p className="text-sm text-destructive mb-3">{state.error}</p>
              <button
                onClick={onGenerate}
                className="px-4 py-2 rounded-lg text-sm font-medium text-foreground bg-muted hover:bg-muted/80 transition-colors"
              >
                Try Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Render the right visualization component based on type ──

function renderVisualization(type: VizType, data: any) {
  if (!data) return null;

  switch (type) {
    case "dependencies":
      return (
        <DependencyGraph
          nodes={data.nodes || []}
          edges={data.edges || []}
        />
      );
    case "architecture":
      return (
        <ArchitectureGraph
          nodes={data.nodes || []}
          edges={data.edges || []}
        />
      );
    case "dataflow":
      return (
        <DataFlowGraph
          nodes={data.nodes || []}
          edges={data.edges || []}
        />
      );
    case "complexity":
      return <TreemapViz data={data} />;
    case "mindmap":
      return <RadialMindmap root={data.root || data} />;
    default:
      return (
        <p className="text-muted-foreground text-center py-12">
          Unknown visualization type: {type}
        </p>
      );
  }
}
