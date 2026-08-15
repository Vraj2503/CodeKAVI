/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, AlertCircle, Network, RefreshCw, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { VizState } from "@/hooks/useVisualization";
import type { ExplainState } from "@/hooks/useExplanation";
import type { VizType } from "@/lib/api";
import { FailureState } from "@/components/FailureState";
import { DownloadMenu } from "./DownloadMenu";

// Lazy-load D3 viz components
const DependencyGraph = dynamic(
  () =>
    import("@/components/report/viz/DependencyGraph").then(
      (m) => m.DependencyGraph,
    ),
  { ssr: false, loading: () => <VizSkeleton /> },
);
const ArchitectureGraph = dynamic(
  () =>
    import("@/components/report/viz/ArchitectureGraph").then(
      (m) => m.ArchitectureGraph,
    ),
  { ssr: false, loading: () => <VizSkeleton /> },
);
const DataFlowGraph = dynamic(
  () =>
    import("@/components/report/viz/DataFlowGraph").then(
      (m) => m.DataFlowGraph,
    ),
  { ssr: false, loading: () => <VizSkeleton /> },
);
const TreemapViz = dynamic(
  () => import("@/components/report/viz/TreemapViz").then((m) => m.TreemapViz),
  { ssr: false, loading: () => <VizSkeleton /> },
);
const RadialMindmap = dynamic(
  () =>
    import("@/components/report/viz/RadialMindmap").then(
      (m) => m.RadialMindmap,
    ),
  { ssr: false, loading: () => <VizSkeleton /> },
);
const NeuralNetworkViz = dynamic(
  () =>
    import("@/components/report/viz/NeuralNetworkViz").then(
      (m) => m.NeuralNetworkViz,
    ),
  { ssr: false, loading: () => <VizSkeleton /> },
);

function VizSkeleton() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center">
      <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
      <div className="text-muted-foreground animate-pulse">
        Rendering Visualization...
      </div>
    </div>
  );
}

/**
 * An empty chart, with somewhere to go.
 *
 * This used to be a full stop: an icon, a heading, and a sentence explaining
 * that nothing could be drawn. It never named a cause the user could act on,
 * and never pointed at the view that would have worked. `VizContainer` already
 * had the better copy — the path-alias explanation is the single most common
 * reason edges fail to resolve — so it moves here.
 */
function EmptyViz({
  type,
  label,
  unresolvedEdges,
}: {
  type: VizType;
  label: string;
  unresolvedEdges: boolean;
}) {
  // Suggest a chart that does not depend on the thing that just came back
  // empty. The treemap needs no edges at all, so it is the safe fallback when
  // the dependency graph is itself the empty one.
  const suggestion: { type: VizType; label: string } =
    type === "dependencies"
      ? { type: "complexity", label: "Complexity Treemap" }
      : { type: "dependencies", label: "Dependency Graph" };

  // The neural network view is listed for every repository, so most visitors
  // to this empty state are on a repo that simply has no model in it. Saying
  // "not enough structure" there is wrong and sounds like a failure — the
  // honest message is which frameworks we read and which we do not.
  const isNN = type === "neural_network";

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-10 text-center">
      <div className="w-20 h-20 rounded-full flex items-center justify-center bg-muted text-muted-foreground mb-6">
        {isNN ? (
          <Network size={40} aria-hidden="true" />
        ) : (
          <AlertCircle size={40} aria-hidden="true" />
        )}
      </div>
      <h3 className="text-xl font-bold text-foreground mb-3">
        {isNN
          ? "No model architecture to draw"
          : unresolvedEdges
            ? "Nothing connects, yet"
            : `No ${label.toLowerCase()} to draw`}
      </h3>
      <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
        {isNN
          ? "We didn't find a neural network in this repository. This view reads PyTorch (nn.Module, nn.Sequential), Keras and TensorFlow models, and Hugging Face transformers loaded with from_pretrained."
          : unresolvedEdges
            ? "We found the files but couldn't resolve a single import between them. That usually means the project uses path aliases (@/, ~/) we don't map yet, or imports only external packages."
            : `This repository doesn't have enough structure for a ${label.toLowerCase()}. Small projects and single-file scripts often land here.`}
      </p>
      {isNN && (
        <p className="mt-3 max-w-md text-xs leading-relaxed text-muted-foreground/80">
          Classical machine learning — scikit-learn pipelines, XGBoost, LightGBM —
          isn&apos;t drawn here yet. Neither are models built entirely at runtime from a
          config file, since there is no architecture in the source to read.
        </p>
      )}
      <Link
        href={`?type=${suggestion.type}`}
        className="mt-8 inline-flex items-center gap-2 rounded-xl border border-border bg-muted px-6 py-3 text-sm font-semibold transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Try the {suggestion.label}
      </Link>
    </div>
  );
}

