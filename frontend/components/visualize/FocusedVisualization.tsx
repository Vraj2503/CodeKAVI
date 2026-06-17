/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { VizState } from "@/hooks/useVisualization";
import type { ExplainState } from "@/hooks/useExplanation";
import type { VizType } from "@/lib/api";
import { DownloadMenu } from "./DownloadMenu";

// Lazy-load D3 viz components
const DependencyGraph = dynamic(
  () => import("@/components/report/viz/DependencyGraph").then((m) => m.DependencyGraph),
  { ssr: false, loading: () => <VizSkeleton /> }
);
const ArchitectureGraph = dynamic(
  () => import("@/components/report/viz/ArchitectureGraph").then((m) => m.ArchitectureGraph),
  { ssr: false, loading: () => <VizSkeleton /> }
);
const DataFlowGraph = dynamic(
  () => import("@/components/report/viz/DataFlowGraph").then((m) => m.DataFlowGraph),
  { ssr: false, loading: () => <VizSkeleton /> }
);
const TreemapViz = dynamic(
  () => import("@/components/report/viz/TreemapViz").then((m) => m.TreemapViz),
  { ssr: false, loading: () => <VizSkeleton /> }
);
const RadialMindmap = dynamic(
  () => import("@/components/report/viz/RadialMindmap").then((m) => m.RadialMindmap),
  { ssr: false, loading: () => <VizSkeleton /> }
);

function VizSkeleton() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center">
      <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
      <div className="text-muted-foreground animate-pulse">Rendering Visualization...</div>
    </div>
  );
}

interface FocusedVisualizationProps {
  type: VizType;
  config: { label: string; description: string; icon: any };
  state: VizState;
  explanationState: ExplainState;
  onGenerate: () => void;
  onRefresh: () => void;
  onExplain: () => void;
  isExplanationOpen: boolean;
  toggleExplanation: () => void;
}

