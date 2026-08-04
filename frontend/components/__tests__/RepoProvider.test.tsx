/**
 * Tests for how `RepoProvider` resolves a repo id from the URL.
 *
 * The defect these exist to prevent (QA-002): the effect had three ways in and
 * only two ways out. With no `sessionStorage` metadata and no `?dev=true` it
 * fell off the end, leaving `repoData` null forever behind a spinner that could
 * never resolve — which is every bookmarked link, every shared link, and every
 * reopened tab, since `sessionStorage` dies with the tab.
 *
 * So the invariant under test is: **every path terminates**, in either data or
 * a stated reason.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { RepoProvider, useRepo } from "../RepoProvider";
import { restoreRepo, type AnalyzeResponse } from "@/lib/api";
import { getSessionByRepoId } from "@/lib/sessions";
import { useAuth } from "@/lib/auth-context";

vi.mock("@/lib/api", () => ({ restoreRepo: vi.fn(), analyzeRepo: vi.fn() }));
vi.mock("@/lib/sessions", () => ({
  getSessionByRepoId: vi.fn(),
  createSession: vi.fn(),
}));
vi.mock("@/lib/auth-context", () => ({ useAuth: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

const mockRestore = vi.mocked(restoreRepo);
const mockSessionLookup = vi.mocked(getSessionByRepoId);
const mockAuth = vi.mocked(useAuth);

const SIGNED_IN = {
  user: { id: "u1" },
  session: null,
  loading: false,
  signOut: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function analysis(repoId = "abc123"): AnalyzeResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { success: true, repo_id: repoId, repo_name: "kavi" } as any;
}

/** Renders the provider's terminal state as text so assertions read like the UI. */
function Probe() {
  const { repoData, unavailable, needsReanalysis } = useRepo();
  if (repoData) {
    return (
      <div data-testid="state">
        data:{repoData.repo_name}
        {needsReanalysis ? ":degraded" : ""}
      </div>
    );
  }
  if (unavailable) {
    return (
      <div data-testid="state">
        unavailable:{unavailable.reason}:{unavailable.githubUrl ?? "no-url"}
      </div>
    );
  }
  return <div data-testid="state">resolving</div>;
}

function renderProvider(repoId = "abc123") {
  return render(
    <RepoProvider repoId={repoId}>
      <Probe />
    </RepoProvider>,
  );
}

const state = () => screen.getByTestId("state").textContent;
const settled = () => waitFor(() => expect(state()).not.toBe("resolving"));

beforeEach(() => {
  mockAuth.mockReturnValue(SIGNED_IN);
  mockSessionLookup.mockResolvedValue(null);
  sessionStorage.clear();
});

afterEach(() => {
  // The config has no `globals`, so testing-library's automatic cleanup never
  // registers and mounted trees would stack up across cases.
  cleanup();
  vi.clearAllMocks();
});

// ── Cold load: no session metadata in this tab (the QA-002 case) ──

describe("cold load", () => {
  it("restores straight from the backend cache", async () => {
    mockRestore.mockResolvedValue({ status: "ok", data: analysis() });
    renderProvider();
    await settled();
    expect(state()).toBe("data:kavi");
  });

  it("never leaves the caller resolving when the cache has expired", async () => {
    mockRestore.mockResolvedValue({ status: "expired" });
    renderProvider();
    await settled();
    expect(state()).toBe("unavailable:expired:no-url");
  });

  it("recovers the repo URL from Supabase so re-analysis has a target", async () => {
    mockRestore.mockResolvedValue({ status: "expired" });
    mockSessionLookup.mockResolvedValue({
      repo_id: "abc123",
      repo_name: "kavi",
      owner: "vraj",
      github_url: "https://github.com/vraj/kavi",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    renderProvider();
    await settled();
    expect(state()).toBe("unavailable:expired:https://github.com/vraj/kavi");
  });

  it("reports an unreachable backend as its own state, not as expiry", async () => {
    // Re-analysing cannot fix a server that isn't answering, so the recovery
    // offered has to differ — conflating the two sends users down a dead path.
    mockRestore.mockResolvedValue({ status: "unreachable", detail: "timeout" });
    renderProvider();
    await settled();
    expect(state()).toBe("unavailable:unreachable:no-url");
  });

  it("asks a signed-out visitor to sign in without spending a request", async () => {
    mockAuth.mockReturnValue({ ...SIGNED_IN, user: null });
    renderProvider();
    await settled();
    expect(state()).toBe("unavailable:unauthenticated:no-url");
    expect(mockRestore).not.toHaveBeenCalled();
  });

  it("waits for auth to rehydrate before deciding anybody is signed out", async () => {
    mockAuth.mockReturnValue({ ...SIGNED_IN, user: null, loading: true });
    renderProvider();
    await Promise.resolve();
    expect(state()).toBe("resolving");
    expect(mockRestore).not.toHaveBeenCalled();
  });
});

// ── Warm load: this tab analyzed the repo and kept the metadata ──

describe("with session metadata in the tab", () => {
  const META = {
    repo_id: "abc123",
    repo_name: "kavi",
    owner: "vraj",
    github_url: "https://github.com/vraj/kavi",
    total_files: 12,
    total_size_formatted: "1 KB",
    languages: { TypeScript: 12 },
  };

  const storeMeta = () => {
    sessionStorage.setItem(
      "codekavi-session-meta-abc123",
      JSON.stringify(META),
    );
    sessionStorage.setItem("codekavi-session-abc123", "sess-1");
  };

  it("prefers full analysis data when the cache still has it", async () => {
    storeMeta();
    mockRestore.mockResolvedValue({ status: "ok", data: analysis() });
    renderProvider();
    await settled();
    expect(state()).toBe("data:kavi");
  });

  it("degrades to the stored metadata rather than dead-ending", async () => {
    // Chat outlives the analysis cache — the embeddings are in Zilliz — so a
    // known repo stays navigable instead of showing a recovery screen.
    storeMeta();
    mockRestore.mockResolvedValue({ status: "expired" });
    renderProvider();
    await settled();
    expect(state()).toBe("data:kavi:degraded");
  });

  it("still asks for sign-in when the metadata outlives the session", async () => {
    // Stale metadata is no help if the request is being refused: chat would
    // fail the same way. Degrading here would hide the actual problem.
    storeMeta();
    mockRestore.mockResolvedValue({ status: "unauthenticated" });
    renderProvider();
    await settled();
    expect(state()).toBe("unavailable:unauthenticated:no-url");
  });

  it("falls through to the network when the stored entry is corrupt", async () => {
    sessionStorage.setItem("codekavi-session-meta-abc123", "{not json");
    mockRestore.mockResolvedValue({ status: "ok", data: analysis() });
    renderProvider();
    await settled();
    expect(state()).toBe("data:kavi");
  });
});

// ── Request hygiene ──

describe("resolution guard", () => {
  it("restores once per repo id despite re-renders", async () => {
    // `/restore` is rate limited at 30/min; a duplicate on every render would
    // burn that budget for nothing.
    mockRestore.mockResolvedValue({ status: "ok", data: analysis() });
    const { rerender } = renderProvider();
    rerender(
      <RepoProvider repoId="abc123">
        <Probe />
      </RepoProvider>,
    );
    await settled();
    expect(mockRestore).toHaveBeenCalledTimes(1);
  });
});
