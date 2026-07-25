import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GraphCanvas } from "../GraphCanvas";
import type { RepoGraphPayload } from "@/lib/api";
import { useRepoGraph } from "@/hooks/useRepoGraph";
import {
  layoutContainers,
  layoutContainerChildren,
} from "@/lib/graph/elkLayout";

vi.mock("@/hooks/useRepoGraph");
vi.mock("@/lib/graph/elkLayout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/graph/elkLayout")>();
  return {
    ...actual,
    layoutContainers: vi.fn(),
    layoutContainerChildren: vi.fn(),
  };
});

// jsdom has no ResizeObserver; @xyflow/react needs one to mount its viewport.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const mockUseRepoGraph = vi.mocked(useRepoGraph);
const mockLayoutContainers = vi.mocked(layoutContainers);
const mockLayoutContainerChildren = vi.mocked(layoutContainerChildren);

function payload(overrides: Partial<RepoGraphPayload> = {}): RepoGraphPayload {
  return {
    fingerprint: "fp",
    layers: [
      { id: "routes", name: "routes", label: "Routes", file_count: 2, tier: 0 },
    ],
    containers: [
      {
        id: "c1",
        layer_id: "routes",
        name: "routes/api",
        strategy: "folder",
        file_ids: ["f1", "f2"],
      },
    ],
    files: [
      {
        id: "f1",
        path: "routes/a.ts",
        name: "a.ts",
        container_id: "c1",
        layer_id: "routes",
        role: null,
        role_label: null,
        importance: 50,
        in_degree: 1,
        out_degree: 1,
        language: "ts",
        size: 100,
        kind: "file",
        parent: null,
        flags: ["entry_point"],
      },
      {
        id: "f2",
        path: "routes/b.ts",
        name: "b.ts",
        container_id: "c1",
        layer_id: "routes",
        role: null,
        role_label: null,
        importance: 20,
        in_degree: 0,
        out_degree: 1,
        language: "ts",
        size: 50,
        kind: "file",
        parent: null,
        flags: [],
      },
    ],
    edges: [{ source: "f1", target: "f2", level: "file", count: 1 }],
    portals: [],
    insights: { cycles: [], orphans: [], central: [], entry_points: ["f1"] },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GraphCanvas", () => {
  it("shows a loading message while the graph is loading", () => {
    mockUseRepoGraph.mockReturnValue({
      status: "loading",
      data: null,
      error: null,
    });
    render(<GraphCanvas repoId="r1" />);
    expect(screen.getByText("Loading graph…")).toBeTruthy();
  });

  it("shows a re-analyzing message while polling", () => {
    mockUseRepoGraph.mockReturnValue({
      status: "polling",
      data: null,
      error: null,
    });
    render(<GraphCanvas repoId="r1" />);
    expect(screen.getByText("Re-analyzing repository…")).toBeTruthy();
  });

  it("shows the error message on failure", () => {
    mockUseRepoGraph.mockReturnValue({
      status: "error",
      data: null,
      error: "backend is down",
    });
    render(<GraphCanvas repoId="r1" />);
    expect(screen.getByText("backend is down")).toBeTruthy();
  });

  it("renders the overview with a layer card per layer", () => {
    mockUseRepoGraph.mockReturnValue({
      status: "success",
      data: payload(),
      error: null,
    });
    render(<GraphCanvas repoId="r1" />);
    expect(screen.getByText("Routes")).toBeTruthy();
  });

  it("drills into a layer, expands a container, and selects a file", async () => {
    mockUseRepoGraph.mockReturnValue({
      status: "success",
      data: payload(),
      error: null,
    });
    mockLayoutContainers.mockResolvedValue({
      positions: { c1: { id: "c1", x: 0, y: 0, width: 200, height: 120 } },
      usedFallback: false,
    });
    mockLayoutContainerChildren.mockResolvedValue({
      positions: {
        f1: { id: "f1", x: 0, y: 0, width: 180, height: 56 },
        f2: { id: "f2", x: 0, y: 80, width: 180, height: 56 },
      },
      usedFallback: false,
    });

    render(<GraphCanvas repoId="r1" />);

    fireEvent.click(screen.getByText("Routes"));
    expect(await screen.findByText("routes/api")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /routes\/api/ }));
    expect(await screen.findByText("a.ts")).toBeTruthy();

    fireEvent.click(screen.getByText("a.ts"));
    expect(await screen.findByLabelText("close panel")).toBeTruthy();
  });

  it("filters files via the flag strip", async () => {
    mockUseRepoGraph.mockReturnValue({
      status: "success",
      data: payload(),
      error: null,
    });
    mockLayoutContainers.mockResolvedValue({
      positions: { c1: { id: "c1", x: 0, y: 0, width: 200, height: 120 } },
      usedFallback: false,
    });
    mockLayoutContainerChildren.mockResolvedValue({
      positions: {
        f1: { id: "f1", x: 0, y: 0, width: 180, height: 56 },
        f2: { id: "f2", x: 0, y: 80, width: 180, height: 56 },
      },
      usedFallback: false,
    });

    render(<GraphCanvas repoId="r1" />);
    fireEvent.click(screen.getByText("Routes"));
    fireEvent.click(await screen.findByRole("button", { name: /routes\/api/ }));
    await screen.findByText("a.ts");

    fireEvent.click(screen.getByText("1 entry point"));
    expect(screen.queryByText("b.ts")).toBeNull();
    expect(screen.getByText("a.ts")).toBeTruthy();
  });
});
