import { describe, expect, it } from "vitest";
import { nodeTitle } from "./RadialMindmap";

describe("mind map card hover text", () => {
  it("shows a file's path, then its sentence from the facts", () => {
    expect(
      nodeTitle({
        label: "api.ts",
        path: "frontend/lib/api.ts",
        description: "Calls the backend API.",
      }),
    ).toBe("frontend/lib/api.ts\nCalls the backend API.");
  });

  it("shows how many files an area or module holds", () => {
    expect(nodeTitle({ label: "routes", path: "backend/rune/routes", files: 12 })).toBe(
      "backend/rune/routes\n12 files",
    );
    expect(nodeTitle({ label: "llm", path: "backend/rune/llm", files: 1 })).toBe("backend/rune/llm\n1 file");
  });

  it("falls back to the label when there is nothing else, as the AI mode's branches are", () => {
    expect(nodeTitle({ name: "Data Access", id: "data_access" })).toBe("Data Access");
  });
});
