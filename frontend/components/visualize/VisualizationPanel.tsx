"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  GitBranch,
  BarChart3,
  Layers,
  ArrowRightLeft,
  Brain
} from "lucide-react";
import { useVisualization } from "@/hooks/useVisualization";
import { useExplanation } from "@/hooks/useExplanation";
import { FocusedVisualization } from "./FocusedVisualization";
import type { VizType } from "@/lib/api";

interface VisualizationPanelProps {
  repoId: string;
  repoName?: string;
}

export type VizConfigItem = {
  type: VizType;
  label: string;
  description: string;
  icon: any;
};

export const VIZ_CONFIG: VizConfigItem[] = [
  { type: "dependencies", label: "Dependency Graph", description: "Visualize file-to-file import relationships and identify dependency hubs.", icon: GitBranch },
  { type: "complexity", label: "Complexity Treemap", description: "Heatmap of file complexity by importance score — spot maintenance hotspots.", icon: BarChart3 },
  { type: "architecture", label: "Architecture Graph", description: "Module-level architecture showing how directories depend on each other.", icon: Layers },
  { type: "dataflow", label: "Data Flow Diagram", description: "Trace data flow from entry points through the system layers.", icon: ArrowRightLeft },
  { type: "mindmap", label: "Mind Map", description: "Radial mind map of the codebase structure, categories, and patterns.", icon: Brain },
];

export function VisualizationPanel({ repoId, repoName }: VisualizationPanelProps) {
  const searchParams = useSearchParams();
  const activeViz = (searchParams.get("type") as VizType) || "dependencies";
  
  const { generate, getState } = useVisualization(repoId);
  const { explain, getExplanation } = useExplanation(repoId);
  
  // Controls the sliding AI Explanation right panel
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);

  const activeConfig = VIZ_CONFIG.find((c) => c.type === activeViz) || VIZ_CONFIG[0];
  const activeState = getState(activeViz);
  const activeExplanationState = getExplanation(activeViz);

  return (
    <div className="flex h-full w-full bg-background">
      {/* Main Content Area */}
      <div className="flex-1 flex bg-background relative shadow-inner">
        <FocusedVisualization
          type={activeViz}
          config={activeConfig}
          state={activeState}
          explanationState={activeExplanationState}
          onGenerate={() => generate(activeViz)}
          onRefresh={() => generate(activeViz, true)}
          onExplain={() => {
            setIsExplanationOpen(true);
            explain(activeViz);
          }}
          isExplanationOpen={isExplanationOpen}
          toggleExplanation={() => setIsExplanationOpen(!isExplanationOpen)}
        />
      </div>
    </div>
  );
}

