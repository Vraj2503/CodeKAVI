import { useEffect, useState } from "react";
import type { KnowledgeGraphPayload } from "@/lib/api";
import type { LayoutResult } from "@/lib/graph/elkLayout";
import { layoutFunctionGraph } from "@/lib/knowledge/elkLayout";

export interface UseKnowledgeLayoutResult {
  layout: LayoutResult | null;
  isLayingOut: boolean;
}

/** Single-stage ELK layout for the flat function graph, computed once per payload. */
export function useKnowledgeLayout(
  payload: KnowledgeGraphPayload | null | undefined,
): UseKnowledgeLayoutResult {
  const [layout, setLayout] = useState<LayoutResult | null>(null);

  // Reset during render on payload change, same pattern as GraphCanvas.
  const [trackedPayload, setTrackedPayload] = useState(payload);
  if (payload !== trackedPayload) {
    setTrackedPayload(payload);
    setLayout(null);
  }

  useEffect(() => {
    if (!payload || layout) return;
    let cancelled = false;
    layoutFunctionGraph(payload).then((result) => {
      if (!cancelled) setLayout(result);
    });
    return () => {
      cancelled = true;
    };
  }, [payload, layout]);

  return { layout, isLayingOut: !layout };
}
