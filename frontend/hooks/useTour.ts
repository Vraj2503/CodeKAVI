"use client";

import { useEffect, useRef, useState } from "react";
import { fetchTour, type TourMode, type TourStep } from "@/lib/api";

export type TourStatus = "loading" | "success" | "error";

export interface TourState {
  status: TourStatus;
  steps: TourStep[];
  error: string | null;
  /** H4: deleted-file count, only set by the diff tour. */
  deletedCount: number | null;
}

const INITIAL_STATE: TourState = {
  status: "loading",
  steps: [],
  error: null,
  deletedCount: null,
};

/** Fetch E5/H3's tour for the given mode. Re-fetches whenever repoId or mode changes. */
export function useTour(repoId: string, mode: TourMode): TourState {
  const [state, setState] = useState<TourState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  // Reset visible state synchronously when repoId/mode changes, before the
  // effect below re-fetches — same render-time reset useRepoGraph uses.
  const [tracked, setTracked] = useState({ repoId, mode });
  if (tracked.repoId !== repoId || tracked.mode !== mode) {
    setTracked({ repoId, mode });
    setState(INITIAL_STATE);
  }

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetchTour(repoId, mode, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setState({
          status: "success",
          steps: data.steps,
          error: null,
          deletedCount: data.deleted_count ?? null,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          status: "error",
          steps: [],
          error: err instanceof Error ? err.message : "Failed to load tour",
          deletedCount: null,
        });
      });

    return () => controller.abort();
  }, [repoId, mode]);

  return state;
}
