"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useTheme } from "@/components/ui/theme-provider";
import { useRepoGraph } from "@/hooks/useRepoGraph";
import {
  graphViewReducer,
  initialGraphViewState,
  LARGE_REPO_FILE_THRESHOLD,
} from "@/lib/graph/graphState";
import {
  buildOverviewGraph,
  buildLayerViewGraph,
} from "@/lib/graph/buildFlowGraph";
import {
  layoutContainers,
  layoutContainerChildren,
  type LayoutResult,
} from "@/lib/graph/elkLayout";
import type { GraphFlag } from "@/lib/graph/flags";
import { FileNode } from "./FileNode";
import { ContainerNode } from "./ContainerNode";
import { LayerNode } from "./LayerNode";
import { PortalNode } from "./PortalNode";
import { GraphBreadcrumb } from "./GraphBreadcrumb";
import { FlagFilter } from "./FlagFilter";
import { NodePanel } from "./NodePanel";

const NODE_TYPES: NodeTypes = {
  layer: LayerNode,
  container: ContainerNode,
  file: FileNode,
  portal: PortalNode,
};

export interface GraphCanvasProps {
  repoId: string;
}

function GraphCanvasInner({ repoId }: GraphCanvasProps) {
  const { status, data: payload, error } = useRepoGraph(repoId);
  const [state, dispatch] = useReducer(graphViewReducer, initialGraphViewState);
  // Native React Flow chrome (Background, Controls, attribution) ships with its
  // own light-only default theme and doesn't read the app's CSS class — without
  // this it renders near-invisible on the dark surface (review: zoom controls
  // disappear in dark mode).
  const { resolvedTheme } = useTheme();
  const colorMode = resolvedTheme === "light" ? "light" : "dark";

  // ELK stage 1 (per layer) and stage 2 (per expanded container) results,
  // cached for the lifetime of this payload — cheap since a repo's layout
  // never changes without a full re-fetch.
  const [containerLayouts, setContainerLayouts] = useState<
    Record<string, LayoutResult>
  >({});
  const [fileLayouts, setFileLayouts] = useState<Record<string, LayoutResult>>(
    {},
  );

  // Reset layout caches during render on payload change — the React-recommended
  // way to adjust state on a prop change without an extra effect round-trip.
  const [trackedPayload, setTrackedPayload] = useState(payload);
  if (payload !== trackedPayload) {
    setTrackedPayload(payload);
    setContainerLayouts({});
    setFileLayouts({});
  }

  useEffect(() => {
    const layerId = state.activeLayerId;
    if (!payload || !layerId || containerLayouts[layerId]) return;
    let cancelled = false;
    layoutContainers(payload, layerId).then((result) => {
      if (!cancelled) {
        setContainerLayouts((prev) => ({ ...prev, [layerId]: result }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [payload, state.activeLayerId, containerLayouts]);

  useEffect(() => {
    if (!payload) return;
    const missing = [...state.expandedContainers].filter(
      (id) => !fileLayouts[id],
    );
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((id) =>
        layoutContainerChildren(payload, id).then(
          (result) => [id, result] as const,
        ),
      ),
    ).then((results) => {
      if (cancelled) return;
      setFileLayouts((prev) => {
        const next = { ...prev };
        for (const [id, result] of results) next[id] = result;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [payload, state.expandedContainers, fileLayouts]);

  const onOpen = useCallback(
    (layerId: string) => dispatch({ type: "open_layer", layerId }),
    [],
  );
  const onToggleContainer = useCallback(
    (containerId: string) =>
      dispatch({ type: "toggle_container", containerId }),
    [],
  );
  const toggleFlag = useCallback(
    (flag: GraphFlag) => dispatch({ type: "toggle_flag", flag }),
    [],
  );

  const handleNodeClick = useCallback<NodeMouseHandler>((_event, node) => {
    if (node.type === "file")
      dispatch({ type: "select_file", fileId: node.id });
  }, []);
  const handlePaneClick = useCallback(
    () => dispatch({ type: "close_panel" }),
    [],
  );
  const handleBreadcrumbNavigate = useCallback((layerId: string | null) => {
    dispatch(
      layerId ? { type: "open_layer", layerId } : { type: "close_layer" },
    );
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (!payload) return { nodes: [], edges: [] };
    if (!state.activeLayerId) return buildOverviewGraph(payload, onOpen);

    const containerLayout = containerLayouts[state.activeLayerId];
    if (!containerLayout) return { nodes: [], edges: [] };

    const filePositionsByContainer: Record<
      string,
      Record<string, import("@/lib/graph/elkLayout").NodeBox>
    > = {};
    for (const containerId of state.expandedContainers) {
      const layout = fileLayouts[containerId];
      if (layout) filePositionsByContainer[containerId] = layout.positions;
    }

    return buildLayerViewGraph(
      payload,
      state.activeLayerId,
      containerLayout.positions,
      state.expandedContainers,
      filePositionsByContainer,
      state.activeFlags,
      { onToggleContainer, onNavigatePortal: onOpen },
    );
  }, [
    payload,
    state.activeLayerId,
    state.expandedContainers,
    state.activeFlags,
    containerLayouts,
    fileLayouts,
    onOpen,
    onToggleContainer,
  ]);

  if (status === "loading" || status === "polling") {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        {status === "polling" ? "Re-analyzing repository…" : "Loading graph…"}
      </div>
    );
  }
  if (status === "error" || !payload) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-destructive">
        {error ?? "Failed to load graph"}
      </div>
    );
  }

  const activeLayer =
    payload.layers.find((l) => l.id === state.activeLayerId) ?? null;
  const selectedFile = state.selectedFileId
    ? (payload.files.find((f) => f.id === state.selectedFileId) ?? null)
    : null;
  const usedLayoutFallback =
    (state.activeLayerId &&
      containerLayouts[state.activeLayerId]?.usedFallback) ||
    [...state.expandedContainers].some((id) => fileLayouts[id]?.usedFallback);
  const hasNoEdges = payload.edges.length === 0 && payload.files.length > 0;
  const isLargeRepo = payload.files.length > LARGE_REPO_FILE_THRESHOLD;
  const showLargeRepoNotice = isLargeRepo && !state.activeLayerId;

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-2">
        <GraphBreadcrumb
          activeLayer={activeLayer}
          onNavigate={handleBreadcrumbNavigate}
        />
        <FlagFilter
          files={payload.files}
          activeFlags={state.activeFlags}
          onToggle={toggleFlag}
        />
        {hasNoEdges && (
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 border border-border/50 max-w-xs">
            No dependencies could be resolved — files are grouped by role only.
          </p>
        )}
        {showLargeRepoNotice && (
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 border border-border/50 max-w-xs">
            {payload.files.length.toLocaleString()} files — showing layer
            overview only. Open a layer, then a container, to see individual
            files.
          </p>
        )}
        {usedLayoutFallback && (
          <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 border border-destructive/20 max-w-xs">
            Automatic layout failed; showing a fallback grid.
          </p>
        )}
      </div>
      <ReactFlow
        key={state.activeLayerId ?? "overview"}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
        colorMode={colorMode}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
      {selectedFile && (
        <div className="absolute right-3 top-3 z-10 w-80">
          <NodePanel
            file={selectedFile}
            cycles={payload.insights.cycles}
            onClose={handlePaneClick}
          />
        </div>
      )}
    </div>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
