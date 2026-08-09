"use client";

import { ReportView } from "@/components/report/ReportView";
import { useRepo } from "@/components/RepoProvider";
import { RepoStatePanel } from "@/components/RepoStatePanel";

export default function ReportPage() {
  const { repoData, needsReanalysis, handleAnalyze } = useRepo();

  // No data yet, or none coming — RepoStatePanel decides which and says so.
  if (!repoData) return <RepoStatePanel />;

  return (
    <ReportView
      repoId={repoData.repo_id}
      repoName={`${repoData.owner}/${repoData.repo_name}`}
      needsReanalysis={needsReanalysis}
      onReanalyze={() => handleAnalyze(repoData.github_url)}
    />
  );
}
