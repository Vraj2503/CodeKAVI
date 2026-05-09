import { ArchitectureGraph } from "./ArchitectureGraph";
import { RadialMindmap } from "./RadialMindmap";
import { TreemapViz } from "./TreemapViz";

interface VizContainerProps {
  visualizationType: string;
  visualizationData: any;
}

const vizTitleMap: Record<string, string> = {
  architecture_graph: "🏗️ Architecture",
  dependency_graph: "🔗 Dependencies",
  radial_mindmap: "🧠 Mind Map",
  treemap: "🔥 Complexity Heatmap",
  flow_diagram: "🌊 Data Flow",
};

function renderViz(type: string, data: any) {
  switch (type) {
    case "architecture_graph":
    case "dependency_graph":
      return <ArchitectureGraph nodes={data.nodes} edges={data.edges} />;
    case "flow_diagram":
      return <ArchitectureGraph nodes={data.nodes} edges={data.edges} />;
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
