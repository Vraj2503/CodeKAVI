import { describe, expect, it } from "vitest";
import { folderLabel } from "@/lib/graph/buildFlowGraph";

describe("folderLabel", () => {
  it("names the repo root for top-level files", () => {
    expect(folderLabel("README.md")).toBe("repo root");
  });

  it("keeps short paths whole", () => {
    expect(folderLabel("frontend/README.md")).toBe("frontend");
    expect(folderLabel("frontend/docs/README.md")).toBe("frontend/docs");
  });

  it("elides the head of deep paths, keeping the distinguishing tail", () => {
    expect(folderLabel("a/b/frontend/docs/README.md")).toBe("…/frontend/docs");
  });
});
