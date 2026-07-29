import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchTourNodeNarration,
  type TourMode,
  type TourStep,
} from "@/lib/api";
import type { TourStatus } from "@/hooks/useTour";
import { useTourProgress } from "@/hooks/useTourProgress";
import { questionKey, stepKey } from "@/lib/graph/tourProgress";

export interface TourPanelProps {
  repoId: string;
  mode: TourMode;
  onModeChange: (mode: TourMode) => void;
  status: TourStatus;
  steps: TourStep[];
  error: string | null;
  onClose: () => void;
  /** Fired whenever the visibly-current step changes (mount, mode switch, next/prev). */
  onStepChange?: (step: TourStep) => void;
  /** H4: diff-tour-only — files removed since last analysis, rendered as a banner. */
  deletedCount?: number | null;
  /** G3: question-driven tour, layered over the mode tabs — null when inactive. */
  activeQuestion?: string | null;
  onAskQuestion?: (question: string) => void;
  onClearQuestion?: () => void;
}

const MODES: { value: TourMode; label: string }[] = [
  { value: "learn", label: "Learn" },
  { value: "recall", label: "Recall" },
  { value: "diff", label: "What changed" },
];

/** E6: stepper panel over the E5 tour endpoint. Ordering/prose come from the
 * backend; this component only tracks "which step is current" and renders it. */
export function TourPanel({
  repoId,
  mode,
  onModeChange,
  status,
  steps,
  error,
  onClose,
  onStepChange,
  deletedCount,
  activeQuestion,
  onAskQuestion,
  onClearQuestion,
}: TourPanelProps) {
  const [index, setIndex] = useState(0);
  const [questionInput, setQuestionInput] = useState("");
  const { progress, markSeen, toggleAnswerable } = useTourProgress(repoId);

  const narrationCache = useRef(new Map<string, string | null>());
  const [narration, setNarration] = useState<string | null>(null);
  const [narrationLoading, setNarrationLoading] = useState(false);

  // Reset to the first step whenever a new step list arrives (mode switch) —
  // the React-recommended render-time reset instead of an extra effect.
  const [trackedSteps, setTrackedSteps] = useState(steps);
  if (steps !== trackedSteps) {
    setTrackedSteps(steps);
    setIndex(0);
  }

  const step = steps[index] ?? null;

  useEffect(() => {
    if (step) {
      onStepChange?.(step);
      markSeen(stepKey(step));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // A3: on-demand LLM narration for the step's node, cached per node id so
  // Prev/Next (and Recall's jumps) don't refetch on repeat visits.
  useEffect(() => {
    const nodeId = step?.node_ids[0];
    if (!nodeId) {
      setNarration(null);
      setNarrationLoading(false);
      return;
    }

    const cached = narrationCache.current.get(nodeId);
    if (cached !== undefined) {
      setNarration(cached);
      setNarrationLoading(false);
      return;
    }

    const controller = new AbortController();
    setNarration(null);
    setNarrationLoading(true);
    fetchTourNodeNarration(repoId, nodeId, controller.signal)
      .then(({ narration: result }) => {
        narrationCache.current.set(nodeId, result);
        setNarration(result);
        setNarrationLoading(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        narrationCache.current.set(nodeId, null);
        setNarration(null);
        setNarrationLoading(false);
      });

    return () => controller.abort();
  }, [step, repoId]);

  // ←/→ (and Space to advance) step through the tour; secondary affordance
  // even in Recall's jumpable list. Ignored while typing in the question box.
  useEffect(() => {
    if (!step) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setIndex((i) => Math.min(steps.length - 1, i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, steps.length]);

  return (
    <aside
      aria-label="architecture tour"
      className="pointer-events-auto flex h-full w-full flex-col gap-3 overflow-y-auto border-l bg-card p-3 font-mono text-xs shadow-lg"
    >
      <div className="flex items-center justify-between gap-2">
        <div role="group" aria-label="tour mode" className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={mode === m.value}
              onClick={() => onModeChange(m.value)}
              className={cn(
                "rounded-full border px-2 py-1 text-muted-foreground transition-colors hover:text-foreground",
                mode === m.value &&
                  "border-[hsl(var(--viz-highlight))] text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close tour"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {onAskQuestion &&
        (activeQuestion ? (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2 py-1">
            <span className="truncate text-muted-foreground">
              Results for &ldquo;{activeQuestion}&rdquo;
            </span>
            <button
              type="button"
              onClick={() => {
                setQuestionInput("");
                onClearQuestion?.();
              }}
              aria-label="back to tour"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const q = questionInput.trim();
              if (q) onAskQuestion(q);
            }}
          >
            <input
              type="text"
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              placeholder="Ask a question about this repo…"
              className="w-full rounded-full border bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-[hsl(var(--viz-highlight))]"
            />
            <button
              type="submit"
              disabled={!questionInput.trim()}
              aria-label="ask"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </form>
        ))}

      {mode === "diff" && !activeQuestion && !!deletedCount && (
        <p className="rounded-md border border-destructive/20 bg-destructive/10 px-2 py-1 text-destructive">
          {deletedCount} file{deletedCount === 1 ? "" : "s"} deleted since last
          analysis
        </p>
      )}

      {status === "loading" && (
        <p className="text-muted-foreground">Loading tour…</p>
      )}
      {status === "error" && (
        <p className="text-destructive">{error ?? "Failed to load tour"}</p>
      )}
      {status === "success" && !step && (
        <p className="text-muted-foreground">No files to tour.</p>
      )}

      {step && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{step.title}</span>
            <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
              <div className="h-1 w-12 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[hsl(var(--viz-highlight))] transition-all"
                  style={{ width: `${((index + 1) / steps.length) * 100}%` }}
                />
              </div>
              <span>
                {index + 1} / {steps.length}
              </span>
            </div>
          </div>

          {narrationLoading ? (
            <p className="text-muted-foreground">Generating…</p>
          ) : narration ? (
            <p className="text-muted-foreground">{narration}</p>
          ) : (
            step.facts.length > 0 && (
              <ul className="flex flex-col gap-1 text-muted-foreground">
                {step.facts.map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
            )
          )}

          {step.questions.length > 0 && (
            <ul className="flex flex-col gap-1 border-t pt-2 text-foreground">
              {step.questions.map((question, i) => {
                const key = questionKey(step, i);
                const answerable = progress.answerableQuestions.includes(key);
                return (
                  <li key={i}>
                    <button
                      type="button"
                      aria-pressed={answerable}
                      onClick={() => toggleAnswerable(key)}
                      className="flex w-full items-start gap-1.5 text-left transition-colors hover:text-foreground"
                    >
                      <Check
                        className={cn(
                          "mt-0.5 h-3 w-3 shrink-0",
                          answerable
                            ? "text-[hsl(var(--viz-highlight))]"
                            : "text-muted-foreground/30",
                        )}
                      />
                      <span
                        className={cn(!answerable && "text-muted-foreground")}
                      >
                        {question}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {mode === "recall" ? (
            <ul className="flex max-h-32 flex-col gap-0.5 overflow-y-auto border-t pt-2">
              {steps.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-current={i === index}
                    className={cn(
                      "w-full truncate rounded px-2 py-1 text-left transition-colors hover:text-foreground",
                      i === index
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {s.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                className="flex items-center gap-1 rounded-full border px-2 py-1 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" />
                Prev
              </button>
              <button
                type="button"
                onClick={() =>
                  setIndex((i) => Math.min(steps.length - 1, i + 1))
                }
                disabled={index === steps.length - 1}
                className="flex items-center gap-1 rounded-full border px-2 py-1 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
