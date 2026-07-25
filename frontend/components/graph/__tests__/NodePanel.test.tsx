import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NodePanel } from "../NodePanel";
import type { RepoGraphFile } from "@/lib/api";

function file(overrides: Partial<RepoGraphFile>): RepoGraphFile {
  return {
    id: "src/session.py",
    path: "src/session.py",
    name: "session.py",
    container_id: "c1",
    layer_id: "services",
    role: null,
    role_label: null,
    importance: 0,
    in_degree: 12,
    out_degree: 4,
    language: "python",
    size: 10,
    kind: "file",
    parent: null,
    flags: [],
    ...overrides,
  };
}

afterEach(cleanup);

describe("NodePanel", () => {
  it("shows degree counts and role", () => {
    render(
      <NodePanel
        file={file({ role_label: "Session handling" })}
        cycles={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("Session handling")).toBeTruthy();
  });

  it("renders non-cycle flags as chips", () => {
    render(
      <NodePanel
        file={file({ flags: ["entry_point", "hub"] })}
        cycles={[]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("entry point")).toBeTruthy();
    expect(screen.getByText("hub")).toBeTruthy();
  });

  it("names cycle partners instead of rendering an in_cycle chip", () => {
    render(
      <NodePanel
        file={file({ id: "src/session.py", flags: ["in_cycle"] })}
        cycles={[["src/session.py", "src/orchestrator.py"]]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("circular")).toBeNull();
    expect(screen.getByText("orchestrator.py")).toBeTruthy();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<NodePanel file={file({})} cycles={[]} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("close panel"));
    expect(onClose).toHaveBeenCalled();
  });
});
