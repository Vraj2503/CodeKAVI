"use client";

import { ReportView } from "@/components/report/ReportView";
import { useRepo } from "@/components/RepoProvider";

export default function ReportPage() {
  const { repoData, needsReanalysis, handleAnalyze } = useRepo();

  if (!repoData) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <p>Loading repository data…</p>
      </div>
    );
  }

  return (
    <ReportView
      repoId={repoData.repo_id}
      repoName={`${repoData.owner}/${repoData.repo_name}`}
      needsReanalysis={needsReanalysis}
      onReanalyze={() => handleAnalyze(repoData.github_url)}
    />
  );
}
