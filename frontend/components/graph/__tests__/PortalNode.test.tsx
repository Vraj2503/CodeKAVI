import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { PortalNode, type PortalNodeType } from "../PortalNode";
import type { RepoGraphLayer, RepoGraphPortal } from "@/lib/api";

function basePortal(overrides: Partial<RepoGraphPortal> = {}): RepoGraphPortal {
  return {
    from_layer: "routes",
    to_layer: "services",
    connection_count: 12,
    ...overrides,
  };
}

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

function renderNode(props: Partial<PortalNodeType> = {}, onNavigate = vi.fn()) {
  const node = {
    id: "portal:routes->services",
    type: "portal" as const,
    data: { portal: basePortal(), toLayer: baseLayer(), onNavigate },
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
      <PortalNode {...node} />
    </ReactFlowProvider>,
  );
  return { onNavigate };
}

afterEach(cleanup);

describe("PortalNode", () => {
  it("shows the target layer label and connection count", () => {
    renderNode();
    expect(screen.getByText("Services")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("clicking navigates to the target layer id", () => {
    const { onNavigate } = renderNode();
    fireEvent.click(screen.getByRole("button"));
    expect(onNavigate).toHaveBeenCalledWith("services");
  });
});
