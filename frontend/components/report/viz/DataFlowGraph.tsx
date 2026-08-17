/*  */ "use client";

/**
 * DataFlowGraph — semantic data flow diagram built on @xyflow/react.
 *
 * Replaces the previous D3 implementation. Renders conceptual stages as
 * shaped nodes connected by labelled, color-coded edges, with:
 *   - ELK layered layout (dynamic import, zero bundle cost if unused)
 *   - Connection-aware hover (dims unrelated nodes/edges)
 *   - Click → detail panel (description, inputs, outputs, files, trace)
 *   - Trace BFS upstream/downstream
 *   - Search + filter chips
 *   - MiniMap, keyboard nav, reduced-motion safe
 */

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
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
  applyNodeChanges,
  applyEdgeChanges,
  Panel,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "./dataflow-overrides.css";

import { Menu, Map } from "lucide-react";
import { cn } from "@/lib/utils";

import { catVar } from "@/lib/viz/tokens";
import {
  VizShell,
  VizLegend,
  type VizLegendItem,
} from "@/components/viz/VizShell";
import { useVizCanvas } from "@/components/viz/useVizCanvas";
import { useVizZoom } from "@/components/viz/useVizZoom";
import { useReducedMotion } from "@/components/viz/useReducedMotion";

// Internal dataflow modules
import type {
  DataFlowGraphProps,
  FlowNode,
  RFNode,
  RFEdge,
} from "./dataflow/model";
import {
  expandTechnologies,
  prepareFlowGraph,
  toRFNodes,
  toRFEdges,
  assignClosestHandles,
  EDGE_KIND_LABEL,
  ALL_EDGE_KINDS,
} from "./dataflow/model";
import { runLayout } from "./dataflow/layout";
import { minimapNodeColor } from "./dataflow/theming";
import { dfgReducer, initialState } from "./dataflow/state/reducer";
import { useHighlightMap, edgeHighlight } from "./dataflow/state/selectors";
import { FlowEdge as FlowEdgeComponent } from "./dataflow/edges/flow-edge";
import { FlowMarkerDefs } from "./dataflow/edges/flow-marker";
import { ActionNode } from "./dataflow/nodes/action-node";
import { DecisionNode } from "./dataflow/nodes/decision-node";
import { TransformNode } from "./dataflow/nodes/transform-node";
import { DataStoreNode } from "./dataflow/nodes/data-store-node";
import { StartNode, EndNode } from "./dataflow/nodes/start-node";
import { GroupFrame } from "./dataflow/nodes/group-frame";
import { DetailPanel } from "./dataflow/detail-panel";
import { SearchBox } from "./dataflow/search-box";
import { FilterChips } from "./dataflow/filter-chips";
import { TraceToolbar } from "./dataflow/trace-toolbar";
import { entryToExitPath } from "./dataflow/replay";

