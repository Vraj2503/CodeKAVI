"use client";

import { useEffect, useMemo, useState } from "react";
import { PanelRight, PanelRightClose } from "lucide-react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import ArchitectureEdge from "./ArchitectureEdge";
import { ArchitectureInspector } from "./ArchitectureInspector";
import { ArchitectureGroupNode, ArchitectureNode } from "./ArchitectureNode";
import { layoutArchitectureGraph } from "./layout";
import type { ArchitectureGraphData, ArchitectureNodeData } from "./types";

const nodeTypes = { architectureNode: ArchitectureNode, architectureGroup: ArchitectureGroupNode };
const edgeTypes = { architectureEdge: ArchitectureEdge };

function ArchitectureGraphCanvas({ data }: { data: ArchitectureGraphData }) {
  const flow = useReactFlow();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  // Tracks the data snapshot the current layout was measured for, so a new
  // graph always gets a fresh estimate→measure cycle without resetting state
  // synchronously inside an effect.
  const [measuredFor, setMeasuredFor] = useState<ArchitectureGraphData | null>(null);
  const [selected, setSelected] = useState<ArchitectureNodeData | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    layoutArchitectureGraph(data)
      .then((layout) => {
        if (cancelled) return;
        setNodes(layout.nodes);
        setEdges(layout.edges);
        requestAnimationFrame(() => flow.fitView({ padding: 0.14, duration: 0 }));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not lay out this architecture.");
      });
    return () => { cancelled = true; };
  }, [data, flow]);

  // Second pass: ELK laid out estimated card heights, but real cards render
  // taller (wrapped summaries, tech pills), which leaves routed edges and
  // labels behind the actual boxes. Once the estimated layout has painted,
  // measure every capability card in the DOM and re-layout with honest
  // heights so channels and anchor points match what is on screen.
  useEffect(() => {
    if (measuredFor === data || nodes.length === 0) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      const heights: Record<string, number> = {};
      document
        .querySelectorAll<HTMLElement>(".react-flow__node-architectureNode")
        .forEach((el) => {
          const id = el.getAttribute("data-id");
          const height = el.getBoundingClientRect().height;
          if (id && height > 0) heights[id] = Math.ceil(height);
        });
      if (Object.keys(heights).length === 0) {
        setMeasuredFor(data);
        return;
      }
      layoutArchitectureGraph(data, heights)
        .then((layout) => {
          if (cancelled) return;
          setNodes(layout.nodes);
          setEdges(layout.edges);
          setMeasuredFor(data);
          requestAnimationFrame(() => flow.fitView({ padding: 0.14, duration: 0 }));
        })
        .catch(() => setMeasuredFor(data));
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [measuredFor, nodes, data, flow]);

  const summary = useMemo(() => {
    const suffix = data.collapsed.length ? `, ${data.collapsed.length} collapsed group${data.collapsed.length === 1 ? "" : "s"}` : "";
    return `${data.nodes.length} capabilities, ${data.edges.length} connections${suffix}`;
  }, [data]);

  if (error) return <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">{error}</div>;

  return (
    <div className="relative h-full min-h-[560px] w-full overflow-hidden rounded-xl border border-border bg-background">
      <div className="absolute left-4 top-4 z-10 rounded-md border border-border bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
        {summary}. Select a capability for evidence.
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ markerEnd: undefined }}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, node) => {
          if (node.type === "architectureNode") {
            setSelected(node.data as ArchitectureNodeData);
            setInspectorOpen(true);
          }
        }}
        onPaneClick={() => setSelected(null)}
        fitView={false}
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls className="architecture-flow-controls" showInteractive={false} />
      </ReactFlow>
      <button
        type="button"
        aria-label={inspectorOpen ? "Collapse inspector" : "Expand inspector"}
        aria-expanded={inspectorOpen}
        onClick={() => setInspectorOpen((open) => !open)}
        className="absolute right-3 top-3 z-20 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
      </button>
      {inspectorOpen && (
        <aside className="absolute bottom-0 right-0 top-0 z-10 w-[min(340px,45%)] border-l border-border bg-background/95 shadow-xl backdrop-blur">
          <ArchitectureInspector node={selected} onClose={() => setSelected(null)} />
        </aside>
      )}
    </div>
  );
}

export function ArchitectureGraphV2({ data }: { data: ArchitectureGraphData }) {
  return (
    <ReactFlowProvider>
      <ArchitectureGraphCanvas data={data} />
    </ReactFlowProvider>
  );
}
