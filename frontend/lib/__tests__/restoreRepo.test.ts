/**
 * Tests for `restoreRepo`'s failure taxonomy.
 *
 * The old signature returned `AnalyzeResponse | null` and threw on anything
 * that wasn't a 404, which meant "the cache expired", "you are signed out" and
 * "the backend is unreachable" were indistinguishable to the caller. Each needs
 * a different recovery offered to the user, so each has to survive the trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { restoreRepo } from "../api";

vi.mock("../supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

const respond = (status: number, body: unknown = {}) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("restoreRepo", () => {
  it("returns the analysis on success", async () => {
    vi.stubGlobal("fetch", respond(200, { repo_id: "abc", repo_name: "kavi" }));
    const result = await restoreRepo("abc");
    expect(result).toEqual({
      status: "ok",
      data: { repo_id: "abc", repo_name: "kavi" },
    });
  });

  it("maps 202 to re-analyzing rather than reading it as a loaded repo", async () => {
    // The bug this pins: `res.ok` is true across the whole 2xx range, so a 202
    // fell into the success branch and handed the caller
    // `{"detail":{"status":"re-analyzing"}}` in place of an AnalyzeResponse.
    // That object is truthy, so `if (!repoData)` passed and every repo page
    // rendered against a repo with no `repo_id` — chat greeted the user with
    // "undefined/undefined", visualize fetched `/visualize/…/undefined`.
    vi.stubGlobal("fetch", respond(202, { detail: { status: "re-analyzing" } }));
    expect(await restoreRepo("abc")).toEqual({ status: "re-analyzing" });
  });

  it("never reports a 2xx that isn't 200 as ok", async () => {
    // Guards the whole class, not just 202: anything in 2xx that is not a
    // completed analysis must not reach the caller as one.
    for (const status of [202, 203, 204]) {
      vi.stubGlobal("fetch", respond(status, { detail: { status: "re-analyzing" } }));
      const result = await restoreRepo("abc");
      if (result.status === "ok") {
        expect(result.data).toHaveProperty("repo_id");
      }
    }
  });

  it("maps 404 to expired — the only case re-analysis fixes", async () => {
    vi.stubGlobal("fetch", respond(404, { detail: "Repo not found" }));
    expect(await restoreRepo("abc")).toEqual({ status: "expired" });
  });

  it.each([401, 403])("maps %i to unauthenticated", async (status) => {
    vi.stubGlobal("fetch", respond(status, { detail: "Missing Authorization header." }));
    expect(await restoreRepo("abc")).toEqual({ status: "unauthenticated" });
  });

  it("maps a server error to unreachable, keeping the detail out of the union's happy path", async () => {
    vi.stubGlobal("fetch", respond(500, "boom"));
    const result = await restoreRepo("abc");
    expect(result.status).toBe("unreachable");
    expect(result).toMatchObject({ detail: expect.stringContaining("500") });
  });

  it("treats a network failure as unreachable rather than expired", async () => {
    // The distinction matters: offering "Re-analyze" to someone whose backend
    // is down sends them at an operation that will fail the same way.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    expect(await restoreRepo("abc")).toEqual({
      status: "unreachable",
      detail: "Failed to fetch",
    });
  });

  it("bounds the request so a silent backend cannot hang the page", async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal("fetch", fetchMock);
    await restoreRepo("abc");
    const init = fetchMock.mock.calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("serves mock data without touching the network in dev", async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal("fetch", fetchMock);
    const result = await restoreRepo("dev-mock-repo");
    expect(result.status).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