// ── Stable nodeTypes map (must be module-level to avoid remounting) ──────────
const nodeTypes = Object.freeze({
  start: StartNode,
  end: EndNode,
  action: ActionNode,
  decision: DecisionNode,
  transform: TransformNode,
  data_store: DataStoreNode,
  group: GroupFrame,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as Record<string, React.ComponentType<any>>;

const edgeTypes = Object.freeze({
  flow: FlowEdgeComponent,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as Record<string, React.ComponentType<any>>;

// ── Legend items ──────────────────────────────────────────────────────────────
const NODE_LEGEND: VizLegendItem[] = [
  { label: "Entry", color: catVar(1) },
  { label: "Exit", color: catVar(1) },
  { label: "Process", color: catVar(5) },
  { label: "Transform", color: catVar(2) },
  { label: "Data Store", color: catVar(3) },
];

const EDGE_LEGEND: VizLegendItem[] = ALL_EDGE_KINDS.map((k, i) => ({
  label: EDGE_KIND_LABEL[k],
  color: catVar(i),
  shape: "line" as const,
}));

// ── Inner component (needs useReactFlow, must be inside ReactFlowProvider) ───

function DataFlowGraphInner({
  nodes: propNodes,
  edges: propEdges,
}: DataFlowGraphProps) {
  const rf = useReactFlow();
  const canvas = useVizCanvas();
  const zoom = useVizZoom();
  const reducedMotion = useReducedMotion();

  // ── State ──────────────────────────────────────────────────────────────────
  const [state, dispatch] = useReducer(dfgReducer, undefined, initialState);
  const [rfNodes, setRfNodes] = useState<RFNode[]>([]);
  const [rfEdges, setRfEdges] = useState<RFEdge[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [replayRun, setReplayRun] = useState(0);
  const replayTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(false);
  const [isMinimapOpen, setIsMinimapOpen] = useState(true);
  const layoutRunning = useRef(false);

  // ── Convert props → RF shapes ──────────────────────────────────────────────
  const preparedGraph = useMemo(
    () => prepareFlowGraph(propNodes, propEdges),
    [propNodes, propEdges],
  );
  const displayGraph = useMemo(
    () =>
      expandTechnologies(preparedGraph.nodes, preparedGraph.edges, expanded),
    [preparedGraph, expanded],
  );
  const baseNodes = useMemo(
    () => toRFNodes(displayGraph.nodes, expanded),
    [displayGraph.nodes, expanded],
  );
  const baseEdges = useMemo(
    () => toRFEdges(displayGraph.edges),
    [displayGraph.edges],
  );

  // ── Run ELK layout on graph change ────────────────────────────────────────
  useEffect(() => {
    if (baseNodes.length === 0) {
      const frame = requestAnimationFrame(() => {
        setRfNodes([]);
        setRfEdges([]);
      });
      return () => cancelAnimationFrame(frame);
    }
    let cancelled = false;
    layoutRunning.current = true;
    runLayout(baseNodes, baseEdges).then(({ nodes: laid }) => {
      if (cancelled) return;
      layoutRunning.current = false;
      setRfNodes(laid);
      setRfEdges(assignClosestHandles(laid, baseEdges));
      // Fit after layout settles (no animation on first paint)
      requestAnimationFrame(() => rf.fitView({ duration: 0, padding: 0.15 }));
    });
    return () => {
      cancelled = true;
    };
  }, [baseNodes, baseEdges, rf]);

  // ── Register zoom controller with VizShell ─────────────────────────────────
  useEffect(() => {
    zoom.register(null, {
      zoomIn: () => rf.zoomIn({ duration: 200 }),
      zoomOut: () => rf.zoomOut({ duration: 200 }),
      fitToView: () => rf.fitView({ duration: 300, padding: 0.15 }),
    });
  }, [rf, zoom]);

  // ── Highlight map from reducer state ──────────────────────────────────────
  const hlMap = useHighlightMap(state, displayGraph.nodes, displayGraph.edges);

  // ── Apply highlight to nodes ───────────────────────────────────────────────
  const visibleNodes = useMemo<RFNode[]>(() => {
    return rfNodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        highlight: hlMap.get(n.id) ?? "off",
      },
    }));
  }, [rfNodes, hlMap]);

  // ── Apply highlight to edges ───────────────────────────────────────────────
  const visibleEdges = useMemo<RFEdge[]>(() => {
    const replayPath = replayRun
      ? entryToExitPath(displayGraph.nodes, displayGraph.edges)
      : [];
    return rfEdges.map((e) => ({
      ...e,
      data: {
        ...e.data!,
        highlight: edgeHighlight(e.source, e.target, hlMap),
        replayRun: replayRun || undefined,
        replayStep:
          replayPath.indexOf(`${e.source}->${e.target}`) >= 0
            ? replayPath.indexOf(`${e.source}->${e.target}`)
            : undefined,
      },
    }));
  }, [rfEdges, hlMap, replayRun, displayGraph]);

  // ── Event handlers ─────────────────────────────────────────────────────────
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      dispatch({ type: "select", id: node.id });
      if (
        preparedGraph.nodes.some(
          (item) => item.id === node.id && item.technologies?.length,
        )
      ) {
        setExpanded((current) => {
          const next = new Set(current);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
      }
    },
    [preparedGraph.nodes],
  );

  const selectedNode: FlowNode | null = state.selected
    ? (preparedGraph.nodes.find((n) => n.id === state.selected) ?? null)
    : null;

  const replayPath = useMemo(
    () => entryToExitPath(displayGraph.nodes, displayGraph.edges),
    [displayGraph],
  );
  const replay = useCallback(() => {
    if (reducedMotion || replayPath.length === 0) return;

    if (replayRun > 0) {
      // Toggle off
      setReplayRun(0);
      if (replayTimeout.current) clearTimeout(replayTimeout.current);
      return;
    }

    // Start playback
    setReplayRun((run) => (run === 0 ? 1 : run + 1));

    const duration = replayPath.length * 700 + 900;
    if (replayTimeout.current) clearTimeout(replayTimeout.current);

    replayTimeout.current = setTimeout(() => {
      setReplayRun(0);
    }, duration);
  }, [reducedMotion, replayPath, replayRun]);

  const toolbar = (
    <div className="flex items-center">
      <button
        type="button"
        onClick={() => setIsToolbarExpanded((s) => !s)}
        className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground z-10"
        title="Toggle Filters"
      >
        <Menu className="h-4 w-4" />
        Filters
      </button>

      <div
        className={cn(
          "flex flex-nowrap items-center overflow-hidden transition-all duration-300 ease-in-out",
          isToolbarExpanded
            ? "max-w-[800px] opacity-100 px-3"
            : "max-w-0 opacity-0 px-0 pointer-events-none",
        )}
      >
        <div className="flex shrink-0 items-center gap-3">
          <SearchBox
            value={state.search}
            onChange={(q) => dispatch({ type: "search", q })}
          />
          <FilterChips
            value={state.filters.nodes}
            onChange={(nextKinds) => {
              const curr = state.filters.nodes;
              for (const k of nextKinds) {
                if (!curr.has(k)) {
                  dispatch({ type: "toggle-n-kind", kind: k });
                  return;
                }
              }
              for (const k of curr) {
                if (!nextKinds.has(k)) {
                  dispatch({ type: "toggle-n-kind", kind: k });
                  return;
                }
              }
            }}
          />
          <TraceToolbar
            traceFrom={state.traceFrom}
            selectedId={state.selected}
            selectedLabel={selectedNode?.label ?? ""}
            onTrace={(id) => dispatch({ type: "trace", from: id })}
            onReset={() => dispatch({ type: "trace", from: null })}
          />
          <button
            type="button"
            onClick={replay}
            disabled={reducedMotion || replayPath.length === 0}
            title={
              reducedMotion
                ? "Animation is disabled by your motion preference"
                : "Replay one entry-to-exit flow"
            }
            className={cn(
              "shrink-0 rounded border px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              replayRun > 0
                ? "border-viz-highlight text-viz-highlight hover:bg-viz-highlight hover:text-white"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {replayRun > 0 ? "Stop replay" : "Replay flow"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <VizShell
      canvas={canvas}
      zoom={zoom}
      label="Data Flow"
      description="Semantic data flow: nodes are stages, edges show how data moves between them."
      toolbarLeft={toolbar}
    >
      <div className="relative h-full w-full">
        <ReactFlow
          nodes={visibleNodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={handleNodeClick}
          onNodesChange={(changes) =>
            setRfNodes((nds) => applyNodeChanges(changes, nds))
          }
          onEdgesChange={(changes) =>
            setRfEdges((eds) => applyEdgeChanges(changes, eds))
          }
          onPaneClick={() => dispatch({ type: "select", id: null })}
          elementsSelectable={false}
          nodesDraggable={true}
          fitView={false}
          panOnDrag
          zoomOnScroll={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <FlowMarkerDefs />
          {isMinimapOpen && (
            <MiniMap
              position="bottom-left"
              pannable
              zoomable
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              nodeColor={(n: any) =>
                minimapNodeColor(n?.data?.flow?.kind ?? "action")
              }
              maskColor="hsl(var(--background) / 0.85)"
              nodeStrokeWidth={2}
            />
          )}
          <Panel position="bottom-left" className="export-hide">
            <button
              onClick={() => setIsMinimapOpen((v) => !v)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card/90 shadow text-muted-foreground transition-colors hover:bg-accent hover:text-foreground backdrop-blur-sm"
              title={isMinimapOpen ? "Hide minimap" : "Show minimap"}
              style={{
                /* React Flow panels have margin by default. Pushing it slightly allows it to sit cleanly below/next to the minimap */
                marginLeft: isMinimapOpen ? "4px" : "0", 
                marginBottom: isMinimapOpen ? "4px" : "0"
              }}
            >
              <Map size={14} />
            </button>
          </Panel>
        </ReactFlow>

        {/* Detail panel — absolutely positioned inside the canvas */}
        <DetailPanel
          node={selectedNode}
          onClose={() => dispatch({ type: "select", id: null })}
          onTraceFrom={(id) => dispatch({ type: "trace", from: id })}
          expanded={selectedNode ? expanded.has(selectedNode.id) : false}
          onToggleExpanded={(id) =>
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />
      </div>
    </VizShell>
  );
}

// ── Public export (wraps inner with ReactFlowProvider) ───────────────────────
export function DataFlowGraph(props: DataFlowGraphProps) {
  return (
    <ReactFlowProvider>
      <DataFlowGraphInner {...props} />
    </ReactFlowProvider>
  );
}
