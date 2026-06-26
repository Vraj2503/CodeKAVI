/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { DependencyGraph } from "@/components/report/viz/DependencyGraph";
import { ArchitectureGraph } from "@/components/report/viz/ArchitectureGraph";
import { DataFlowGraph } from "@/components/report/viz/DataFlowGraph";
import { RadialMindmap } from "@/components/report/viz/RadialMindmap";
import { TreemapViz } from "@/components/report/viz/TreemapViz";

interface VizContainerProps {
  visualizationType: string;
  visualizationData: unknown;
}

const vizTitleMap: Record<string, string> = {
  architecture_graph: "🏗️ Architecture",
  dependency_graph: "🔗 Dependencies",
  radial_mindmap: "🧠 Mind Map",
  treemap: "🔥 Complexity Heatmap",
  flow_diagram: "🌊 Data Flow",
};

function renderViz(type: string, data: any) {
  const EmptyViz = ({ message = "No data available for this visualization." }) => (
    <div className="flex items-center justify-center h-[300px] border border-dashed border-border rounded-xl bg-card/50 text-muted-foreground p-6 text-center">
      <p>{message}</p>
    </div>
  );

  switch (type) {
    case "dependency_graph":
      if (!data.nodes || data.nodes.length === 0) return <EmptyViz message="Not enough files or dependencies to generate a graph." />;
      return <DependencyGraph nodes={data.nodes} edges={data.edges} moduleGraph={data.module_graph} modules={data.modules} />;
    case "architecture_graph":
      if (!data.nodes || data.nodes.length === 0) return <EmptyViz message="Not enough modular structure to generate an architecture graph." />;
      return <ArchitectureGraph nodes={data.nodes} edges={data.edges} />;
    case "flow_diagram":
      if (!data.nodes || data.nodes.length === 0) return <EmptyViz message="No entry points found to map data flow." />;
      return <DataFlowGraph nodes={data.nodes} edges={data.edges} />;
    case "radial_mindmap":
      if (!data.root || !data.root.children || data.root.children.length === 0) return <EmptyViz message="Codebase is too small to generate a mind map." />;
      return <RadialMindmap root={data.root} />;
    case "treemap":
      if (!data.children || data.children.length === 0) return <EmptyViz message="Not enough files to calculate complexity." />;
      return <TreemapViz data={data} />;
    default:
      return (
        <p className="text-[#8b949e] text-center py-12">
          Unknown visualization type: {type}
        </p>
      );
  }
}

export function VizContainer({
  visualizationType,
  visualizationData,
}: VizContainerProps) {
  if (!visualizationType || !visualizationData) return null;

  const title = vizTitleMap[visualizationType] ?? "📊 Visualization";

  return (
    <div className="viz-box mt-6">
      <h3 className="text-base font-semibold text-[#e6edf3] mb-4">{title}</h3>
      <div className="w-full overflow-hidden">
        {renderViz(visualizationType, visualizationData)}
      </div>
    </div>
  );
}
