"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { analyzeRepo, type AnalyzeResponse } from "@/lib/api";
import { createSession, type Session } from "@/lib/sessions";
import { toast } from "sonner";

interface RepoContextValue {
  repoData: AnalyzeResponse | null;
  isAnalyzing: boolean;
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
 */
export function RepoProvider({ children, repoId }: RepoProviderProps) {
  const [repoData, setRepoData] = useState<AnalyzeResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Hydrate from sessionStorage — bridges data from WelcomeScreen → repo route
  useEffect(() => {
    if (repoData || !repoId) return;

    // 1. Check for full analysis data (from fresh analysis)
    const storedRepo = sessionStorage.getItem(`codekavi-repo-${repoId}`);
    if (storedRepo) {
      try {
        const parsed = JSON.parse(storedRepo);
        setRepoData(parsed);
        const storedSessionId = sessionStorage.getItem(`codekavi-session-${repoId}`);
        if (storedSessionId) setSessionId(storedSessionId);
        return;
      } catch {
        console.warn("Failed to parse stored repo data");
      }
    }

    // 2. Check for session metadata (from resumed session)
    const storedMeta = sessionStorage.getItem(`codekavi-session-meta-${repoId}`);
    if (storedMeta) {
      try {
        const session = JSON.parse(storedMeta);
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
        setRepoData(resumedData);
        const storedSessionId = sessionStorage.getItem(`codekavi-session-${repoId}`);
        if (storedSessionId) setSessionId(storedSessionId);
        return;
      } catch {
        console.warn("Failed to parse stored session metadata");
      }
    }

    // 3. Dev bypass: add ?dev=true to URL to skip straight to chat UI
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
        metadata: {
          total_nodes: 0,
          total_edges: 0,
          connected_nodes: 0,
          groups: [],
        },
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

    setRepoData(resumedData);
    setSessionId(session.id);
  }, []);

  const handleBackToDashboard = useCallback(() => {
    setRepoData(null);
    setSessionId(null);
    setError(null);
  }, []);

  return (
    <RepoContext.Provider
      value={{
        repoData,
        isAnalyzing,
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
