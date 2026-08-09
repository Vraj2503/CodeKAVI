/**
 * Tests for the failure taxonomy behind T10/T18.
 *
 * The defect these exist to prevent (QA-003): the Graph page rendered
 * `Missing Authorization header.` as its entire UI — a transport-layer string,
 * in red, with no sign-in prompt and no retry. The fix is only real if the
 * classification is right, because the *action* is derived from it: offering
 * "Re-analyze" to someone who is merely signed out sends them to rebuild an
 * analysis that was never the problem.
 *
 * So what is asserted here is the mapping from failure to action, not the
 * prose.
 */

import { describe, it, expect } from "vitest";
import { ApiError, describeFailure, isAbort, isTimeout } from "../errors";

const at = (status: number, detail = "boom") =>
  describeFailure(new ApiError(status, detail), "this graph");

describe("describeFailure", () => {
  it("sends a signed-out visitor to sign in, not to re-analyze", () => {
    for (const status of [401, 403]) {
      expect(at(status).action).toBe("sign-in");
    }
  });

  it("treats a missing analysis as expired, which re-analysis does fix", () => {
    expect(at(404).action).toBe("reanalyze");
  });

  it("reports 202 as work in progress, not as a fault", () => {
    // A 202 reaches here only because the caller has nothing to show while the
    // backend rebuilds. Naming it a failure would be a lie, and "reanalyze"
    // would ask the user to start the very thing already running.
    const f = at(202, "re-analyzing");
    expect(f.action).toBe("retry");
    expect(f.title.toLowerCase()).toContain("still analyzing");
    expect(f.title.toLowerCase()).not.toContain("error");
    expect(f.title.toLowerCase()).not.toContain("problem");
  });

  it("offers retry for rate limits and server faults", () => {
    expect(at(429).action).toBe("retry");
    expect(at(500).action).toBe("retry");
    expect(at(503).action).toBe("retry");
  });

  it("offers nothing when nothing the user does would help", () => {
    // A 400 is our bug. A retry sends the identical request.
    expect(at(400).action).toBe("none");
    expect(at(402).action).toBe("none");
  });

  it("never leaks the backend's own words into what is rendered", () => {
    const f = at(401, "Missing Authorization header.");
    expect(f.title + f.body).not.toContain("Authorization");
    // ...but keeps them for the console.
    expect(f.detail).toBe("Missing Authorization header.");
  });

  it("distinguishes a timeout from an unreachable host", () => {
    const timedOut = describeFailure(
      new DOMException("too slow", "TimeoutError"),
    );
    const offline = describeFailure(new TypeError("Failed to fetch"));

    expect(timedOut.title).not.toBe(offline.title);
    expect(timedOut.action).toBe("retry");
    expect(offline.action).toBe("retry");
  });

  it("names the subject it was given, so one taxonomy serves every surface", () => {
    expect(describeFailure(new ApiError(500, ""), "this graph").body).toContain(
      "this graph",
    );
    expect(
      describeFailure(new ApiError(500, ""), "this visualization").body,
    ).toContain("this visualization");
  });

  it("still says something useful for a value that isn't an Error at all", () => {
    const f = describeFailure("kaboom");
    expect(f.title).toBeTruthy();
    expect(f.detail).toBe("kaboom");
  });
});

describe("abort vs timeout", () => {
  it("separates a cancellation from a deadline", () => {
    // These arrive through the same channel — `signal.reason` — and collapsing
    // them is how a timed-out request would silently render nothing at all.
    const cancelled = new DOMException("cancelled", "AbortError");
    const expired = new DOMException("expired", "TimeoutError");

    expect(isAbort(cancelled)).toBe(true);
    expect(isTimeout(cancelled)).toBe(false);

    expect(isAbort(expired)).toBe(false);
    expect(isTimeout(expired)).toBe(true);
  });

  it("AbortController.abort() with no reason reads as a cancellation", () => {
    const c = new AbortController();
    c.abort();
    expect(isAbort(c.signal.reason)).toBe(true);
  });
});
