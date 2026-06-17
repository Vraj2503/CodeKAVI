"use client";

import { Sidebar } from "@/components/Sidebar";
import { RepoProvider, useRepo } from "@/components/RepoProvider";
import { TopNav } from "@/components/TopNav";
import { useParams } from "next/navigation";

function RepoLayoutInner({ children }: { children: React.ReactNode }) {
  const { repoData, isAnalyzing, error, handleAnalyze } =
    useRepo();
  const params = useParams();
  const repoId = params.repoId as string;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
      <TopNav />
      <div className="flex w-full flex-1 p-4 gap-4 bg-background relative z-10 overflow-hidden">
        <Sidebar
          repoData={repoData}
          repoId={repoId}
          isAnalyzing={isAnalyzing}
          onAnalyze={handleAnalyze}
          error={error}
        />
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden bg-card/40 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl">
          {children}
        </main>
      </div>
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
