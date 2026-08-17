"use client";

/**
 * The workspace shell: rail (where am I) · bar (what am I looking at) ·
 * canvas (the work) · inspector (what it's made of).
 *
 * The old shell floated three translucent cards with 2xl shadows on a padded
 * background, which spent ~90px of every axis on gaps and rounded corners and
 * made a dependency graph feel like a widget. Everything is flush now and
 * separated by hairlines, so the canvas gets the whole viewport it needs.
 */

import { RepoProvider, useRepo } from "@/components/RepoProvider";
import { AppRail } from "@/components/shell/AppRail";
import { TopBar } from "@/components/shell/TopBar";
import { Inspector } from "@/components/shell/Inspector";
import { useParams } from "next/navigation";

function RepoLayoutInner({ children }: { children: React.ReactNode }) {
  const {
    repoData,
    isAnalyzing,
    error,
    handleAnalyze,
    sidebarCollapsed,
    setSidebarCollapsed,
  } = useRepo();
  const params = useParams();
  const repoId = params.repoId as string;

  const inspectorOpen = !sidebarCollapsed;

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-background text-foreground">
      <AppRail repoId={repoId} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          repoData={repoData}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setSidebarCollapsed(inspectorOpen)}
        />

        <div className="relative flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </main>

          <Inspector
            open={inspectorOpen}
            repoData={repoData}
            repoId={repoId}
            isAnalyzing={isAnalyzing}
            onAnalyze={handleAnalyze}
            onClose={() => setSidebarCollapsed(true)}
            error={error}
          />
        </div>
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
