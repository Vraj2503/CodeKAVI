"use client";

import { VisualizationPanel } from "@/components/visualize/VisualizationPanel";
import { useRepo } from "@/components/RepoProvider";

export default function VisualizePage() {
  const { repoData } = useRepo();

  if (!repoData) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>Loading repository data…</p>
      </div>
    );
  }

  return (
    <VisualizationPanel
      repoId={repoData.repo_id}
    />
  );
}
