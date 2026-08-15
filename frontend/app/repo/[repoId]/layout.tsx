"use client";

import { Sidebar } from "@/components/Sidebar";
import { RepoProvider, useRepo } from "@/components/RepoProvider";
import { TopNav } from "@/components/TopNav";
import { StatusBar } from "@/components/StatusBar";
import { useParams } from "next/navigation";

function RepoLayoutInner({ children }: { children: React.ReactNode }) {
  const { repoData, isAnalyzing, error, handleAnalyze } =
    useRepo();
  const params = useParams();
  const repoId = params.repoId as string;

  /*
   * The 16px gutter and 16px gap around the panels are gone. On an
   * instrument face the panels butt directly against one another and are
   * separated by a single hairline — floating rounded cards on a
   * background read as a webpage, not a console. Removing the gutter also
   * hands ~32px of width back to the graph canvas.
   */
  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-background">
      <TopNav />
      <div className="relative z-10 flex w-full flex-1 overflow-hidden">
        <Sidebar
          repoData={repoData}
          repoId={repoId}
          isAnalyzing={isAnalyzing}
          onAnalyze={handleAnalyze}
          error={error}
        />
        <main className="grid-field flex min-h-0 flex-1 flex-col overflow-hidden border-l border-border">
          {children}
        </main>
      </div>
      <StatusBar />
    </div>
  );
}

export default function RepoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const repoId = params.repoId as string;

  return (
    <RepoProvider repoId={repoId}>
      <RepoLayoutInner>{children}</RepoLayoutInner>
    </RepoProvider>
  );
}
