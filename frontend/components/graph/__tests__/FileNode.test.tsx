import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { FileNode, type FileNodeType } from "../FileNode";
import type { RepoGraphFile } from "@/lib/api";

function baseFile(overrides: Partial<RepoGraphFile> = {}): RepoGraphFile {
  return {
    id: "f1",
    path: "src/services/auth.py",
    name: "auth.py",
    container_id: "c1",
    layer_id: "services",
    role: "core_module",
    role_label: "Core module",
    importance: 82,
    in_degree: 5,
    out_degree: 2,
    language: "python",
    size: 1200,
    kind: "file",
    parent: null,
    flags: [],
    ...overrides,
  };
}

function renderNode(props: Partial<FileNodeType> = {}) {
  const node = {
    id: "f1",
    type: "file" as const,
    data: { file: baseFile() },
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
  return render(
    <ReactFlowProvider>
      <FileNode {...node} />
    </ReactFlowProvider>,
  );
}

afterEach(cleanup);

describe("FileNode", () => {
  it("renders file name and role label", () => {
    renderNode();
    expect(screen.getByText("auth.py")).toBeTruthy();
    expect(screen.getByText("Core module")).toBeTruthy();
  });

  it("renders only known flags, dropping unrecognized ones", () => {
    renderNode({
      data: { file: baseFile({ flags: ["hub", "orphan", "not_a_flag"] }) },
    });
    expect(screen.getByLabelText("hub")).toBeTruthy();
    expect(screen.getByLabelText("orphaned")).toBeTruthy();
  });

  it("caps rendered flags at 3", () => {
    renderNode({
      data: {
        file: baseFile({
          flags: ["entry_point", "hub", "orphan", "in_cycle", "god_file"],
        }),
      },
    });
    const icons = document.querySelectorAll("[aria-label]");
    expect(icons.length).toBe(3);
  });
});
