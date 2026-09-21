"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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
  const [selected, setSelected] = useState<ArchitectureNodeData | null>(null);
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

  const nodeColor = useCallback((node: Node) => {
    const kind = (node.data as { kind?: string })?.kind;
    if (kind === "datastore") return "#f59e0b";
    if (kind === "external" || kind === "queue") return "#8b5cf6";
    if (kind === "gateway") return "#60a5fa";
    return "#14b8a6";
  }, []);

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
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, node) => {
          if (node.type === "architectureNode") setSelected(node.data as ArchitectureNodeData);
        }}
        onPaneClick={() => setSelected(null)}
        fitView={false}
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor={nodeColor} maskColor="hsl(var(--background) / 0.82)" />
      </ReactFlow>
      <aside className="absolute bottom-0 right-0 top-0 z-10 w-[min(340px,45%)] border-l border-border bg-background/95 shadow-xl backdrop-blur">
        <ArchitectureInspector node={selected} onClose={() => setSelected(null)} />
      </aside>
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
