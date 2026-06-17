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

function renderViz(type: string, data: unknown) {
  switch (type) {
    case "dependency_graph":
      return <DependencyGraph nodes={data.nodes} edges={data.edges} />;
    case "architecture_graph":
      return <ArchitectureGraph nodes={data.nodes} edges={data.edges} />;
    case "flow_diagram":
      return <DataFlowGraph nodes={data.nodes} edges={data.edges} />;
    case "radial_mindmap":
      return <RadialMindmap root={data.root} />;
    case "treemap":
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
