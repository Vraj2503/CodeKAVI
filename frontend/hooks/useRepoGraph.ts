"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchRepoGraph, type RepoGraphPayload } from "@/lib/api";
import { describeFailure, isAbort, type HumanFailure } from "@/lib/errors";

export type RepoGraphStatus = "loading" | "polling" | "success" | "error";

export interface RepoGraphState {
  status: RepoGraphStatus;
  data: RepoGraphPayload | null;
  /**
   * Classified failure (T18/QA-003). This used to be the backend's own string,
   * which is how the Graph page came to render `Missing Authorization header.`
   * as its entire UI, in red, with no sign-in prompt and no retry.
   */
  failure: HumanFailure | null;
  /** Increment to force a re-fetch; see `retry`. */
  retry: () => void;
}

const INITIAL: Omit<RepoGraphState, "retry"> = {
  status: "loading",
  data: null,
  failure: null,
};

// Backoff while the repo is re-analyzing. Capped, not exponential-forever,
// so a slow analysis still gets polled roughly every 30s.
const POLL_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];

/** Fetch + poll the Phase 1 semantic graph. 202 (re-analyzing) is never an error. */
export function useRepoGraph(repoId: string): RepoGraphState {
  const [state, setState] = useState(INITIAL);
  const [trackedRepoId, setTrackedRepoId] = useState(repoId);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const loadRef = useRef<() => void>(() => {});

  // Reset visible state synchronously when repoId changes, before the effect
  // below re-fetches — the React-recommended way to adjust state on a prop
  // change without an extra render flicker of stale data.
  if (repoId !== trackedRepoId) {
    setTrackedRepoId(repoId);
    setState(INITIAL);
  }

  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    fetchRepoGraph(repoId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;

        if (result.status === "re-analyzing") {
          const delay =
            POLL_DELAYS_MS[
              Math.min(attemptRef.current, POLL_DELAYS_MS.length - 1)
            ];
          attemptRef.current += 1;
          setState({ status: "polling", data: null, failure: null });
          timeoutRef.current = setTimeout(() => loadRef.current(), delay);
          return;
        }

        attemptRef.current = 0;
        setState({ status: "success", data: result.data, failure: null });
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return;
        const failure = describeFailure(err, "this graph");
        console.warn("Semantic graph failed:", failure.detail);
        setState({ status: "error", data: null, failure });
      });
  }, [repoId]);

  useEffect(() => {
    attemptRef.current = 0;
    loadRef.current = load;
    load();

    return () => {
      abortRef.current?.abort();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [load]);

  /** Re-run from scratch. The error screen's "Try again" needs somewhere to go. */
  const retry = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    attemptRef.current = 0;
    setState(INITIAL);
    loadRef.current();
  }, []);

  return { ...state, retry };
}
