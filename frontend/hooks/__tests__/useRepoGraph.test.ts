import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { useRepoGraph } from "../useRepoGraph";
import { fetchRepoGraph, type RepoGraphPayload } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  fetchRepoGraph: vi.fn(),
}));

const mockFetchRepoGraph = vi.mocked(fetchRepoGraph);

const PAYLOAD: RepoGraphPayload = {
  fingerprint: "abc123",
  layers: [],
  containers: [],
  files: [],
  edges: [],
  portals: [],
  insights: { cycles: [], orphans: [], central: [], entry_points: [] },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useRepoGraph", () => {
  it("200 resolves to success with the payload", async () => {
    mockFetchRepoGraph.mockResolvedValue({ status: "ok", data: PAYLOAD });

    const { result } = renderHook(() => useRepoGraph("repo-1"));

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toEqual(PAYLOAD);
    expect(result.current.error).toBeNull();
  });

  it("202 resolves to a polling state, never an error state", async () => {
    mockFetchRepoGraph.mockResolvedValue({ status: "re-analyzing" });

    const { result, unmount } = renderHook(() => useRepoGraph("repo-1"));

    await waitFor(() => expect(result.current.status).toBe("polling"));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.status).not.toBe("error");

    unmount(); // stop the pending backoff timer before the test ends
  });

  it("404 rejection resolves to an error state", async () => {
    mockFetchRepoGraph.mockRejectedValue(
      new Error("Failed to load graph (404)"),
    );

    const { result } = renderHook(() => useRepoGraph("repo-1"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain("404");
  });

  it("500 rejection resolves to an error state", async () => {
    mockFetchRepoGraph.mockRejectedValue(
      new Error("Failed to load graph (500)"),
    );

    const { result } = renderHook(() => useRepoGraph("repo-1"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain("500");
  });
});
