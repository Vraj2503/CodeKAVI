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
import { matches, NARROW_QUERY } from "@/hooks/useMediaQuery";
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

/**
 * Absolute deadline for resolving a repo id into either data or a stated
 * reason. Sits above `restoreRepo`'s own 20s fetch timeout so the specific
 * error wins whenever there is one; this only catches the hangs nothing else
 * can see.
 */
const RESOLVE_CEILING_MS = 25_000;

/**
 * Backoff while the backend rebuilds an analysis (HTTP 202). Mirrors
 * `useRepoGraph`'s ladder so the two surfaces behave identically.
 */
const REANALYSIS_POLL_MS = [1000, 2000, 4000, 8000, 15000, 30000];

/**
 * Total wall-clock a background re-analysis may take before we stop waiting.
 *
 * Needed because a re-analysis that throws is retried by the backend on the
 * *next* request (`session.py` discards the in-progress marker in a `finally`),
 * so a repo that cannot be analyzed answers 202 forever. Without a budget,
 * fixing the 202 parse would just relocate the hang.
 */
const REANALYSIS_BUDGET_MS = 180_000;

const _sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  /** The backend is rebuilding this analysis right now (HTTP 202). */
  isReanalyzing: boolean;
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
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [needsReanalysis, setNeedsReanalysis] = useState(false);
  const [unavailable, setUnavailable] = useState<RepoUnavailable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  // T16/QA-001: the sidebar is a fixed 320px column. At 375px that left the
  // chart canvas **5px wide**. Start collapsed on a narrow viewport so the
  // first paint is the thing the user navigated to. A lazy initializer, not an
  // effect — this repo rejects `set-state-in-effect`, and reading the query
  // once at mount is all that's needed (`Sidebar` handles later resizes by
  // overlaying rather than by re-collapsing under the user).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    matches(NARROW_QUERY),
  );

  // One resolution per repo id *per identity*. The repo id alone would be
  // enough to stop StrictMode's double-invoke from spending two of the
  // endpoint's 30 requests/min — but it would also pin the result of a
  // resolution made before the session arrived, leaving a signed-in user
  // staring at "Sign in to open this analysis". Keying on the user too means a
  // late sign-in re-resolves on its own.
  const resolvedFor = useRef<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const retryLoad = useCallback(() => {
    resolvedFor.current = null;
    setUnavailable(null);
    setRetryNonce((n) => n + 1);
  }, []);

  // Depend on the id, never the `User` object.
  //
  // `auth-context` calls `settle()` from both `getSession()` and
  // `onAuthStateChange`, and Supabase emits `INITIAL_SESSION` on subscribe and
  // `TOKEN_REFRESHED` thereafter — each delivering a *new* User object for the
  // same person. With the object in the dependency array, any of those landing
  // mid-restore re-ran the effect, whose cleanup cancelled the in-flight
  // resolve; the re-run then matched the guard (keyed on the unchanged id) and
  // returned early, leaving no data, no reason and no deadline. A permanent
  // spinner on chat and visualize, while the graph page — which owns its own
  // fetch — carried on working.
  const userId = user?.id ?? null;

  useEffect(() => {
    if (repoData || !repoId) return;
    // Wait for the session to rehydrate — restoring one tick early would send
    // an anonymous request and mislabel a signed-in user as signed out.
    if (authLoading) return;
    const resolveKey = `${repoId}:${userId ?? "anon"}`;
    if (resolvedFor.current === resolveKey) return;
    resolvedFor.current = resolveKey;

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
    let settled = false;
    let ceiling: ReturnType<typeof setTimeout> | undefined;

    /**
     * Ceiling on the whole resolution.
     *
     * T17 promised the spinner always ends, and delivered that by enumerating
     * the failure modes it knew about — which missed the ones where an awaited
     * call never settles at all (a hung `getSession()` inside `restoreRepo`
     * was exactly that). A deadline on the fetch cannot catch a hang that
     * happens before the fetch. This one does not need to know the failure in
     * advance, which is the only kind of guarantee worth making here.
     *
     * Re-armed on every 202, because a 202 is the backend saying precisely
     * what it is doing. That is liveness, and killing a live re-analysis at
     * 25s would be the wrong call; `REANALYSIS_BUDGET_MS` bounds that case.
     *
     * `extraMs` covers a scheduled wait. The backoff reaches 30s, which is
     * longer than the ceiling itself — so without it the deadline fires while
     * we are deliberately asleep between polls, and a perfectly healthy
     * re-analysis gets reported as unreachable.
     */
    const armCeiling = (extraMs = 0) => {
      clearTimeout(ceiling);
      ceiling = setTimeout(() => {
        if (cancelled || settled) return;
        settled = true;
        console.warn("Repo resolution exceeded its deadline; showing recovery.");
        setIsRestoring(false);
        setIsReanalyzing(false);
        setUnavailable({
          reason: "unreachable",
          githubUrl: null,
          repoLabel: stored ? `${stored.owner}/${stored.repo_name}` : null,
          detail: "Timed out while loading this analysis.",
        });
      }, RESOLVE_CEILING_MS + extraMs);
    };

    const resolve = async () => {
      // `/restore` is authenticated. Asking anyway would spend a round trip to
      // be told what we already know, and the recovery is the same either way.
      if (!userId) {
        settled = true;
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
      const giveUpAt = Date.now() + REANALYSIS_BUDGET_MS;
      try {
        for (let attempt = 0; ; attempt++) {
          const result = await restoreRepo(repoId);
          if (cancelled) return;

          // The backend is rebuilding this analysis from the clone on disk.
          // That is a known, self-healing state — not a hang — so wait it out
          // rather than reporting a fault the user cannot act on.
          if (result.status === "re-analyzing") {
            setIsReanalyzing(true);
            if (Date.now() >= giveUpAt) {
              setUnavailable({
                reason: "unreachable",
                githubUrl: null,
                repoLabel: stored ? `${stored.owner}/${stored.repo_name}` : null,
                detail: "Re-analysis did not finish within the time budget.",
              });
              return;
            }
            const wait =
              REANALYSIS_POLL_MS[
                Math.min(attempt, REANALYSIS_POLL_MS.length - 1)
              ];
            // A 202 is proof of life, so the "no idea what's happening"
            // deadline starts over — extended to cover the wait we are about
            // to take. Only `REANALYSIS_BUDGET_MS` bounds this loop.
            armCeiling(wait);
            await _sleep(wait);
            if (cancelled) return;
            continue;
          }

          setIsReanalyzing(false);

          if (result.status === "ok") {
            setRepoData(result.data);
            setNeedsReanalysis(false);
            setUnavailable(null);
            if (stored?.sessionId) setSessionId(stored.sessionId);
            return;
          }

          // Known repo, unusable cache: stay navigable on the metadata already
          // in hand. Chat still works — the embeddings outlive the analysis cache.
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
          return;
        }
      } finally {
        settled = true;
        if (!cancelled) {
          setIsRestoring(false);
          setIsReanalyzing(false);
        }
      }
    };

    armCeiling();
    resolve();

    return () => {
      cancelled = true;
      clearTimeout(ceiling);
      // Release the guard when the work was cancelled before it settled.
      //
      // Without this, a re-run landing on the same resolve key returns early
      // into a dead end: the resolve it would have relied on was cancelled,
      // and nothing is left to finish it. Depending on `userId` removes the
      // known trigger; this makes the whole class impossible, because
      // cancelled work is now always redoable.
      if (!settled) resolvedFor.current = null;
    };
  }, [repoId, repoData, authLoading, userId, retryNonce]);

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
        isReanalyzing,
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
  // `re-analyzing` is excluded on purpose: it is a transient state the caller
  // polls through, never a terminal reason. Letting it in here would put
  // "unavailable" on screen for a repo that is about to load fine.
  result: Exclude<RestoreResult, { status: "ok" | "re-analyzing" }>,
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
