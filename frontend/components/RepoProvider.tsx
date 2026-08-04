"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  analyzeRepo,
  restoreRepo,
  type AnalyzeResponse,
  type RestoreResult,
} from "@/lib/api";
import {
  createSession,
  getSessionByRepoId,
  type Session,
} from "@/lib/sessions";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

/**
 * Why a repo page has nothing to render, after every avenue is exhausted.
 *
 * This is the state that used to not exist. `sessionStorage` is per-tab and
 * dies with it, so a bookmarked URL, a shared link or a reopened tab reached
 * the provider with no metadata and no dev flag — and the resolving effect
 * simply ran out of branches, leaving `repoData` null forever behind a
 * permanent "Loading repository data…" (QA-002). Each reason below maps to a
 * different recovery, which is why the distinction is carried this far up.
 */
export interface RepoUnavailable {
  reason: "expired" | "unauthenticated" | "unreachable";
  /** Set when we could still work out which repository this URL meant. */
  githubUrl: string | null;
  /** `owner/name`, so copy can name the repo rather than its opaque id. */
  repoLabel: string | null;
  /** Transport detail for `unreachable` — logged, never rendered raw. */
  detail?: string;
}

/** The lightweight repo identifiers a session carries; never the analysis itself. */
interface SessionMeta {
  repo_id: string;
  repo_name: string;
  owner: string;
  github_url: string;
  total_files: number;
  total_size_formatted: string;
  languages: Record<string, number>;
}

