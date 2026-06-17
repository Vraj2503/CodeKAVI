"use client";

import { useState, useCallback, useRef } from "react";
import { fetchVisualizationExplanation } from "@/lib/api";

export type ExplainStatus = "idle" | "loading" | "success" | "error";

export interface ExplainState {
  status: ExplainStatus;
  explanation: string | null;
  tokensUsed: number;
  error: string | null;
}

const INITIAL_STATE: ExplainState = {
  status: "idle",
  explanation: null,
  tokensUsed: 0,
  error: null,
};

/**
 * Hook for on-demand visualization explanation (LLM call).
 * Completely separate from visualization data generation.
 */
export function useExplanation(repoId: string) {
  const [cache, setCache] = useState<Map<string, ExplainState>>(new Map());
  const cacheRef = useRef(cache);
  cacheRef.current = cache;

  const explain = useCallback(
    async (vizType: string, forceRefresh = false) => {
      const existing = cacheRef.current.get(vizType);
      if (!forceRefresh && existing?.status === "success") return;

      setCache((prev) => {
        const next = new Map(prev);
        next.set(vizType, { ...INITIAL_STATE, status: "loading" });
        return next;
      });

      try {
        const data = await fetchVisualizationExplanation(repoId, vizType);

        setCache((prev) => {
          const next = new Map(prev);
          next.set(vizType, {
            status: "success",
            explanation: data.explanation,
            tokensUsed: data.tokens_used,
            error: null,
          });
          return next;
        });
      } catch (err: unknown) {
        setCache((prev) => {
          const next = new Map(prev);
          next.set(vizType, {
            status: "error",
            explanation: null,
            tokensUsed: 0,
            error: err.message || "Failed to generate explanation",
          });
          return next;
        });
      }
    },
    [repoId]
  );

  const getExplanation = useCallback(
    (vizType: string): ExplainState => {
      return cache.get(vizType) ?? INITIAL_STATE;
    },
    [cache]
  );

  return { explain, getExplanation };
}
