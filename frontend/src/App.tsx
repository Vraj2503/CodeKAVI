import { useState, useCallback, useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { ChatPanel } from "./components/ChatPanel";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { ReportView } from "./components/report/ReportView";
import { Toaster, toast } from "sonner";
import { analyzeRepo, type AnalyzeResponse } from "./lib/api";
import { createSession, type Session } from "./lib/sessions";

// ── Dev-mode mock data (skip analysis for UI testing) ──
const DEV_MOCK_DATA: AnalyzeResponse = {
  success: true,
  repo_id: "dev-mock-repo",
  repo_name: "mock-project",
  owner: "dev-user",
  github_url: "https://github.com/dev-user/mock-project",
  total_files: 42,
  total_size: 128000,
  total_size_formatted: "125 KB",
  languages: { TypeScript: 60, CSS: 20, JavaScript: 15, JSON: 5 },
  tree: [],
  files: [],
  file_profiles: [],
  role_summary: { total_files: 42, role_counts: {}, role_distribution: {}, top_files: [], dependency_hubs: [] },
  graph: { nodes: [], edges: [], metadata: { total_nodes: 0, total_edges: 0, connected_nodes: 0, groups: [] } },
  module_graph: { modules: [], connections: [], graph_json: { nodes: [], edges: [] }, mermaid: "" },
  cycles: { has_cycles: false, cycle_count: 0, cycles: [], summary: "No cycles" },
  mermaid: { file_level: "", module_level: "" },
};

export default function App() {
  const [repoData, setRepoData] = useState<AnalyzeResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"chat" | "report">("chat");

  // Dev bypass: add ?dev=true to URL to skip straight to chat UI
  useEffect(() => {
    if (import.meta.env.DEV) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("dev") === "true" && !repoData) {
        console.log("🚀 Dev mode: loading mock data to bypass analysis");
        setRepoData(DEV_MOCK_DATA);
        setActiveSessionId("dev-session");
      }
    }
  }, []);

  const handleAnalyze = useCallback(async (url: string) => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const data = await analyzeRepo(url);
      setRepoData(data);

      // Create a Supabase session
      const session = await createSession({
        repo_id: data.repo_id,
        repo_name: data.repo_name,
        owner: data.owner,
        github_url: data.github_url,
        total_files: data.total_files,
        total_size_formatted: data.total_size_formatted,
        languages: data.languages,
      });

      if (session) {
        setActiveSessionId(session.id);
      }
    } catch (err: any) {
      setError(err.message || "Analysis failed");
      toast.error(err.message || "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleResumeSession = useCallback((session: Session) => {
    // Build a minimal AnalyzeResponse from the session data
    // so Sidebar + ChatPanel can render
    const resumedData: AnalyzeResponse = {
      success: true,
      repo_id: session.repo_id,
      repo_name: session.repo_name,
      owner: session.owner,
      github_url: session.github_url,
      total_files: session.total_files,
      total_size: 0,
      total_size_formatted: session.total_size_formatted,
      languages: session.languages,
      tree: [],
      files: [],
      file_profiles: [],
      role_summary: { total_files: session.total_files, role_counts: {}, role_distribution: {}, top_files: [], dependency_hubs: [] },
      graph: { nodes: [], edges: [], metadata: { total_nodes: 0, total_edges: 0, connected_nodes: 0, groups: [] } },
      module_graph: { modules: [], connections: [], graph_json: { nodes: [], edges: [] }, mermaid: "" },
      cycles: { has_cycles: false, cycle_count: 0, cycles: [], summary: "" },
      mermaid: { file_level: "", module_level: "" },
    };

    setRepoData(resumedData);
    setActiveSessionId(session.id);
  }, []);

  const handleBackToDashboard = useCallback(() => {
    setRepoData(null);
    setActiveSessionId(null);
    setError(null);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background">
      <Toaster theme="dark" position="top-right" />
      {/* Conditionally Render Layout */}
      {!repoData && !isAnalyzing ? (
        <WelcomeScreen
          onAnalyze={handleAnalyze}
          onResumeSession={handleResumeSession}
          isAnalyzing={isAnalyzing}
          error={error}
        />
      ) : (
        <div className="flex w-full h-full p-4 gap-4 bg-background relative z-10">
          <Sidebar
            repoData={repoData}
            isAnalyzing={isAnalyzing}
            onAnalyze={handleAnalyze}
            error={error}
            onBack={handleBackToDashboard}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
          <main className="flex-1 flex flex-col overflow-hidden bg-card/40 backdrop-blur-xl border border-border/50 rounded-2xl shadow-2xl">
            {repoData ? (
              <>
                <div className="flex-1 flex flex-col overflow-hidden" style={{ display: viewMode === 'chat' ? 'flex' : 'none' }}>
                  <ChatPanel
                    repoData={repoData}
                    sessionId={activeSessionId}
                  />
                </div>
                <div className="flex-1 flex flex-col overflow-hidden" style={{ display: viewMode === 'report' ? 'flex' : 'none' }}>
                  <ReportView
                    repoId={repoData.repo_id}
                    repoName={`${repoData.owner}/${repoData.repo_name}`}
                  />
                </div>
              </>
            ) : null}
          </main>
        </div>
      )}
    </div>
  );
}
