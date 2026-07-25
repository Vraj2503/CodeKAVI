import { describe, it, expect } from "vitest";
import {
  graphViewReducer,
  initialGraphViewState,
  type GraphViewState,
} from "../graphState";

describe("graphViewReducer", () => {
  it("open_layer sets the layer and resets expansion/selection", () => {
    const seeded: GraphViewState = {
      ...initialGraphViewState,
      expandedContainers: new Set(["c1"]),
      selectedFileId: "f1",
    };
    const next = graphViewReducer(seeded, {
      type: "open_layer",
      layerId: "services",
    });
    expect(next.activeLayerId).toBe("services");
    expect(next.expandedContainers.size).toBe(0);
    expect(next.selectedFileId).toBeNull();
  });

  it("close_layer clears layer, expansion, and selection", () => {
    const seeded: GraphViewState = {
      activeLayerId: "services",
      expandedContainers: new Set(["c1"]),
      selectedFileId: "f1",
      activeFlags: new Set(),
    };
    const next = graphViewReducer(seeded, { type: "close_layer" });
    expect(next.activeLayerId).toBeNull();
    expect(next.expandedContainers.size).toBe(0);
    expect(next.selectedFileId).toBeNull();
  });

  it("toggle_container adds then removes a container id", () => {
    const opened = graphViewReducer(initialGraphViewState, {
      type: "toggle_container",
      containerId: "c1",
    });
    expect(opened.expandedContainers.has("c1")).toBe(true);

    const closed = graphViewReducer(opened, {
      type: "toggle_container",
      containerId: "c1",
    });
    expect(closed.expandedContainers.has("c1")).toBe(false);
  });

  it("select_file and close_panel set/clear selectedFileId", () => {
    const selected = graphViewReducer(initialGraphViewState, {
      type: "select_file",
      fileId: "f1",
    });
    expect(selected.selectedFileId).toBe("f1");

    const closed = graphViewReducer(selected, { type: "close_panel" });
    expect(closed.selectedFileId).toBeNull();
  });

  it("toggle_flag adds then removes a flag", () => {
    const on = graphViewReducer(initialGraphViewState, {
      type: "toggle_flag",
      flag: "orphan",
    });
    expect(on.activeFlags.has("orphan")).toBe(true);

    const off = graphViewReducer(on, { type: "toggle_flag", flag: "orphan" });
    expect(off.activeFlags.has("orphan")).toBe(false);
  });
});
