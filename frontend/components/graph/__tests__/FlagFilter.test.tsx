import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FlagFilter } from "../FlagFilter";
import type { RepoGraphFile } from "@/lib/api";

function file(overrides: Partial<RepoGraphFile>): RepoGraphFile {
  return {
    id: "f1",
    path: "src/f1.py",
    name: "f1.py",
    container_id: "c1",
    layer_id: "services",
    role: null,
    role_label: null,
    importance: 0,
    in_degree: 0,
    out_degree: 0,
    language: "python",
    size: 10,
    kind: "file",
    parent: null,
    flags: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("FlagFilter", () => {
  it("renders nothing when no files carry flags", () => {
    const { container } = render(
      <FlagFilter
        files={[file({})]}
        activeFlags={new Set()}
        onToggle={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a chip per flag with the aggregated count", () => {
    render(
      <FlagFilter
        files={[
          file({ id: "a", flags: ["orphan"] }),
          file({ id: "b", flags: ["orphan"] }),
          file({ id: "c", flags: ["in_cycle"] }),
        ]}
        activeFlags={new Set()}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("2 files nothing imports")).toBeTruthy();
    expect(screen.getByText("1 file in a circular dependency")).toBeTruthy();
  });

  it("clicking a chip calls onToggle with that flag", () => {
    const onToggle = vi.fn();
    render(
      <FlagFilter
        files={[file({ flags: ["hub"] })]}
        activeFlags={new Set()}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByText("1 hub"));
    expect(onToggle).toHaveBeenCalledWith("hub");
  });

  it("marks an active flag's chip as pressed", () => {
    render(
      <FlagFilter
        files={[file({ flags: ["hub"] })]}
        activeFlags={new Set(["hub"])}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("1 hub").closest("button")).toHaveProperty(
      "ariaPressed",
      "true",
    );
  });
});
