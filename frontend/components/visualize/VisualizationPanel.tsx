"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch,
  BarChart3,
  Layers,
  ArrowRightLeft,
  Brain,
  Sparkles,
} from "lucide-react";
import { useVisualization, type VizState } from "@/hooks/useVisualization";
import { useExplanation } from "@/hooks/useExplanation";
import { VisualizationCard } from "./VisualizationCard";
import type { VizType } from "@/lib/api";

interface VisualizationPanelProps {
  repoId: string;
  repoName?: string;
}

const VIZ_CONFIG: {
  type: VizType;
  label: string;
  description: string;
  icon: typeof GitBranch;
}[] = [
  {
    type: "dependencies",
    label: "Dependency Graph",
    description:
      "Visualize file-to-file import relationships and identify dependency hubs.",
    icon: GitBranch,
  },
  {
    type: "complexity",
    label: "Complexity Treemap",
    description:
      "Heatmap of file complexity by importance score — spot maintenance hotspots.",
    icon: BarChart3,
  },
  {
    type: "architecture",
    label: "Architecture Graph",
    description:
      "Module-level architecture showing how directories depend on each other.",
    icon: Layers,
  },
  {
    type: "dataflow",
    label: "Data Flow Diagram",
    description:
      "Trace data flow from entry points through the system layers.",
    icon: ArrowRightLeft,
  },
  {
    type: "mindmap",
    label: "Mind Map",
    description:
      "Radial mind map of the codebase structure, categories, and patterns.",
    icon: Brain,
  },
];

export function VisualizationPanel({
  repoId,
  repoName,
}: VisualizationPanelProps) {
  const { generate, getState } = useVisualization(repoId);
  const { explain, getExplanation } = useExplanation(repoId);
  const [includeExplanation, setIncludeExplanation] = useState(false);

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Sparkles size={20} className="text-foreground" />
              Visualization Studio
            </h1>
            {repoName && (
              <p className="text-sm text-muted-foreground mt-0.5">{repoName}</p>
            )}
          </div>

          {/* Global toggle: Include AI Explanation */}
          <div className="flex items-center gap-3">
            <label
              htmlFor="include-explanation"
              className="text-sm text-muted-foreground cursor-pointer select-none"
            >
              Include AI Explanation
            </label>
            <button
              id="include-explanation"
              role="switch"
              aria-checked={includeExplanation}
              onClick={() => setIncludeExplanation(!includeExplanation)}
              className={`
                relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200
                ${includeExplanation ? "bg-foreground" : "bg-muted"}
              `}
            >
              <span
                className={`
                  inline-block h-4 w-4 transform rounded-full bg-background transition-transform duration-200
                  ${includeExplanation ? "translate-x-6" : "translate-x-1"}
                `}
              />
            </button>
          </div>
        </div>

        {/* Token savings info */}
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-foreground" />
          <span>
            On-demand generation — visualizations use static metadata (zero LLM
            tokens)
          </span>
        </div>
      </div>

      {/* Visualization Grid */}
      <div className="px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {VIZ_CONFIG.map((viz, i) => (
            <motion.div
              key={viz.type}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
            >
              <VisualizationCard
                type={viz.type}
                label={viz.label}
                description={viz.description}
                icon={viz.icon}
                state={getState(viz.type)}
                explanationState={getExplanation(viz.type)}
                onGenerate={() => generate(viz.type)}
                onRefresh={() => generate(viz.type, true)}
                onExplain={() => explain(viz.type)}
                includeExplanation={includeExplanation}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
