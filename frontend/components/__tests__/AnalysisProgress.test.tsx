/**
 * Tests that one click starts one backend analysis.
 *
 * The defect these exist to prevent: React Strict Mode (on by default with the
 * app router in development) runs the stream effect twice, and the first run's
 * request was never cancelled, so every repository was cloned, analyzed and
 * indexed twice. The invariant under test: **one analysis per URL in flight**,
 * and each outcome reported exactly once.
 */

import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { AnalysisProgress } from "../AnalysisProgress";
import { analyzeRepoStream, type AnalysisProgressEvent, type AnalyzeResponse } from "@/lib/api";

vi.mock("@/lib/api", () => ({ analyzeRepoStream: vi.fn() }));

const mockStream = vi.mocked(analyzeRepoStream);

function analysis(repoId = "abc123"): AnalyzeResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { success: true, repo_id: repoId, repo_name: "kavi" } as any;
}

/** A stream the test drives by hand: emit progress, then resolve or reject. */
function controllableStream() {
  let emit: (event: AnalysisProgressEvent) => void = () => {};
  let resolve: (data: AnalyzeResponse) => void = () => {};
  let reject: (error: Error) => void = () => {};
  mockStream.mockImplementation((_url, onProgress) => {
    emit = onProgress;
    return new Promise<AnalyzeResponse>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return {
    emit: (event: AnalysisProgressEvent) => emit(event),
    resolve: (data: AnalyzeResponse) => resolve(data),
    reject: (error: Error) => reject(error),
  };
}

function renderProgress(repoUrl: string, strict = true) {
  const handlers = { onComplete: vi.fn(), onError: vi.fn(), onCancel: vi.fn() };
  const tree = <AnalysisProgress repoUrl={repoUrl} {...handlers} />;
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return handlers;
}

beforeEach(() => {
  mockStream.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AnalysisProgress", () => {
  it("starts one analysis per click even when Strict Mode runs the effect twice", async () => {
    const stream = controllableStream();
    const { onComplete } = renderProgress("https://github.com/acme/one");

    expect(mockStream).toHaveBeenCalledTimes(1);

    act(() => stream.emit({ stage: "traversing", progress: 20, message: "Scanning files" }));
    expect(screen.getByText("Scanning files")).toBeTruthy();

    await act(async () => stream.resolve(analysis("r1")));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onComplete).toHaveBeenCalledWith(analysis("r1"));
  });

  it("reports a failed analysis once", async () => {
    const stream = controllableStream();
    const { onError } = renderProgress("https://github.com/acme/two");

    await act(async () => stream.reject(new Error("clone failed")));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith("clone failed");
    expect(screen.getByText("clone failed")).toBeTruthy();
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh analysis for the same URL once the previous one has finished", async () => {
    const first = controllableStream();
    const { onComplete } = renderProgress("https://github.com/acme/three");
    await act(async () => first.resolve(analysis("r3")));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), { timeout: 2000 });
    cleanup();

    controllableStream();
    renderProgress("https://github.com/acme/three", false);

    expect(mockStream).toHaveBeenCalledTimes(2);
  });
});
