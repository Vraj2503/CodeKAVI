import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { ContainerNode, type ContainerNodeType } from "../ContainerNode";
import type { RepoGraphContainer } from "@/lib/api";

function baseContainer(
  overrides: Partial<RepoGraphContainer> = {},
): RepoGraphContainer {
  return {
    id: "c1",
    layer_id: "services",
    name: "services/auth",
    strategy: "folder",
    file_ids: ["f1", "f2", "f3"],
    ...overrides,
  };
}

function renderNode(
  props: Partial<ContainerNodeType> = {},
  onToggle = vi.fn(),
) {
  const node = {
    id: "c1",
    type: "container" as const,
    data: { container: baseContainer(), expanded: false, onToggle },
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
      <ContainerNode {...node} />
    </ReactFlowProvider>,
  );
  return { onToggle };
}

afterEach(cleanup);

describe("ContainerNode", () => {
  it("collapsed: shows name and file count", () => {
    renderNode();
    expect(screen.getByText("services/auth")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("expanded: renders a header frame instead of the collapsed atom", () => {
    renderNode({
      data: { container: baseContainer(), expanded: true, onToggle: vi.fn() },
    });
    expect(screen.getByText("services/auth")).toBeTruthy();
  });

  it("clicking the header calls onToggle with the container id", () => {
    const { onToggle } = renderNode();
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledWith("c1");
  });

  it("shows the community strategy icon for community containers", () => {
    renderNode({
      data: {
        container: baseContainer({ strategy: "community" }),
        expanded: false,
        onToggle: vi.fn(),
      },
    });
    expect(screen.getByLabelText("grouped")).toBeTruthy();
  });
});
