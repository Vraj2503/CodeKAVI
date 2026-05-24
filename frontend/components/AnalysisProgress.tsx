"use client";

/**
 * AnalysisProgress — Full-screen progress component with staged timeline.
 *
 * Shows a premium animated progress bar with a vertical stepper timeline
 * for each analysis stage. Replaces the old instant-navigate behaviour.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch,
  FolderSearch,
  Network,
  Tags,
  Share2,
  FileSearch,
  Database,
  CheckCircle,
  AlertCircle,
  Loader2,
  ArrowLeft,
} from "lucide-react";
import { analyzeRepoStream, type AnalysisProgressEvent, type AnalyzeResponse } from "@/lib/api";
import { createSession } from "@/lib/sessions";

interface AnalysisProgressProps {
  repoUrl: string;
  onComplete: (data: AnalyzeResponse) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

// All analysis stages in order
const STAGES = [
  { key: "cloning",     label: "Cloning Repository",      icon: GitBranch,   color: "#58a6ff" },
  { key: "traversing",  label: "Scanning File Structure",  icon: FolderSearch, color: "#4ecdc4" },
  { key: "analyzing",   label: "Analyzing Dependencies",   icon: Network,     color: "#a78bfa" },
  { key: "classifying", label: "Classifying File Roles",   icon: Tags,        color: "#3fb950" },
  { key: "graphing",    label: "Building Graphs",          icon: Share2,      color: "#f0883e" },
  { key: "selecting",   label: "Selecting Key Files",      icon: FileSearch,  color: "#ec4899" },
  { key: "indexing",    label: "Creating Embeddings",      icon: Database,    color: "#fbbf24" },
  { key: "complete",    label: "Analysis Complete",        icon: CheckCircle, color: "#22c55e" },
];

export function AnalysisProgress({
  repoUrl,
  onComplete,
  onError,
  onCancel,
}: AnalysisProgressProps) {
  const [currentStage, setCurrentStage] = useState("cloning");
  const [progress, setProgress] = useState(5);
  const [message, setMessage] = useState("Preparing analysis…");
  const [error, setError] = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);

  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const handleProgress = useCallback((event: AnalysisProgressEvent) => {
    setCurrentStage(event.stage);
    setProgress(event.progress);
    setMessage(event.message);

    // Mark previous stages as completed
    const stageIndex = STAGES.findIndex((s) => s.key === event.stage);
    if (stageIndex >= 0) {
      setCompletedStages((prev) => {
        const next = new Set(prev);
        for (let i = 0; i < stageIndex; i++) {
          next.add(STAGES[i].key);
        }
        return next;
      });
    }
  }, []);

  // Start the analysis stream
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await analyzeRepoStream(repoUrl, (event) => {
          if (cancelled) return;
          handleProgress(event);
        });

        if (cancelled) return;

        // Mark all stages complete
        setCompletedStages(new Set(STAGES.map((s) => s.key)));
        setProgress(100);
        setCurrentStage("complete");
        setMessage("Analysis complete!");

        // Brief delay to show the completed state before navigating
        setTimeout(() => {
          if (!cancelled) onComplete(data);
        }, 800);
      } catch (err: any) {
        if (cancelled) return;
        const msg = err.message || "Analysis failed";
        setError(msg);
        onError(msg);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl]);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  // Extract repo name from URL for display
  const repoName = repoUrl
    .replace(/https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background"
    >
      {/* Subtle animated background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl animate-pulse" />
        <div className="absolute top-1/3 right-1/4 w-[300px] h-[300px] rounded-full bg-ring/5 blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-lg mx-4"
      >
        {/* Back button */}
        {!error && (
          <button
            onClick={onCancel}
            className="absolute -top-12 left-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft size={14} />
            Cancel
          </button>
        )}

        {/* Card */}
        <div className="bg-card/60 backdrop-blur-2xl border border-border/40 rounded-2xl shadow-2xl p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h2 className="text-lg font-bold text-foreground mb-1">
              Analyzing Repository
            </h2>
            <p className="text-sm text-muted-foreground font-mono">
              {repoName}
            </p>
          </div>

          {/* Progress bar */}
          <div className="relative h-2 bg-muted rounded-full overflow-hidden mb-2">
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                background: error
                  ? "#ef4444"
                  : "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--ring)))",
              }}
              initial={{ width: "0%" }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
            {/* Shimmer overlay */}
            {!error && progress < 100 && (
              <div
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer"
                style={{
                  width: "50%",
                  animation: "shimmer 1.5s infinite",
                }}
              />
            )}
          </div>

          <div className="flex items-center justify-between mb-8">
            <span className="text-xs text-muted-foreground">{progress}%</span>
            <span className="text-xs text-muted-foreground">{formatTime(elapsed)}</span>
          </div>

          {/* Stage timeline */}
          <div className="space-y-1">
            {STAGES.map((stage, i) => {
              const isCompleted = completedStages.has(stage.key);
              const isCurrent = currentStage === stage.key && !error;
              const isPending = !isCompleted && !isCurrent;
              const Icon = stage.icon;

              return (
                <motion.div
                  key={stage.key}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-300 ${
                    isCurrent
                      ? "bg-primary/10 border border-primary/20"
                      : isCompleted
                        ? "opacity-70"
                        : "opacity-30"
                  }`}
                >
                  {/* Icon / status indicator */}
                  <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                    {isCompleted ? (
                      <CheckCircle size={16} className="text-green-500" />
                    ) : isCurrent ? (
                      <Loader2 size={16} className="text-primary animate-spin" />
                    ) : (
                      <Icon size={16} className="text-muted-foreground" />
                    )}
                  </div>

                  {/* Label */}
                  <span
                    className={`text-sm font-medium ${
                      isCurrent
                        ? "text-foreground"
                        : isCompleted
                          ? "text-muted-foreground"
                          : "text-muted-foreground/50"
                    }`}
                  >
                    {stage.label}
                  </span>

                  {/* Status dot */}
                  {isCurrent && (
                    <div className="ml-auto w-2 h-2 rounded-full bg-primary animate-pulse" />
                  )}
                </motion.div>
              );
            })}
          </div>

          {/* Current message */}
          <AnimatePresence mode="wait">
            <motion.p
              key={message}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              className="text-center text-sm text-muted-foreground mt-6"
            >
              {error ? "" : message}
            </motion.p>
          </AnimatePresence>

          {/* Error state */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 text-center"
            >
              <div className="flex items-center justify-center gap-2 text-destructive mb-3">
                <AlertCircle size={16} />
                <span className="text-sm font-medium">Analysis Failed</span>
              </div>
              <p className="text-xs text-muted-foreground mb-4 bg-destructive/10 rounded-lg px-3 py-2 border border-destructive/20">
                {error}
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground bg-muted rounded-lg transition-colors"
                >
                  Go Back
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors"
                >
                  Try Again
                </button>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* Shimmer keyframes */}
      <style jsx global>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </motion.div>
  );
}
