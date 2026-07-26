"use client";

import { useEffect, useRef, useState } from "react";
import { fetchQuestionTour, type TourStep } from "@/lib/api";
import type { TourStatus } from "./useTour";

export interface QuestionTourState {
  status: TourStatus;
  steps: TourStep[];
  error: string | null;
}

const INITIAL_STATE: QuestionTourState = {
  status: "loading",
  steps: [],
  error: null,
};

/** G3: question-driven tour. Fetches only when `question` is non-null —
 * set on explicit submit (not on every keystroke), since this is the one
 * tour endpoint that costs tokens. */
export function useQuestionTour(
  repoId: string,
  question: string | null,
): QuestionTourState {
  const [state, setState] = useState<QuestionTourState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const [tracked, setTracked] = useState({ repoId, question });
  if (tracked.repoId !== repoId || tracked.question !== question) {
    setTracked({ repoId, question });
    setState(INITIAL_STATE);
  }

  useEffect(() => {
    abortRef.current?.abort();
    if (!question) return;

    const controller = new AbortController();
    abortRef.current = controller;

    fetchQuestionTour(repoId, question, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({ status: "success", steps: data.steps, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          status: "error",
          steps: [],
          error: err instanceof Error ? err.message : "Failed to load tour",
        });
      });

    return () => controller.abort();
  }, [repoId, question]);

  return state;
}
