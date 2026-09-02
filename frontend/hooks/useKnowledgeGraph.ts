"use client";

import { useCallback, useRef, useState } from "react";
import {
  fetchVisualization,
  enrichKnowledgeGraph,
  type KnowledgeGraphPayload,
} from "@/lib/api";
import { describeFailure, isAbort, type HumanFailure } from "@/lib/errors";

export type KnowledgeGraphStatus = "idle" | "loading" | "success" | "error";

export interface KnowledgeGraphState {
  status: KnowledgeGraphStatus;
  payload: KnowledgeGraphPayload | null;
  failure: HumanFailure | null;
  slow: boolean;
  isEnriching: boolean;
}

const INITIAL_STATE: KnowledgeGraphState = {
  status: "idle",
  payload: null,
  failure: null,
  slow: false,
  isEnriching: false,
};

// Same deadline/slow-tell as useVisualization — see that file for why.
const REQUEST_TIMEOUT_MS = 45_000;
const SLOW_MS = 12_000;

/**
 * Fetch + LLM-enrich the knowledge graph for one repo.
 *
 * Mirrors `useVisualization`'s timeout/slow/abort handling, but isn't built
 * on top of it: knowledge graph is a single type per repo (no multi-viz
 * cache needed), and enrichment is a second request that replaces the same
 * payload with a concept-annotated one, not a different chart.
 */
export function useKnowledgeGraph(repoId: string) {
  const [state, setState] = useState<KnowledgeGraphState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(
    async (forceRefresh = false) => {
      setState((prev) => {
        if (!forceRefresh && prev.status !== "idle") return prev;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const deadline = setTimeout(
          () =>
            controller.abort(
              new DOMException(
                "Visualization request timed out",
                "TimeoutError",
              ),
            ),
          REQUEST_TIMEOUT_MS,
        );
        const slowTimer = setTimeout(() => {
          setState((cur) =>
            cur.status === "loading" ? { ...cur, slow: true } : cur,
          );
        }, SLOW_MS);

        fetchVisualization(repoId, "knowledge", false, controller.signal)
          .then((res) => {
            setState({
              status: "success",
              payload: res.data as KnowledgeGraphPayload,
              failure: null,
              slow: false,
              isEnriching: false,
            });
          })
          .catch((err: unknown) => {
            if (isAbort(err)) return;
            const failure = describeFailure(err, "the knowledge graph");
            console.warn("Knowledge graph failed:", failure.detail);
            setState((cur) => ({
              ...cur,
              status: "error",
              failure,
              slow: false,
            }));
          })
          .finally(() => {
            clearTimeout(deadline);
            clearTimeout(slowTimer);
            if (abortRef.current === controller) abortRef.current = null;
          });

        return { ...prev, status: "loading", failure: null, slow: false };
      });
    },
    [repoId],
  );

  const enrich = useCallback(async () => {
    setState((prev) => ({ ...prev, isEnriching: true }));
    try {
      const res = await enrichKnowledgeGraph(repoId);
      setState((prev) => ({
        ...prev,
        payload: res.data as KnowledgeGraphPayload,
        isEnriching: false,
      }));
    } catch (err: unknown) {
      const failure = describeFailure(err, "the concept overlay");
      console.warn("Knowledge graph enrichment failed:", failure.detail);
      setState((prev) => ({ ...prev, isEnriching: false }));
    }
  }, [repoId]);

  return { ...state, generate, enrich };
}