interface RepoContextValue {
  repoData: AnalyzeResponse | null;
  isAnalyzing: boolean;
  isRestoring: boolean;
  needsReanalysis: boolean;
  /** Non-null once the repo is known to be unloadable. Renders a recovery, not a spinner. */
  unavailable: RepoUnavailable | null;
  error: string | null;
  sessionId: string | null;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  handleAnalyze: (url: string) => Promise<AnalyzeResponse | null>;
  handleResumeSession: (session: Session) => void;
  handleBackToDashboard: () => void;
  /** Re-run resolution from scratch — the action behind "Try again". */
  retryLoad: () => void;
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
 * Resolution order for a repo id in the URL:
 *   1. `?dev=true` in development — mock data, no network.
 *   2. This tab's `sessionStorage` metadata, written when the analysis ran.
 *   3. A cold restore straight from the backend's 3-tier cache.
 * Every one of those ends in either data or an explicit `unavailable` reason.
 */
export function RepoProvider({ children, repoId }: RepoProviderProps) {
  const { user, loading: authLoading } = useAuth();
  const [repoData, setRepoData] = useState<AnalyzeResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [needsReanalysis, setNeedsReanalysis] = useState(false);
  const [unavailable, setUnavailable] = useState<RepoUnavailable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // One resolution per repo id. Without it, StrictMode's double-invoke — and
  // any re-render landing before the fetch settles — fires a second restore
  // against a 30/min rate limit.
  const resolvedFor = useRef<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const retryLoad = useCallback(() => {
    resolvedFor.current = null;
    setUnavailable(null);
    setRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (repoData || !repoId) return;
    // Wait for the session to rehydrate — restoring one tick early would send
    // an anonymous request and mislabel a signed-in user as signed out.
    if (authLoading) return;
    if (resolvedFor.current === repoId) return;
    resolvedFor.current = repoId;

    // Dev bypass: add ?dev=true to the URL to skip straight to the UI.
    if (process.env.NODE_ENV === "development" && _hasDevFlag()) {
      console.log("🚀 Dev mode: loading mock data to bypass analysis");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRepoData(_buildDevRepoData(repoId));
      setSessionId("dev-session");
      return;
    }

    const stored = _readStoredSession(repoId);
    let cancelled = false;

    const resolve = async () => {
      // `/restore` is authenticated. Asking anyway would spend a round trip to
      // be told what we already know, and the recovery is the same either way.
      if (!user) {
        if (!cancelled) {
          setUnavailable({
            reason: "unauthenticated",
            githubUrl: null,
            repoLabel: stored ? `${stored.owner}/${stored.repo_name}` : null,
          });
        }
        return;
      }

      setIsRestoring(true);
      try {
        const result = await restoreRepo(repoId);
        if (cancelled) return;

        if (result.status === "ok") {
          setRepoData(result.data);
          setNeedsReanalysis(false);
          setUnavailable(null);
          if (stored?.sessionId) setSessionId(stored.sessionId);
          return;
        }

        // Known repo, unusable cache: stay navigable on the metadata already in
        // hand. Chat still works — the embeddings outlive the analysis cache.
        if (stored && result.status !== "unauthenticated") {
          setRepoData(_buildMinimalRepoData(stored));
          setNeedsReanalysis(true);
          if (stored.sessionId) setSessionId(stored.sessionId);
          toast.info(
            "Analysis data has expired. Some features may be limited until you re-analyze.",
            { duration: 6000 },
          );
          return;
        }

        // Nothing in this tab and nothing in the cache — the dead end this
        // branch exists to end. Name the repo if Supabase still remembers it,
        // because a re-analyze button needs a URL to re-analyze.
        setUnavailable(await _describeUnavailable(result, repoId));
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [repoId, repoData, authLoading, user, retryNonce]);

  const handleAnalyze = useCallback(async (url: string) => {
    setIsAnalyzing(true);
    setError(null);
    setNeedsReanalysis(false);
    try {
      const data = await analyzeRepo(url);
      setRepoData(data);
      setUnavailable(null);

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
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Analysis failed";
      setError(msg);
      toast.error(msg);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  const handleResumeSession = useCallback((session: Session) => {
    // Try to restore full data from backend cache
    setIsRestoring(true);
    setNeedsReanalysis(false);

    restoreRepo(session.repo_id)
      .then((result) => {
        if (result.status === "ok") {
          setRepoData(result.data);
          setNeedsReanalysis(false);
          setUnavailable(null);
        } else {
          // Cache miss — use minimal data, flag for re-analysis
          setRepoData(_buildMinimalRepoData(session));
          setNeedsReanalysis(true);
          toast.info(
            "Analysis data has expired. Chat is still available, but visualizations need a re-analysis.",
            { duration: 6000 },
          );
        }
        setSessionId(session.id);
        setIsRestoring(false);
      })
      .catch(() => {
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
    setUnavailable(null);
    // Clearing the data without clearing the guard would leave the next repo
    // page unresolvable — the one dead end this provider must never re-create.
    resolvedFor.current = null;
  }, []);

  return (
    <RepoContext.Provider
      value={{
        repoData,
        isAnalyzing,
        isRestoring,
        needsReanalysis,
        unavailable,
        error,
        sessionId,
        sidebarCollapsed,
        setSidebarCollapsed,
        handleAnalyze,
        handleResumeSession,
        handleBackToDashboard,
        retryLoad,
      }}
    >
      {children}
    </RepoContext.Provider>
  );
}

/** `?dev=true` on the current URL. Read lazily so SSR never touches `window`. */
function _hasDevFlag(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("dev") === "true";
}

/** This tab's session metadata for `repoId`, written when the analysis ran. */
function _readStoredSession(
  repoId: string,
): (SessionMeta & { sessionId: string | null }) | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(`codekavi-session-meta-${repoId}`);
  if (!raw) return null;
  try {
    return {
      ...(JSON.parse(raw) as SessionMeta),
      sessionId: sessionStorage.getItem(`codekavi-session-${repoId}`),
    };
  } catch {
    // Corrupt entry: fall through to the cold restore rather than dead-ending.
    console.warn("Failed to parse stored session metadata");
    return null;
  }
}

/**
 * Turn a failed restore into something a person can act on.
 *
 * The Supabase lookup is what buys the actionable path: it recovers the
 * `github_url` behind an opaque repo id, so "Re-analyze" has somewhere to point.
 */
async function _describeUnavailable(
  result: Exclude<RestoreResult, { status: "ok" }>,
  repoId: string,
): Promise<RepoUnavailable> {
  if (result.status === "unauthenticated") {
    return { reason: "unauthenticated", githubUrl: null, repoLabel: null };
  }

  const session = await getSessionByRepoId(repoId).catch(() => null);
  return {
    reason: result.status,
    githubUrl: session?.github_url ?? null,
    repoLabel: session ? `${session.owner}/${session.repo_name}` : null,
    detail: result.status === "unreachable" ? result.detail : undefined,
  };
}

/**
 * Build a minimal AnalyzeResponse from session metadata (for when cache misses).
 * Chat still works (Zilliz has the embeddings), but visualizations will be empty.
 */
function _buildMinimalRepoData(session: SessionMeta): AnalyzeResponse {
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
}

/** Placeholder repo shell for `?dev=true`; the visualizations serve their own mocks. */
function _buildDevRepoData(repoId: string): AnalyzeResponse {
  return {
    ..._buildMinimalRepoData({
      repo_id: repoId || "dev-mock-repo",
      repo_name: "mock-project",
      owner: "dev-user",
      github_url: "https://github.com/dev-user/mock-project",
      total_files: 42,
      total_size_formatted: "125 KB",
      languages: { TypeScript: 60, CSS: 20, JavaScript: 15, JSON: 5 },
    }),
    total_size: 128000,
    cycles: {
      has_cycles: false,
      cycle_count: 0,
      cycles: [],
      summary: "No cycles",
    },
  };
}
