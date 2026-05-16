"use client";

import { useEffect } from "react";
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

// Lazy-load D3 viz components — they're heavy (~300KB) and need browser APIs
const ArchitectureGraph = dynamic(
  () =>
    import("@/components/report/viz/ArchitectureGraph").then((m) => ({
      default: m.ArchitectureGraph,
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

function VizSkeleton() {
  return (
    <div className="w-full h-[400px] rounded-lg bg-[#21262d] animate-pulse flex items-center justify-center">
      <Loader2 className="w-6 h-6 text-[#8b949e] animate-spin" />
    </div>
  );
}

interface VisualizationCardProps {
  type: VizType;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
  state: VizState;
  explanationState: ExplainState;
  onGenerate: () => void;
  onRefresh: () => void;
  onExplain: () => void;
  includeExplanation: boolean;
}

export function VisualizationCard({
  type,
  label,
  description,
  icon: Icon,
  color,
  state,
  explanationState,
  onGenerate,
  onRefresh,
  onExplain,
  includeExplanation,
}: VisualizationCardProps) {
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
    <div className="bg-[#161b22] rounded-xl border border-[#30363d] overflow-hidden transition-all duration-300 hover:border-[#484f58]">
      {/* Card Header */}
      <div className="px-5 py-4 border-b border-[#30363d]/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${color}15` }}
            >
              <Icon size={18} style={{ color }} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#e6edf3]">{label}</h3>
              <p className="text-xs text-[#8b949e] mt-0.5">{description}</p>
            </div>
          </div>

          {/* Status badge */}
          {state.status === "success" && (
            <div className="flex items-center gap-1.5 text-xs text-[#3fb950]">
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
              className="flex flex-col items-center py-8"
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ backgroundColor: `${color}10` }}
              >
                <Icon size={28} style={{ color }} className="opacity-60" />
              </div>
              <button
                onClick={onGenerate}
                className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all duration-200 hover:brightness-110 active:scale-95"
                style={{ backgroundColor: color }}
              >
                Generate {label}
              </button>
              <p className="text-xs text-[#8b949e] mt-2">
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
              <div className="flex items-center gap-2 mb-4 text-sm text-[#8b949e]">
                <Loader2 size={16} className="animate-spin" style={{ color }} />
                <span>Generating {label}…</span>
              </div>
              <VizSkeleton />
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
              <div className="w-full overflow-hidden rounded-lg border border-[#30363d]/50">
                {renderVisualization(type, state.data.data)}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={onRefresh}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#8b949e] hover:text-[#e6edf3] bg-[#21262d] hover:bg-[#30363d] transition-colors"
                >
                  <RefreshCw size={12} />
                  Refresh
                </button>

                {!includeExplanation &&
                  explanationState.status === "idle" && (
                    <button
                      onClick={onExplain}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[#58a6ff] bg-[#58a6ff]/10 hover:bg-[#58a6ff]/20 transition-colors"
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
                    className="mt-4 pt-4 border-t border-[#30363d]/50"
                  >
                    <div className="flex items-center gap-2 text-sm text-[#8b949e]">
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
                      className="mt-4 pt-4 border-t border-[#30363d]/50"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles size={14} className="text-[#58a6ff]" />
                        <span className="text-xs font-semibold text-[#e6edf3]">
                          AI Explanation
                        </span>
                        <span className="text-xs text-[#8b949e]">
                          ({explanationState.tokensUsed} tokens)
                        </span>
                      </div>
                      <div className="text-sm text-[#c9d1d9] leading-relaxed prose prose-invert prose-sm max-w-none">
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
                    className="mt-4 pt-4 border-t border-[#30363d]/50"
                  >
                    <div className="flex items-center gap-2 text-sm text-[#f85149]">
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
              <AlertCircle size={32} className="text-[#f85149] mb-3" />
              <p className="text-sm text-[#f85149] mb-3">{state.error}</p>
              <button
                onClick={onGenerate}
                className="px-4 py-2 rounded-lg text-sm font-medium text-[#e6edf3] bg-[#21262d] hover:bg-[#30363d] transition-colors"
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
    case "architecture":
    case "dataflow":
      return (
        <ArchitectureGraph
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
        <p className="text-[#8b949e] text-center py-12">
          Unknown visualization type: {type}
        </p>
      );
  }
}
