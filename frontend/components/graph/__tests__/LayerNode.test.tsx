import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { LayerNode, type LayerNodeType } from "../LayerNode";
import type { RepoGraphLayer } from "@/lib/api";

function baseLayer(overrides: Partial<RepoGraphLayer> = {}): RepoGraphLayer {
  return {
    id: "services",
    name: "services",
    label: "Services",
    file_count: 12,
    tier: 1,
    ...overrides,
  };
}

function renderNode(props: Partial<LayerNodeType> = {}, onOpen = vi.fn()) {
  const node = {
    id: "services",
    type: "layer" as const,
    data: {
      layer: baseLayer(),
      flagCounts: [],
      inCount: 3,
      outCount: 5,
      onOpen,
    },
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    ...props,
  };
  render(
    <ReactFlowProvider>
      <LayerNode {...node} />
    </ReactFlowProvider>,
  );
  return { onOpen };
}

afterEach(cleanup);

describe("LayerNode", () => {
  it("shows label, file count, and edge counts", () => {
    renderNode();
    expect(screen.getByText("Services")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("clicking the card calls onOpen with the layer id", () => {
    const { onOpen } = renderNode();
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("services");
  });

  it("renders a flag badge with its count", () => {
    renderNode({
      data: {
        layer: baseLayer(),
        flagCounts: [{ flag: "orphan", count: 4 }],
        inCount: 0,
        outCount: 0,
        onOpen: vi.fn(),
      },
    });
    expect(screen.getByTitle("orphaned")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("omits the flag badge row when there are no flags", () => {
    renderNode({
      data: {
        layer: baseLayer(),
        flagCounts: [],
        inCount: 0,
        outCount: 0,
        onOpen: vi.fn(),
      },
    });
    expect(screen.queryByTitle("orphaned")).toBeNull();
  });
});
