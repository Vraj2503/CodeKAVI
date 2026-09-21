/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { DependencyGraph } from "@/components/report/viz/DependencyGraph";
import { ArchitectureGraph } from "@/components/report/viz/ArchitectureGraph";
import { DataFlowGraph } from "@/components/report/viz/DataFlowGraph";
import { RadialMindmap } from "@/components/report/viz/RadialMindmap";
import { TreemapViz } from "@/components/report/viz/TreemapViz";
import { NeuralNetworkViz } from "@/components/report/viz/NeuralNetworkViz";

interface VizContainerProps {
  visualizationType: string;
  visualizationData: unknown;
}

/**
 * T14: these carried emoji (🏗️ 🔗 🧠 🔥 🌊). Emoji-as-design-element is one of
 * the loudest AI-generated tells, and two of the six shared 🧠 anyway, so the
 * decoration was not even distinguishing them. Product language instead — and
 * the treemap's name now matches the chart it labels ("Complexity Treemap",
 * per D1), which "Complexity Heatmap" did not.
 */
const vizTitleMap: Record<string, string> = {
  architecture_graph: "Architecture",
  dependency_graph: "Dependencies",
  radial_mindmap: "Mind Map",
  treemap: "Complexity Treemap",
  flow_diagram: "Data Flow",
  neural_network: "Neural Network Architecture",
};

function renderViz(type: string, data: any) {
  const EmptyViz = ({
    message = "No data available for this visualization.",
  }) => (
    <div className="flex items-center justify-center h-[300px] border border-dashed border-border rounded-xl bg-card/50 text-muted-foreground p-6 text-center">
      <p>{message}</p>
    </div>
  );

  const hasEdgelessNodes = (d: any) =>
    d.nodes?.length > 0 && (!d.edges || d.edges.length === 0);

  switch (type) {
    case "dependency_graph":
      if (!data.nodes || data.nodes.length === 0)
        return (
          <EmptyViz message="Not enough files or dependencies to generate a graph." />
        );
      if (hasEdgelessNodes(data))
        return (
          <EmptyViz message="Dependencies detected but no connections resolved. This may indicate unsupported import syntax." />
        );
      return (
        <DependencyGraph
          nodes={data.nodes}
          edges={data.edges}
          moduleGraph={data.module_graph}
          modules={data.modules}
        />
      );
    case "architecture_graph":
      if (!data.nodes || data.nodes.length === 0)
        return (
          <EmptyViz message="Not enough modular structure to generate an architecture graph." />
        );
      // A V2 diagram can honestly contain an isolated capability. It should
      // still be rendered with its source evidence instead of treated as an
      // error merely because there are no resolved runtime edges.
      return <ArchitectureGraph data={data} />;
    case "flow_diagram":
      if (!data.nodes || data.nodes.length === 0)
        return <EmptyViz message="No entry points found to map data flow." />;
      if (hasEdgelessNodes(data))
        return (
          <EmptyViz message="Entry points detected but no connections resolved. This may indicate unsupported import syntax." />
        );
      return <DataFlowGraph nodes={data.nodes} edges={data.edges} />;
    case "radial_mindmap":
      if (!data.root || !data.root.children || data.root.children.length === 0)
        return (
          <EmptyViz message="Codebase is too small to generate a mind map." />
        );
      return <RadialMindmap root={data.root} />;
    case "treemap":
      if (!data.children || data.children.length === 0)
        return <EmptyViz message="Not enough files to calculate complexity." />;
      return <TreemapViz data={data} />;
    case "neural_network":
      if (!data.models || data.models.length === 0)
        return (
          <EmptyViz message="No neural network found. This view reads PyTorch (nn.Module, nn.Sequential), Keras, TensorFlow and Hugging Face transformers — scikit-learn and gradient-boosting pipelines aren't drawn yet." />
        );
      return <NeuralNetworkViz data={data} />;
    default:
      return (
        <p className="text-muted-foreground text-center py-12">
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
      <h3 className="text-base font-semibold text-foreground mb-4">{title}</h3>
      <div className="w-full overflow-hidden">
        {renderViz(visualizationType, visualizationData)}
      </div>
    </div>
  );
}
