"use client";

/**
 * AnalysisProgress — the full-screen wait.
 *
 * Framer Motion is deliberately absent here. This screen animates while the
 * main thread is busy parsing an SSE stream and mounting the next route; JS
 * animation drops frames under exactly that load, so the bar is a CSS
 * transform transition (compositor-only, interruptible, retargets smoothly as
 * each progress event lands) and the stage list is plain state.
 */

import { useState, useEffect, useCallback } from "react";
import {
  GitBranch,
  FolderSearch,
  Network,
  Tags,
  Share2,
  FileSearch,
  Database,
  Check,
  AlertCircle,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  analyzeRepoStream,
  type AnalysisProgressEvent,
  type AnalyzeResponse,
} from "@/lib/api";

interface AnalysisProgressProps {
  repoUrl: string;
  onComplete: (data: AnalyzeResponse) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

// All analysis stages in order
const STAGES = [
  { key: "cloning", label: "Cloning repository", icon: GitBranch },
  { key: "traversing", label: "Scanning file structure", icon: FolderSearch },
  { key: "analyzing", label: "Analyzing dependencies", icon: Network },
  { key: "classifying", label: "Classifying file roles", icon: Tags },
  { key: "graphing", label: "Building graphs", icon: Share2 },
  { key: "selecting", label: "Selecting key files", icon: FileSearch },
  { key: "indexing", label: "Creating embeddings", icon: Database },
  { key: "complete", label: "Analysis complete", icon: Check },
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
  const [completedStages, setCompletedStages] = useState<Set<string>>(
    new Set(),
  );
  const [startTime] = useState(() => Date.now());
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
        for (let i = 0; i < stageIndex; i++) next.add(STAGES[i].key);
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

        setCompletedStages(new Set(STAGES.map((s) => s.key)));
        setProgress(100);
        setCurrentStage("complete");
        setMessage("Analysis complete");

        // Brief delay to show the completed state before navigating
        setTimeout(() => {
          if (!cancelled) onComplete(data);
        }, 700);
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Analysis failed";
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
    return mins > 0 ? `${mins}m ${String(secs).padStart(2, "0")}s` : `${secs}s`;
  };

  // Extract repo name from URL for display
  const repoName = repoUrl
    .replace(/https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");

  return (
    <div className="canvas fixed inset-0 z-[100] grid place-items-center overflow-y-auto p-6">
      <div className="w-full max-w-md animate-rise">
        {!error && (
          <button
            onClick={onCancel}
            className="press mb-6 flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
          >
            <ArrowLeft size={13} />
            Cancel
          </button>
        )}

        <p className="eyebrow">{error ? "Failed" : "Analyzing"}</p>
        <h1 className="mt-2 truncate font-mono text-xl tracking-[-0.01em]">
          {repoName}
        </h1>

        {/* Progress rule — scaleX so the browser never touches layout. */}
        <div className="mt-6 h-[3px] overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full origin-left rounded-full transition-transform duration-500 ease-out",
              error ? "bg-destructive" : "bg-signal",
            )}
            style={{ transform: `scaleX(${Math.max(progress, 2) / 100})` }}
          />
        </div>

        <div className="mt-2 flex items-baseline justify-between font-mono text-[11px] text-muted-foreground">
          <span className="tnum">{progress}%</span>
          <span className="tnum">{formatTime(elapsed)}</span>
        </div>

        {/* Stage transcript */}
        <ul className="mt-7 space-y-px">
          {STAGES.map((stage) => {
            const isCompleted = completedStages.has(stage.key);
            const isCurrent = currentStage === stage.key && !error;
            const Icon = stage.icon;

            return (
              <li
                key={stage.key}
                className={cn(
                  "flex items-center gap-3 rounded-md px-2.5 py-2",
                  "transition-colors duration-200 ease-out",
                  isCurrent && "bg-accent/60",
                )}
              >
                <span className="grid h-4 w-4 flex-shrink-0 place-items-center">
                  {isCompleted ? (
                    <Check size={13} className="text-signal" strokeWidth={2.5} />
                  ) : isCurrent ? (
                    <Loader2
                      size={13}
                      className="animate-spin text-foreground"
                    />
                  ) : (
                    <Icon size={13} className="text-muted-foreground/40" />
                  )}
                </span>

                <span
                  className={cn(
                    "text-[13px]",
                    isCurrent
                      ? "text-foreground"
                      : isCompleted
                        ? "text-muted-foreground"
                        : "text-muted-foreground/40",
                  )}
                >
                  {stage.label}
                </span>

                {isCurrent && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-signal animate-blink" />
                )}
              </li>
            );
          })}
        </ul>

        {!error && (
          <p className="mt-6 truncate text-center text-[12px] text-muted-foreground">
            {message}
          </p>
        )}

        {error && (
          <div className="mt-7 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-4">
            <p className="flex items-center gap-2 text-[13px] font-medium text-destructive">
              <AlertCircle size={14} />
              Analysis failed
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              {error}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={onCancel}
                className="press rounded-md border border-border bg-card px-3 py-1.5 text-[13px] transition-colors duration-150 ease-out hover:bg-accent"
              >
                Go back
              </button>
              <button
                onClick={() => window.location.reload()}
                className="press rounded-md bg-foreground px-3 py-1.5 text-[13px] text-background transition-colors duration-150 ease-out hover:bg-foreground/88"
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
