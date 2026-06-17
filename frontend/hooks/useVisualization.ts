"use client";

import { useState, useCallback, useRef } from "react";
import { fetchVisualization, type VizType, type VizResponse } from "@/lib/api";

export type VizStatus = "idle" | "loading" | "success" | "error";

export interface VizState {
  status: VizStatus;
  data: VizResponse | null;
  error: string | null;
}

const INITIAL_STATE: VizState = { status: "idle", data: null, error: null };

/**
 * Hook for on-demand visualization generation with client-side caching.
 *
 * - Does NOT auto-fetch on mount (on-demand only)
 * - Caches results in-memory (no refetch unless explicitly reset)
 * - Tracks loading/error state per visualization type
 */
export function useVisualization(repoId: string) {
  const [cache, setCache] = useState<Map<VizType, VizState>>(new Map());
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const abortRefs = useRef<Map<VizType, AbortController>>(new Map());

  const generate = useCallback(
    async (type: VizType, forceRefresh = false) => {
      // Return cached data unless forced
      const existing = cacheRef.current.get(type);
      if (!forceRefresh && existing?.status === "success") return;

      // Cancel any in-flight request for this type
      const prevController = abortRefs.current.get(type);
      if (prevController) prevController.abort();

      const controller = new AbortController();
      abortRefs.current.set(type, controller);

      // Set loading state
      setCache((prev) => {
        const next = new Map(prev);
        next.set(type, { status: "loading", data: null, error: null });
        return next;
      });

      try {
        const data = await fetchVisualization(repoId, type);

        // Check if aborted
        if (controller.signal.aborted) return;

        setCache((prev) => {
          const next = new Map(prev);
          next.set(type, { status: "success", data, error: null });
          return next;
        });
      } catch (err: unknown) {
        if ((err as any).name === "AbortError") return;

        setCache((prev) => {
          const next = new Map(prev);
          next.set(type, {
            status: "error",
            data: null,
            error: (err as any).message || "Failed to load visualization",
          });
          return next;
        });
      }
    },
    [repoId]
  );

  const getState = useCallback(
    (type: VizType): VizState => {
      return cache.get(type) ?? INITIAL_STATE;
    },
    [cache]
  );

  const resetAll = useCallback(() => {
    // Abort all in-flight requests
    abortRefs.current.forEach((c) => c.abort());
    abortRefs.current.clear();
    setCache(new Map());
  }, []);

  return { generate, getState, resetAll };
}
