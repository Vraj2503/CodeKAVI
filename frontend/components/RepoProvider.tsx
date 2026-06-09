"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { analyzeRepo, restoreRepo, type AnalyzeResponse } from "@/lib/api";
import { createSession, type Session } from "@/lib/sessions";
import { toast } from "sonner";

interface RepoContextValue {
  repoData: AnalyzeResponse | null;
  isAnalyzing: boolean;
  isRestoring: boolean;
  needsReanalysis: boolean;
  error: string | null;
  sessionId: string | null;
  handleAnalyze: (url: string) => Promise<void>;
  handleResumeSession: (session: Session) => void;
  handleBackToDashboard: () => void;
}

const RepoContext = createContext<RepoContextValue | null>(null);

export function useRepo() {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new Error("useRepo must be used within a RepoProvider");
  }
  return ctx;
}

interface RepoProviderProps {
  children: ReactNode;
  repoId?: string;
}

/**
 * Provides repo analysis state and actions to the component tree.
 * Wraps the repo layout to share data between Sidebar, ChatPanel, ReportView, etc.
 *
 * On session resume, attempts to restore full analysis data from the backend's
 * 3-tier cache (in-memory → Redis → Supabase). If the cache misses, shows a
 * "re-analyze" prompt instead of empty data.
 */
export function RepoProvider({ children, repoId }: RepoProviderProps) {
  const [repoData, setRepoData] = useState<AnalyzeResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [needsReanalysis, setNeedsReanalysis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Hydrate from sessionStorage — bridges data from WelcomeScreen → repo route
  useEffect(() => {
    if (repoData || !repoId) return;

    // Check for session metadata (from fresh analysis or resumed session)
    const storedMeta = sessionStorage.getItem(`codekavi-session-meta-${repoId}`);
    if (storedMeta) {
      try {
        const session = JSON.parse(storedMeta);
        const storedSessionId = sessionStorage.getItem(`codekavi-session-${repoId}`);

        // Try to restore full analysis data from backend cache
        setIsRestoring(true);
        restoreRepo(session.repo_id).then((restored) => {
          if (restored) {
            // Cache hit — use full analysis data
            setRepoData(restored);
            setNeedsReanalysis(false);
          } else {
            // Cache miss — use session metadata but flag for re-analysis
            setRepoData(_buildMinimalRepoData(session));
            setNeedsReanalysis(true);
            toast.info(
              "Analysis data has expired. Some features may be limited until you re-analyze.",
              { duration: 6000 }
            );
          }
          if (storedSessionId) setSessionId(storedSessionId);
          setIsRestoring(false);
        }).catch(() => {
          // Network error — degrade gracefully
          setRepoData(_buildMinimalRepoData(session));
          setNeedsReanalysis(true);
          if (storedSessionId) setSessionId(storedSessionId);
          setIsRestoring(false);
        });

        return;
      } catch {
        console.warn("Failed to parse stored session metadata");
      }
    }

    // Dev bypass: add ?dev=true to URL to skip straight to chat UI
    if (process.env.NODE_ENV === "development") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("dev") === "true") {
        console.log("🚀 Dev mode: loading mock data to bypass analysis");
        setRepoData({
          success: true,
          repo_id: repoId || "dev-mock-repo",
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
          role_summary: {
            total_files: 42,
            role_counts: {},
            role_distribution: {},
            top_files: [],
            dependency_hubs: [],
          },
          graph: {
            nodes: [],
            edges: [],
            metadata: { total_nodes: 0, total_edges: 0, connected_nodes: 0, groups: [] },
          },
          module_graph: {
            modules: [],
            connections: [],
            graph_json: { nodes: [], edges: [] },
            mermaid: "",
          },
          cycles: { has_cycles: false, cycle_count: 0, cycles: [], summary: "No cycles" },
          mermaid: { file_level: "", module_level: "" },
        });
        setSessionId("dev-session");
      }
    }
  }, [repoId, repoData]);

  const handleAnalyze = useCallback(async (url: string) => {
    setIsAnalyzing(true);
    setError(null);
    setNeedsReanalysis(false);
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
        setSessionId(session.id);
      }
    } catch (err: any) {
      setError(err.message || "Analysis failed");
      toast.error(err.message || "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleResumeSession = useCallback((session: Session) => {
    // Try to restore full data from backend cache
    setIsRestoring(true);
    setNeedsReanalysis(false);

    restoreRepo(session.repo_id).then((restored) => {
      if (restored) {
        setRepoData(restored);
        setNeedsReanalysis(false);
      } else {
        // Cache miss — use minimal data, flag for re-analysis
        setRepoData(_buildMinimalRepoData(session));
        setNeedsReanalysis(true);
        toast.info(
          "Analysis data has expired. Chat is still available, but visualizations need a re-analysis.",
          { duration: 6000 }
        );
      }
      setSessionId(session.id);
      setIsRestoring(false);
    }).catch(() => {
      setRepoData(_buildMinimalRepoData(session));
      setNeedsReanalysis(true);
      setSessionId(session.id);
      setIsRestoring(false);
    });
  }, []);

  const handleBackToDashboard = useCallback(() => {
    setRepoData(null);
    setSessionId(null);
    setError(null);
    setNeedsReanalysis(false);
  }, []);

  return (
    <RepoContext.Provider
      value={{
        repoData,
        isAnalyzing,
        isRestoring,
        needsReanalysis,
        error,
        sessionId,
        handleAnalyze,
        handleResumeSession,
        handleBackToDashboard,
      }}
    >
      {children}
    </RepoContext.Provider>
  );
}

/**
 * Build a minimal AnalyzeResponse from session metadata (for when cache misses).
 * Chat still works (Zilliz has the embeddings), but visualizations will be empty.
 */
function _buildMinimalRepoData(session: {
  repo_id: string;
  repo_name: string;
  owner: string;
  github_url: string;
  total_files: number;
  total_size_formatted: string;
  languages: Record<string, number>;
}): AnalyzeResponse {
  return {
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
    role_summary: {
      total_files: session.total_files,
      role_counts: {},
      role_distribution: {},
      top_files: [],
      dependency_hubs: [],
    },
    graph: {
      nodes: [],
      edges: [],
      metadata: { total_nodes: 0, total_edges: 0, connected_nodes: 0, groups: [] },
    },
    module_graph: {
      modules: [],
      connections: [],
      graph_json: { nodes: [], edges: [] },
      mermaid: "",
    },
    cycles: { has_cycles: false, cycle_count: 0, cycles: [], summary: "" },
    mermaid: { file_level: "", module_level: "" },
  };
}
