"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useTheme } from "@/components/ui/theme-provider";
import { warmElkLayout } from "@/lib/graph/elkLayout";
import type { KnowledgeGraphPayload } from "@/lib/api";
import { useKnowledgeLayout } from "@/hooks/useKnowledgeLayout";
import {
  knowledgeGraphReducer,
  initialKnowledgeGraphState,
} from "@/lib/knowledge/graphState";
import { buildFunctionGraph } from "@/lib/knowledge/buildFlowGraph";
import { SymbolNode } from "./SymbolNode";
import { KnowledgeEdge } from "./KnowledgeEdge";
import { SymbolPanel } from "./SymbolPanel";

// ── React Flow type registrations ──────────────────────────────────────────

const NODE_TYPES: NodeTypes = {
  symbol: SymbolNode,
};

const EDGE_TYPES: EdgeTypes = {
  knowledgeEdge: KnowledgeEdge,
};

// ── Props ──────────────────────────────────────────────────────────────────

export interface KnowledgeGraphProps {
  payload: KnowledgeGraphPayload;
  /** Whether LLM description enrichment is currently in-flight. */
  isEnriching?: boolean;
  /** Fire to trigger LLM description enrichment. */
  onEnrich?: () => void;
}

// ── Inner canvas (must be inside ReactFlowProvider) ────────────────────────

function KnowledgeGraphInner({
  payload,
  isEnriching = false,
  onEnrich,
}: KnowledgeGraphProps) {
  const [state, dispatch] = useReducer(
    knowledgeGraphReducer,
    initialKnowledgeGraphState,
  );

  // Pre-load the ELK bundle so the first layout doesn't pay the cold start.
  useEffect(() => {
    warmElkLayout();
  }, []);

  const { resolvedTheme } = useTheme();
  const colorMode = resolvedTheme === "light" ? "light" : "dark";

  const { layout, isLayingOut } = useKnowledgeLayout(payload);

  // ── Callbacks ────────────────────────────────────────────────────────────

  const handleSelectSymbol = useCallback(
    (symbolId: string) => dispatch({ type: "select_symbol", symbolId }),
    [],
  );

  const handlePaneClick = useCallback(
    () => dispatch({ type: "close_panel" }),
    [],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    if (node.type === "symbol") {
      dispatch({ type: "select_symbol", symbolId: node.id });
    }
  }, []);

  const handleEnrich = useCallback(() => {
    onEnrich?.();
  }, [onEnrich]);

  // ── Build React Flow nodes/edges ─────────────────────────────────────────

  const { nodes, edges } = useMemo(() => {
    if (!layout) return { nodes: [], edges: [] };
    return buildFunctionGraph(
      payload,
      layout.positions,
      handleSelectSymbol,
      state.selectedSymbolId,
    );
  }, [payload, layout, handleSelectSymbol, state.selectedSymbolId]);

  // ── Derived data ─────────────────────────────────────────────────────────

  const selectedSymbol = state.selectedSymbolId
    ? (payload.nodes.find((n) => n.id === state.selectedSymbolId) ?? null)
    : null;

  const usedFallback = layout?.usedFallback ?? false;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full">
      {/* Canvas region */}
      <div className="relative min-w-0 flex-1">
        {/* Toolbar chrome — sits above the canvas, pointer-events-none on the
            container keeps the canvas draggable through the gaps. */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col gap-2">
          <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleEnrich}
              disabled={isEnriching}
              className="rounded-md border bg-card px-3 py-1.5 text-xs font-medium text-card-foreground shadow-sm disabled:opacity-50"
            >
              {isEnriching
                ? "Generating descriptions…"
                : "Generate descriptions"}
            </button>
          </div>
          {usedFallback && (
            <div className="pointer-events-auto mx-auto flex w-full max-w-xs flex-col items-center gap-2">
              <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Automatic layout failed; showing a fallback grid.
              </p>
            </div>
          )}
        </div>

        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          colorMode={colorMode}
          fitView
          fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        >
          <Background />
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>

        {isLayingOut && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
            Laying out…
          </div>
        )}
      </div>

      {/* Right-side detail panel for the selected symbol */}
      {selectedSymbol && (
        <SymbolPanel symbol={selectedSymbol} onClose={handlePaneClick} />
      )}
    </div>
  );
}

// ── Public export (wraps with ReactFlowProvider) ───────────────────────────

export function KnowledgeGraph(props: KnowledgeGraphProps) {
  return (
    <ReactFlowProvider>
      <KnowledgeGraphInner {...props} />
    </ReactFlowProvider>
  );
}
