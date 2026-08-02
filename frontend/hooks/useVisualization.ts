"use client";

import { useState, useCallback, useRef } from "react";
import { fetchVisualization, type VizType, type VizResponse } from "@/lib/api";
import { describeFailure, isAbort, type HumanFailure } from "@/lib/errors";

export type VizStatus = "idle" | "loading" | "success" | "error";

export interface VizState {
  status: VizStatus;
  data: VizResponse | null;
  /** Classified failure. Never a raw backend string — see `lib/errors.ts`. */
  failure: HumanFailure | null;
  /** Still loading, but past `SLOW_MS`. Lets the UI stop pretending it's fast. */
  slow: boolean;
}

const INITIAL_STATE: VizState = {
  status: "idle",
  data: null,
  failure: null,
  slow: false,
};

/**
 * Hard deadline on a visualization request.
 *
 * There was none: a backend that accepted the socket and never answered left
 * the spinner turning forever, with no error, no retry and no way out but a
 * reload. 45s is generous — the architecture and complexity endpoints parse
 * the whole repo — but finite.
 */
const REQUEST_TIMEOUT_MS = 45_000;

/** When to admit it's slow. Long enough that a healthy request never trips it. */
const SLOW_MS = 12_000;

/**
 * Cache key.
 *
 * Scoping by repo is what invalidates the cache across a re-analysis, which
 * mints a fresh repo id. It also makes a late response from the previous repo
 * harmless: it lands under a key nothing reads, instead of repainting the new
 * repo's panel with the old repo's chart. That is why there is no
 * abort-on-repo-change — correctness does not depend on winning that race, and
 * the stray request expires on its own deadline.
 */
const keyOf = (repoId: string, type: VizType) => `${repoId}::${type}`;

/**
 * On-demand visualization generation with an in-memory cache.
 *
 * Non-forced `generate` acts **only on an idle entry**. That is what lets the
 * panel call it from an effect on every render without looping: a success, an
 * in-flight request, and a failure all return immediately. Re-running a failed
 * chart is a deliberate act, so it goes through `generate(type, true)`.
 */
export function useVisualization(repoId: string) {
  const [cache, setCache] = useState<Map<string, VizState>>(new Map());
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  const patch = useCallback((key: string, next: VizState) => {
    setCache((prev) => {
      const map = new Map(prev);
      map.set(key, next);
      return map;
    });
  }, []);

  const generate = useCallback(
    async (type: VizType, forceRefresh = false) => {
      const key = keyOf(repoId, type);
      const existing = cache.get(key) ?? INITIAL_STATE;
      if (!forceRefresh && existing.status !== "idle") return;

      abortRefs.current.get(key)?.abort();

      const controller = new AbortController();
      abortRefs.current.set(key, controller);

      const deadline = setTimeout(
        () =>
          controller.abort(
            new DOMException("Visualization request timed out", "TimeoutError"),
          ),
        REQUEST_TIMEOUT_MS,
      );
      const slowTimer = setTimeout(() => {
        setCache((prev) => {
          const current = prev.get(key);
          if (current?.status !== "loading") return prev;
          const map = new Map(prev);
          map.set(key, { ...current, slow: true });
          return map;
        });
      }, SLOW_MS);

      patch(key, { status: "loading", data: null, failure: null, slow: false });

      try {
        const data = await fetchVisualization(
          repoId,
          type,
          false,
          controller.signal,
        );
        patch(key, { status: "success", data, failure: null, slow: false });
      } catch (err: unknown) {
        // A plain abort is a cancellation we asked for. A *timeout* abort is a
        // real failure, which is why the two are told apart rather than both
        // being swallowed as "aborted".
        if (isAbort(err)) return;

        const failure = describeFailure(err, "this visualization");
        console.warn(`Visualization "${type}" failed:`, failure.detail);
        patch(key, { status: "error", data: null, failure, slow: false });
      } finally {
        clearTimeout(deadline);
        clearTimeout(slowTimer);
        if (abortRefs.current.get(key) === controller) {
          abortRefs.current.delete(key);
        }
      }
    },
    [repoId, cache, patch],
  );

  const getState = useCallback(
    (type: VizType): VizState => cache.get(keyOf(repoId, type)) ?? INITIAL_STATE,
    [cache, repoId],
  );

  return { generate, getState };
}
