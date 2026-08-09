"use client";

import { VisualizationPanel } from "@/components/visualize/VisualizationPanel";
import { useRepo } from "@/components/RepoProvider";
import { RepoStatePanel } from "@/components/RepoStatePanel";

export default function VisualizePage() {
  const { repoData } = useRepo();

  // No data yet, or none coming — RepoStatePanel decides which and says so.
  if (!repoData) return <RepoStatePanel />;

  return (
    <VisualizationPanel
      repoId={repoData.repo_id}
    />
  );
}