export function FocusedVisualization({
  type,
  config,
  state,
  explanationState,
  onGenerate,
  onRefresh,
  onExplain,
  isExplanationOpen,
  toggleExplanation,
}: FocusedVisualizationProps) {
  const vizContainerRef = useRef<HTMLDivElement>(null);
  const insightsRef = useRef<HTMLDivElement>(null);
  const Icon = config.icon;

  // Scroll to AI Insights section smoothly
  const scrollToInsights = () => {
    insightsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleInsightsClick = () => {
    if (!isExplanationOpen) {
      // First time: trigger generation + open
      if (explanationState.status === "idle") onExplain();
      else toggleExplanation();
      // Give DOM a tick to render before scrolling
      setTimeout(scrollToInsights, 80);
    } else {
      toggleExplanation();
    }
  };

  return (
    /**
     * Outer wrapper: fills the bounded main panel but scrolls vertically.
     * Graph section = 100% of the visible area.
     * AI Insights section = naturally below — scroll down to reach it.
     */
    <div className="w-full h-full overflow-y-auto overflow-x-hidden">

      {/* ── GRAPH SECTION — fills full visible height ───────────────────────── */}
      <div className="relative w-full" style={{ height: "100%" }}>

        {/* Floating Action Bar */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-20 pointer-events-none">
          {/* Left: title pill */}
          <div className="flex items-center gap-2 bg-background/90 backdrop-blur-md px-4 py-2.5 rounded-xl border border-border shadow-sm pointer-events-auto">
            <Icon size={20} className="text-primary" />
            <h2 className="text-sm font-bold text-foreground">{config.label}</h2>
          </div>

          {/* Right: action buttons */}
          {state.status === "success" && (
            <div className="flex items-center gap-2 pointer-events-auto">
              <button
                onClick={onRefresh}
                className="p-2.5 rounded-xl bg-background/90 backdrop-blur-md border border-border shadow-sm text-muted-foreground hover:text-foreground transition-colors"
                title="Refresh Visualization"
              >
                <RefreshCw size={18} />
              </button>

              <DownloadMenu
                containerRef={vizContainerRef}
                data={state.data?.data}
                filename={`${type}-visualization`}
              />

              {/* AI Insights — scrolls page down to insights section */}
              <button
                onClick={handleInsightsClick}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl backdrop-blur-md border shadow-sm transition-all duration-200 ${
                  isExplanationOpen
                    ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                    : "bg-background/90 border-border text-foreground hover:bg-muted"
                }`}
              >
                <Sparkles size={18} />
                <span className="text-sm font-semibold">AI Insights</span>
              </button>
            </div>
          )}
        </div>

        {/* Visualization canvas — fills the graph section, padded top so bars don't overlay nodes */}
        <div className="w-full h-full flex items-center justify-center bg-muted/10 pt-16">
          <AnimatePresence mode="wait">
            {state.status === "idle" && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center max-w-md text-center p-10 bg-card rounded-3xl border border-border/50 shadow-2xl"
              >
                <div className="w-24 h-24 rounded-3xl flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5 text-primary mb-6 shadow-inner">
                  <Icon size={48} />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-3">{config.label}</h2>
                <p className="text-muted-foreground mb-10 leading-relaxed text-sm">
                  {config.description}
                </p>
                <button
                  onClick={onGenerate}
                  className="px-8 py-3.5 rounded-xl text-sm font-bold bg-foreground text-background transition-all duration-300 hover:bg-foreground/90 hover:shadow-lg active:scale-95 flex items-center gap-2"
                >
                  <Icon size={18} />
                  Generate Visualization
                </button>
              </motion.div>
            )}

            {state.status === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-5"
              >
                <Loader2 size={48} className="animate-spin text-primary" />
                <p className="text-foreground font-medium animate-pulse text-lg">
                  Analyzing Codebase &amp; Generating {config.label}...
                </p>
              </motion.div>
            )}

            {state.status === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center max-w-md text-center p-10 bg-card rounded-3xl border border-destructive/20 shadow-2xl"
              >
                <div className="w-20 h-20 rounded-full flex items-center justify-center bg-destructive/10 text-destructive mb-6">
                  <AlertCircle size={40} />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-3">Generation Failed</h3>
                <p className="text-sm text-destructive mb-8">{state.error}</p>
                <button
                  onClick={onGenerate}
                  className="px-8 py-3 rounded-xl text-sm font-semibold bg-muted hover:bg-muted/80 transition-colors border border-border"
                >
                  Try Again
                </button>
              </motion.div>
            )}

            {state.status === "success" && state.data && (
              <motion.div
                key="success"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="w-full h-full"
                ref={vizContainerRef}
              >
                {renderVisualization(type, state.data.data)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── AI INSIGHTS SECTION — lives below the graph, reachable by scrolling ── */}
      <AnimatePresence>
        {isExplanationOpen && (
          <motion.div
            ref={insightsRef}
            key="ai-insights"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-full border-t border-border/50 bg-card/95 backdrop-blur-xl"
          >
            {/* Insights header */}
            <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between sticky top-0 bg-card/95 backdrop-blur-xl z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Sparkles size={16} className="text-primary" />
                </div>
                <h3 className="font-bold text-foreground text-base">AI Insights</h3>
              </div>
              <button
                onClick={toggleExplanation}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Close AI Insights"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {explanationState.status === "idle" && (
                <div className="flex flex-col items-center text-center text-muted-foreground py-10">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-5">
                    <Sparkles size={26} className="text-muted-foreground/50" />
                  </div>
                  <h4 className="text-foreground font-semibold text-lg mb-2">Ready to Analyze</h4>
                  <p className="text-sm mb-8 max-w-sm leading-relaxed">
                    Generate AI-powered insights to understand the patterns and architecture hidden in this visualization.
                  </p>
                  <button
                    onClick={onExplain}
                    className="px-7 py-3 rounded-xl text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95"
                  >
                    Generate Insights
                  </button>
                </div>
              )}

              {explanationState.status === "loading" && (
                <div className="flex flex-col items-center gap-5 text-muted-foreground py-10">
                  <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
                    <Loader2 size={40} className="animate-spin text-primary relative z-10" />
                  </div>
                  <p className="animate-pulse font-medium text-foreground text-base">
                    Analyzing graph patterns...
                  </p>
                </div>
              )}

              {explanationState.status === "error" && (
                <div className="flex flex-col items-center text-center text-destructive py-10">
                  <AlertCircle size={40} className="mb-4 opacity-80" />
                  <p className="font-medium">{explanationState.error}</p>
                </div>
              )}

              {explanationState.status === "success" && explanationState.explanation && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-sm text-foreground/90 leading-relaxed prose dark:prose-invert prose-sm max-w-none
                    prose-headings:text-foreground
                    prose-h3:text-base prose-h3:font-bold prose-h3:mt-6 prose-h3:mb-2
                    prose-p:mb-4 prose-li:mb-1.5
                    prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1.5 prose-code:py-0.5
                    prose-code:rounded-md prose-code:text-[13px] prose-code:font-mono
                    prose-code:before:content-none prose-code:after:content-none
                    prose-strong:text-foreground prose-strong:font-bold"
                >
                  <ReactMarkdown>{explanationState.explanation}</ReactMarkdown>

                  <div className="mt-8 pt-5 border-t border-border/50 text-xs text-muted-foreground flex items-center justify-between bg-muted/30 p-3 rounded-lg">
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={12} className="text-primary" />
                      <span className="font-medium">CodeKavi AI</span>
                    </div>
                    <span className="font-mono bg-background px-2 py-1 rounded border border-border">
                      {explanationState.tokensUsed} tokens
                    </span>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function renderVisualization(type: VizType, data: any) {
  if (!data) return null;

  switch (type) {
    case "dependencies":
      return <DependencyGraph nodes={data.nodes || []} edges={data.edges || []} />;
    case "architecture":
      return <ArchitectureGraph nodes={data.nodes || []} edges={data.edges || []} />;
    case "dataflow":
      return <DataFlowGraph nodes={data.nodes || []} edges={data.edges || []} />;
    case "complexity":
      return <TreemapViz data={data} />;
    case "mindmap":
      return <RadialMindmap root={data.root || data} />;
    default:
      return <p className="text-muted-foreground text-center py-12">Unknown visualization type: {type}</p>;
  }
}
