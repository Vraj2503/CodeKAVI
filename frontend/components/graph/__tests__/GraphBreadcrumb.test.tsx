import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { GraphBreadcrumb } from "../GraphBreadcrumb";
import type { RepoGraphLayer } from "@/lib/api";

const layer: RepoGraphLayer = {
  id: "services",
  name: "services",
  label: "Services",
  file_count: 12,
  tier: 1,
};

afterEach(cleanup);

describe("GraphBreadcrumb", () => {
  it("at the overview, shows only 'All layers' as current", () => {
    render(<GraphBreadcrumb activeLayer={null} onNavigate={vi.fn()} />);
    expect(screen.getByText("All layers")).toBeTruthy();
    expect(screen.queryByText("Services")).toBeNull();
  });

  it("inside a layer, shows both crumbs", () => {
    render(<GraphBreadcrumb activeLayer={layer} onNavigate={vi.fn()} />);
    expect(screen.getByText("All layers")).toBeTruthy();
    expect(screen.getByText("Services")).toBeTruthy();
  });

  it("clicking 'All layers' navigates back to the overview", () => {
    const onNavigate = vi.fn();
    render(<GraphBreadcrumb activeLayer={layer} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText("All layers"));
    expect(onNavigate).toHaveBeenCalledWith(null);
  });
});