interface FocusedVisualizationProps {
  type: VizType;
  config: { label: string; description: string; icon: any };
  state: VizState;
  explanationState: ExplainState;
  /**
   * True for the one chart whose endpoint calls a language model. It keeps the
   * idle card; everything else renders on arrival (T13).
   */
  costsTokens: boolean;
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
  costsTokens,
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
        {/* `flex-wrap` and a shrinkable title: at 375px the action buttons used
            to overflow the panel and get clipped by `overflow-hidden`, taking
            Download and AI Insights off the screen entirely. */}
        <div className="absolute top-4 left-4 right-4 flex flex-wrap items-start justify-between gap-2 z-20 pointer-events-none">
          {/* Left: title pill */}
          <div className="flex min-w-0 items-center gap-2 bg-background/90 backdrop-blur-md px-4 py-2.5 rounded-xl border border-border shadow-sm pointer-events-auto">
            <Icon size={20} className="text-primary shrink-0" />
            <h2 className="text-sm font-bold text-foreground truncate">
              {config.label}
            </h2>
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
                aria-label="AI Insights"
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl backdrop-blur-md border shadow-sm transition-all duration-200 ${
                  isExplanationOpen
                    ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/20"
                    : "bg-background/90 border-border text-foreground hover:bg-muted"
                }`}
              >
                <Sparkles size={18} />
                {/* Label drops below `sm`; the icon plus `aria-label` still
                    names the control where there is no room for both. */}
                <span className="hidden text-sm font-semibold sm:inline">
                  AI Insights
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Visualization canvas — fills the graph section, padded top so bars don't overlay nodes */}
        {/* The action bar floats over this. It wraps to two rows below `sm`,
            so the reserved top padding has to grow with it or the bar sits on
            the chart. */}
        <div className="w-full h-full flex items-center justify-center bg-muted/10 pt-28 sm:pt-16">
          <AnimatePresence mode="wait">
            {/*
              T13: five of the six charts cost nothing but a parse, and they
              now render on arrival — the click that used to gate them bought
              the user nothing at exactly the moment the product is trying to
              impress. This card survives only for the one chart that does
              spend tokens, and it now says so instead of asking permission
              for a reason it never gave.
            */}
            {state.status === "idle" && costsTokens && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex flex-col items-center max-w-md text-center p-10 bg-card rounded-3xl border border-border/50 shadow-2xl"
              >
                <Icon size={40} className="text-primary mb-6" />
                <h2 className="text-2xl font-bold text-foreground mb-3">
                  {config.label}
                </h2>
                <p className="text-muted-foreground mb-3 leading-relaxed text-sm">
                  {config.description}
                </p>
                <p className="text-muted-foreground/80 mb-8 text-xs leading-relaxed">
                  This is the one view that calls a language model, so it runs
                  only when you ask. The result is cached afterwards.
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

            {/* Auto-rendering types skip idle entirely — showing a card for the
                ~200ms before generate() lands would be a flash of a control the
                user never needs to touch. */}
            {state.status === "idle" && !costsTokens && (
              <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <VizSkeleton />
              </motion.div>
            )}

            {state.status === "loading" && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-5 text-center"
              >
                <Loader2 size={48} className="animate-spin text-primary" />
                <p className="text-foreground font-medium animate-pulse text-lg">
                  Building the {config.label.toLowerCase()}…
                </p>
                {/* Past 12s. Saying nothing here is what makes a slow request
                    feel identical to a hung one. */}
                {state.slow && (
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Taking longer than usual — large repositories are parsed in
                    full. We&apos;ll stop waiting after 45 seconds.
                  </p>
                )}
              </motion.div>
            )}

            {state.status === "error" && state.failure && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full h-full"
              >
                <FailureState failure={state.failure} onRetry={onRefresh} />
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
                {isEmptyVisualization(type, state.data.data) ? (
                  <EmptyViz
                    type={type}
                    label={config.label}
                    unresolvedEdges={hasUnresolvedEdges(type, state.data.data)}
                  />
                ) : (
                  <>
                    <DiagnosticsBanner
                      diagnostics={(state.data.data as any)?.diagnostics}
                    />
                    {renderVisualization(type, state.data.data)}
                  </>
                )}
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
                <h3 className="font-bold text-foreground text-base">
                  AI Insights
                </h3>
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
                  <h4 className="text-foreground font-semibold text-lg mb-2">
                    Ready to Analyze
                  </h4>
                  <p className="text-sm mb-8 max-w-sm leading-relaxed">
                    Generate AI-powered insights to understand the patterns and
                    architecture hidden in this visualization.
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
                    <Loader2
                      size={40}
                      className="animate-spin text-primary relative z-10"
                    />
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

              {explanationState.status === "success" &&
                explanationState.explanation && (
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
                    <ReactMarkdown>
                      {explanationState.explanation}
                    </ReactMarkdown>

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
      return (
        <DependencyGraph
          nodes={data.nodes || []}
          edges={data.edges || []}
          moduleGraph={data.module_graph}
          modules={data.modules}
        />
      );
    case "architecture":
      return (
        <ArchitectureGraph nodes={data.nodes || []} edges={data.edges || []} />
      );
    case "dataflow":
      return (
        <DataFlowGraph nodes={data.nodes || []} edges={data.edges || []} />
      );
    case "complexity":
      return <TreemapViz data={data} />;
    case "mindmap":
      return <RadialMindmap root={data.root || data} />;
    case "neural_network":
      return <NeuralNetworkViz data={data} />;
    default:
      return (
        <p className="text-muted-foreground text-center py-12">
          Unknown visualization type: {type}
        </p>
      );
  }
}

function DiagnosticsBanner({ diagnostics }: { diagnostics: any }) {
  if (!diagnostics) return null;
  const { resolution_rate, unsupported_languages } = diagnostics;
  const incomplete = resolution_rate < 1 || unsupported_languages?.length > 0;
  if (!incomplete) return null;
  const pct = Math.round((resolution_rate ?? 1) * 100);
  return (
    <div className="absolute top-20 left-4 right-4 z-10 text-xs text-muted-foreground bg-background/90 backdrop-blur-md border border-dashed border-border rounded-lg px-3 py-2 pointer-events-none">
      {pct}% of imports resolved.
      {unsupported_languages?.length > 0 &&
        ` Unsupported languages detected: ${unsupported_languages.join(", ")}.`}
    </div>
  );
}

function hasUnresolvedEdges(type: VizType, data: any) {
  switch (type) {
    case "dependencies":
    case "architecture":
    case "dataflow":
      return !!data?.nodes?.length && !data?.edges?.length;
    default:
      return false;
  }
}

function isEmptyVisualization(type: VizType, data: any) {
  if (!data) return true;
  switch (type) {
    case "dependencies":
    case "architecture":
    case "dataflow":
      return (
        !data.nodes || data.nodes.length === 0 || hasUnresolvedEdges(type, data)
      );
    case "complexity":
      return !data.children || data.children.length === 0;
    case "mindmap":
      return (
        !data.root || !data.root.children || data.root.children.length === 0
      );
    case "neural_network":
      return !data.models || data.models.length === 0;
    default:
      return false;
  }
}
