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
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
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
  // Unconditionally, not at the end of each fake-timer test: an assertion that
  // throws would otherwise skip the restore and leave fake timers installed
  // for every case after it, where `waitFor` then hangs until the 5s timeout.
  // One real failure was reporting itself as four.
  vi.useRealTimers();
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

describe("hangs, not just failures", () => {
  it("ends the spinner even when the restore never settles at all", async () => {
    // The gap that shipped in T17: the fetch carried a 20s AbortSignal, but
    // `restoreRepo` awaits `getSession()` *before* that fetch, and a hung
    // session read is invisible to it. The promise below models that — it
    // never resolves or rejects, so nothing downstream can ever fire.
    vi.useFakeTimers();
    mockRestore.mockReturnValue(new Promise(() => {}));

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(26_000);
    });

    expect(state()).toBe("unavailable:unreachable:no-url");
    vi.useRealTimers();
  });

  it("re-resolves when the session lands after the first pass", async () => {
    // Auth now falls back to signed-out rather than waiting forever, so a slow
    // session can arrive after resolution already concluded "not signed in".
    // Keying the guard on the user is what lets that correct itself.
    mockAuth.mockReturnValue({ ...SIGNED_IN, user: null });
    mockRestore.mockResolvedValue({ status: "ok", data: analysis() });

    const { rerender } = renderProvider();
    await settled();
    expect(state()).toBe("unavailable:unauthenticated:no-url");

    mockAuth.mockReturnValue(SIGNED_IN);
    rerender(
      <RepoProvider repoId="abc123">
        <Probe />
      </RepoProvider>,
    );

    await waitFor(() => expect(state()).toBe("data:kavi"));
  });
});

// ── The backend is rebuilding the analysis (HTTP 202) ──

describe("re-analysis in progress", () => {
  it("waits it out and loads the repo when it finishes", async () => {
    // `/restore` answers 202 while a background thread rebuilds the analysis
    // from the clone on disk. It is transient and self-healing, so the right
    // behaviour is to poll — not to report a failure the user cannot act on.
    vi.useFakeTimers();
    mockRestore
      .mockResolvedValueOnce({ status: "re-analyzing" })
      .mockResolvedValueOnce({ status: "re-analyzing" })
      .mockResolvedValue({ status: "ok", data: analysis() });

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(state()).toBe("data:kavi");
    expect(mockRestore).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("does not mistake the 202 body for a loaded repo", async () => {
    // The original defect in one assertion: a 202 read as success produced a
    // truthy `repoData` with no `repo_id`, so pages rendered as if loaded.
    vi.useFakeTimers();
    mockRestore.mockResolvedValue({ status: "re-analyzing" });

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(state()).not.toContain("data:");
    vi.useRealTimers();
  });

  it("gives up once the re-analysis outruns its budget", async () => {
    // A re-analysis that throws is respawned by the backend on the next
    // request, so a repo that cannot be analyzed answers 202 forever. Without
    // a budget, fixing the parse would just relocate the hang.
    vi.useFakeTimers();
    mockRestore.mockResolvedValue({ status: "re-analyzing" });

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200_000);
    });

    expect(state()).toBe("unavailable:unreachable:no-url");
    vi.useRealTimers();
  });

  it("keeps the deadline alive while the backend is demonstrably working", async () => {
    // The 25s ceiling exists for "we have no idea what is happening". A 202 is
    // the opposite of that, so it re-arms rather than firing mid-rebuild.
    vi.useFakeTimers();
    mockRestore.mockResolvedValue({ status: "re-analyzing" });

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // Well past the ceiling, still inside the budget: no premature recovery.
    expect(state()).toBe("resolving");
    vi.useRealTimers();
  });
});

// ── Auth churn during an in-flight restore ──

describe("survives a new session object for the same user", () => {
  it("does not strand the spinner when auth re-emits mid-restore", async () => {
    // `auth-context` settles from both `getSession()` and `onAuthStateChange`,
    // and Supabase emits INITIAL_SESSION on subscribe plus TOKEN_REFRESHED
    // later — each a NEW User object for the same person. With the object in
    // the effect's deps, one landing mid-restore re-ran the effect, whose
    // cleanup cancelled the in-flight resolve; the re-run then matched the
    // guard (keyed on the unchanged id) and returned early. No data, no
    // reason, no deadline: a permanent spinner on chat and visualize.
    let release: (v: { status: "ok"; data: AnalyzeResponse }) => void = () => {};
    mockRestore.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const freshUser = () => ({ ...SIGNED_IN, user: { id: "u1" } });
    mockAuth.mockReturnValue(freshUser());

    const { rerender } = renderProvider();
    expect(state()).toBe("resolving");

    // A token refresh lands while the restore is still in flight.
    mockAuth.mockReturnValue(freshUser());
    rerender(
      <RepoProvider repoId="abc123">
        <Probe />
      </RepoProvider>,
    );

    await act(async () => {
      release({ status: "ok", data: analysis() });
    });

    await waitFor(() => expect(state()).toBe("data:kavi"));
  });

  it("spends only one restore when the user object churns", async () => {
    // The guard still has to hold: `/restore` is rate limited at 30/min, and
    // re-requesting on every token refresh would burn that for nothing.
    mockRestore.mockResolvedValue({ status: "ok", data: analysis() });
    const freshUser = () => ({ ...SIGNED_IN, user: { id: "u1" } });

    mockAuth.mockReturnValue(freshUser());
    const { rerender } = renderProvider();
    await settled();

    for (let i = 0; i < 3; i++) {
      mockAuth.mockReturnValue(freshUser());
      rerender(
        <RepoProvider repoId="abc123">
          <Probe />
        </RepoProvider>,
      );
    }

    expect(mockRestore).toHaveBeenCalledTimes(1);
  });
});

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
