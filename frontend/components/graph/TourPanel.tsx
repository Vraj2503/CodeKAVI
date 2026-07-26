import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TourMode, TourStep } from "@/lib/api";
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
}

const MODES: { value: TourMode; label: string }[] = [
  { value: "learn", label: "Learn" },
  { value: "recall", label: "Recall" },
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
}: TourPanelProps) {
  const [index, setIndex] = useState(0);
  const { progress, markSeen, toggleAnswerable } = useTourProgress(repoId);

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

  return (
    <aside
      aria-label="architecture tour"
      className="pointer-events-auto flex w-full max-w-xl flex-col gap-3 rounded-lg border bg-card p-3 font-mono text-xs shadow-lg"
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
            <span className="shrink-0 text-muted-foreground">
              {index + 1} / {steps.length}
            </span>
          </div>

          {step.facts.length > 0 && (
            <ul className="flex flex-col gap-1 text-muted-foreground">
              {step.facts.map((fact, i) => (
                <li key={i}>{fact}</li>
              ))}
            </ul>
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
              onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}
              disabled={index === steps.length - 1}
              className="flex items-center gap-1 rounded-full border px-2 py-1 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
