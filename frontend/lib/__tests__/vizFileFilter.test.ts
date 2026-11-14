/**
 * T31: views that list files leave tests and docs out unless asked for.
 * These pin what each endpoint is sent, since the backend defaults to hiding them.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { fetchVisualization, FILE_FILTER_VIEWS } from "../api";
import { useVisualization } from "@/hooks/useVisualization";

vi.mock("../supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

const ok = () =>
  vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ type: "x", data: {} }),
    text: async () => "{}",
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SHOW = { includeTests: true, includeDocs: true };

describe("fetchVisualization file filter", () => {
  it("asks the radar for tests and docs only when they are wanted", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);

    await fetchVisualization("r1", "concentric_radar");
    await fetchVisualization("r1", "concentric_radar", false, undefined, SHOW);

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/visualize\/radar\/r1$/);
    expect(fetchMock.mock.calls[1][0]).toMatch(
      /\/visualize\/radar\/r1\?include_tests=true&include_docs=true$/,
    );
  });

  it("puts the flags in the mind map and architecture request bodies", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);

    await fetchVisualization("r1", "mindmap");
    await fetchVisualization("r1", "architecture", false, undefined, SHOW);

    const mindmap = JSON.parse(fetchMock.mock.calls[0][1].body);
    const architecture = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(mindmap).toEqual({ use_llm: false, include_tests: false, include_docs: false });
    expect(architecture.include).toEqual({ evidence: "inspector_only", tests: true, docs: true });
  });

  it("offers the toggle only on the views whose endpoints take the filter", () => {
    expect([...FILE_FILTER_VIEWS].sort()).toEqual(["architecture", "concentric_radar", "mindmap"]);
  });
});

describe("useVisualization with a file filter", () => {
  it("keeps one entry per filter, so flipping the toggle back costs no request", async () => {
    const fetchMock = ok();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useVisualization("r1"));
    const hidden = { includeTests: false, includeDocs: false };

    await act(() => result.current.generate("concentric_radar", false, hidden));
    await act(() => result.current.generate("concentric_radar", false, SHOW));
    await act(() => result.current.generate("concentric_radar", false, hidden));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.getState("concentric_radar", hidden).status).toBe("success");
    expect(result.current.getState("concentric_radar", SHOW).status).toBe("success");
  });
});
