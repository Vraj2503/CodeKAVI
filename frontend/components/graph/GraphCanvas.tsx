"use client";

import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import { useTheme } from "@/components/ui/theme-provider";
import { useRepo } from "@/components/RepoProvider";
import { useRepoGraph } from "@/hooks/useRepoGraph";
import { useTour } from "@/hooks/useTour";
import { useQuestionTour } from "@/hooks/useQuestionTour";
import {
  graphViewReducer,
  initialGraphViewState,
  LARGE_REPO_FILE_THRESHOLD,
} from "@/lib/graph/graphState";
import {
  buildOverviewGraph,
  buildLayerViewGraph,
  expandedContainerBox,
} from "@/lib/graph/buildFlowGraph";
import {
  layoutContainers,
  layoutContainerChildren,
  warmElkLayout,
  containerSize,
  type LayoutResult,
} from "@/lib/graph/elkLayout";
import { runCameraTrap } from "@/lib/graph/cameraTrap";
import type { GraphFlag } from "@/lib/graph/flags";
import { FileNode } from "./FileNode";
import { ContainerNode } from "./ContainerNode";
import { LayerNode } from "./LayerNode";
import { PortalNode } from "./PortalNode";
import { GraphBreadcrumb } from "./GraphBreadcrumb";
import { FlagFilter } from "./FlagFilter";
import { NodePanel } from "./NodePanel";
import { TourPanel } from "./TourPanel";
import type { TourMode, TourStep } from "@/lib/api";

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

  // Pre-load the ELK bundle on mount so the first drill-in / tour step doesn't
  // pay the ~1MB bundle + init cold start.
  useEffect(() => {
    warmElkLayout();
  }, []);

  const reactFlow = useReactFlow();
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

  // Real (expanded) box sizes for opened containers whose stage-2 file layout
  // is ready. Feeding these to stage-1 makes ELK reflow neighbors aside instead
  // of letting the grown container overlap them. Floored at the collapsed size,
  // so this converges: once ELK adopts the expanded size the override is stable.
  const containerBoxOverrides = useMemo(() => {
    const overrides: Record<string, { width: number; height: number }> = {};
    if (!payload || !state.activeLayerId) return overrides;
    for (const id of state.expandedContainers) {
      const fileLayout = fileLayouts[id];
      const container = payload.containers.find((c) => c.id === id);
      if (
        !fileLayout ||
        !container ||
        container.layer_id !== state.activeLayerId
      )
        continue;
      overrides[id] = expandedContainerBox(
        containerSize(container.file_ids.length),
        fileLayout.positions,
      );
    }
    return overrides;
  }, [payload, state.activeLayerId, state.expandedContainers, fileLayouts]);

  const overridesSig = Object.keys(containerBoxOverrides)
    .sort()
    .map(
      (id) =>
        `${id}:${containerBoxOverrides[id].width}:${containerBoxOverrides[id].height}`,
    )
    .join("|");
  const activeLayoutKey = state.activeLayerId
    ? `${state.activeLayerId}|${overridesSig}`
    : null;

  useEffect(() => {
    const layerId = state.activeLayerId;
    if (
      !payload ||
      !layerId ||
      !activeLayoutKey ||
      containerLayouts[activeLayoutKey]
    )
      return;
    let cancelled = false;
    layoutContainers(payload, layerId, containerBoxOverrides).then((result) => {
      if (!cancelled) {
        setContainerLayouts((prev) => ({ ...prev, [activeLayoutKey]: result }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    payload,
    state.activeLayerId,
    activeLayoutKey,
    containerBoxOverrides,
    containerLayouts,
  ]);

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

  const [tourOpen, setTourOpen] = useState(false);
  const [tourMode, setTourMode] = useState<TourMode>("learn");
  const [tourQuestion, setTourQuestion] = useState<string | null>(null);
  const modeTour = useTour(repoId, tourMode);
  const questionTour = useQuestionTour(repoId, tourQuestion);
  const tour = tourQuestion ? questionTour : modeTour;

  const { sidebarCollapsed, setSidebarCollapsed } = useRepo();
  const prevSidebarCollapsed = useRef(sidebarCollapsed);
  useEffect(() => {
    if (tourOpen) {
      prevSidebarCollapsed.current = sidebarCollapsed;
      setSidebarCollapsed(true);
    } else {
      setSidebarCollapsed(prevSidebarCollapsed.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourOpen]);

  // Bring a tour step's file into view: open its layer/container so the node
  // exists at all, then hand off to the E7 camera trap (lib/graph/cameraTrap)
  // to frame it once it has measured dimensions.
  const cameraTrapCancelRef = useRef<(() => void) | null>(null);
  // The container this tour last auto-expanded, so the next step can collapse
  // it. Without this, expandedContainers (and the React Flow node set rebuilt
  // on every step via selectedFileId) grows monotonically across a tour and
  // eventually exhausts the JS heap on a sizable repo.
  const tourContainerRef = useRef<string | null>(null);
  const handleTourStepChange = useCallback(
    (step: TourStep) => {
      const fileId = step.node_ids[0];
      if (!fileId || !payload) return;
      const file = payload.files.find((f) => f.id === fileId);
      if (!file) return;

      if (file.layer_id && file.layer_id !== state.activeLayerId) {
        dispatch({ type: "open_layer", layerId: file.layer_id });
        // open_layer clears expandedContainers, so nothing to collapse.
        tourContainerRef.current = null;
      }
      // Collapse the previous step's container (only if it's still open and
      // isn't the one we're about to focus) to keep the tour to one container.
      const prev = tourContainerRef.current;
      if (
        prev &&
        prev !== file.container_id &&
        state.expandedContainers.has(prev)
      ) {
        dispatch({ type: "toggle_container", containerId: prev });
      }
      if (
        file.container_id &&
        !state.expandedContainers.has(file.container_id)
      ) {
        dispatch({ type: "toggle_container", containerId: file.container_id });
      }
      tourContainerRef.current = file.container_id ?? null;
      dispatch({ type: "select_file", fileId: file.id });

      cameraTrapCancelRef.current?.();
      cameraTrapCancelRef.current = runCameraTrap(reactFlow, file.id);
    },
    [payload, state.activeLayerId, state.expandedContainers, reactFlow],
  );
  useEffect(() => () => cameraTrapCancelRef.current?.(), []);

  const { nodes, edges } = useMemo(() => {
    if (!payload) return { nodes: [], edges: [] };
    if (!state.activeLayerId)
      return buildOverviewGraph(payload, onOpen, state.selectedFileId);

    const containerLayout = activeLayoutKey
      ? containerLayouts[activeLayoutKey]
      : undefined;
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
      state.selectedFileId,
    );
  }, [
    payload,
    state.activeLayerId,
    activeLayoutKey,
    state.expandedContainers,
    state.activeFlags,
    state.selectedFileId,
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
    (activeLayoutKey && containerLayouts[activeLayoutKey]?.usedFallback) ||
    [...state.expandedContainers].some((id) => fileLayouts[id]?.usedFallback);
  // Active layer chosen but its stage-1 container layout hasn't resolved yet:
  // the useMemo returns empty nodes, so show an overlay instead of a blank canvas.
  const isLayingOut = !!activeLayoutKey && !containerLayouts[activeLayoutKey];
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
        <button
          type="button"
          onClick={() => setTourOpen((open) => !open)}
          aria-pressed={tourOpen}
          className="w-fit rounded-full border bg-card px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {tourOpen ? "Exit tour" : "Start tour"}
        </button>
      </div>
      {(hasNoEdges || showLargeRepoNotice || usedLayoutFallback) && (
        <div className="absolute left-1/2 top-3 z-10 flex w-full max-w-xs -translate-x-1/2 flex-col items-center gap-2 px-3">
          {hasNoEdges && (
            <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 border border-border/50">
              No dependencies could be resolved — files are grouped by role
              only.
            </p>
          )}
          {showLargeRepoNotice && (
            <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 border border-border/50">
              {payload.files.length.toLocaleString()} files — showing layer
              overview only. Open a layer, then a container, to see individual
              files.
            </p>
          )}
          {usedLayoutFallback && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 border border-destructive/20">
              Automatic layout failed; showing a fallback grid.
            </p>
          )}
        </div>
      )}
      <ReactFlow
        key={state.activeLayerId ?? "overview"}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
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
      {selectedFile && !tourOpen && (
        <div className="absolute right-3 top-3 z-10 w-80">
          <NodePanel
            file={selectedFile}
            cycles={payload.insights.cycles}
            onClose={handlePaneClick}
          />
        </div>
      )}
      {tourOpen && (
        <div className="absolute inset-y-0 right-0 z-10 w-full max-w-md">
          <TourPanel
            repoId={repoId}
            mode={tourMode}
            onModeChange={(m) => {
              setTourQuestion(null);
              setTourMode(m);
            }}
            status={tour.status}
            steps={tour.steps}
            error={tour.error}
            onClose={() => setTourOpen(false)}
            onStepChange={handleTourStepChange}
            deletedCount={modeTour.deletedCount}
            activeQuestion={tourQuestion}
            onAskQuestion={setTourQuestion}
            onClearQuestion={() => setTourQuestion(null)}
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
