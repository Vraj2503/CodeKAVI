import { describe, expect, it } from "vitest";
import { questionKey, stepKey } from "@/lib/graph/tourProgress";
import type { TourStep } from "@/lib/api";

/** Matches what every backend generator emits: one step per file, each
 * carrying its own file's layer_id (tour_generator.py:181, 215, 303, 370). */
function step(nodeId: string, layerId: string | null): TourStep {
  return {
    order: 1,
    node_ids: [nodeId],
    layer_id: layerId,
    title: nodeId,
    facts: [],
    questions: [],
  } as TourStep;
}

describe("stepKey", () => {
  it("gives distinct keys to distinct files in the same layer", () => {
    const a = step("src/auth/login.ts", "layer-core");
    const b = step("src/auth/session.ts", "layer-core");

    expect(stepKey(a)).not.toBe(stepKey(b));
  });

  it("keys by file identity, not by the layer the file sits in", () => {
    const a = step("src/a.ts", "layer-core");
    const b = step("src/b.ts", "layer-edge");

    expect(stepKey(a)).toBe("src/a.ts");
    expect(stepKey(b)).toBe("src/b.ts");
  });

  it("stays stable across learn/recall reordering", () => {
    // Same file, different position in the tour — the key must not move.
    const learn = { ...step("src/a.ts", "layer-core"), order: 1 };
    const recall = { ...step("src/a.ts", "layer-core"), order: 7 };

    expect(stepKey(learn)).toBe(stepKey(recall));
  });

  it("falls back to layer_id when a file has no layer", () => {
    const orphan = { ...step("src/a.ts", null), node_ids: [] } as TourStep;

    expect(stepKey(orphan)).toBe("");
  });
});

describe("questionKey", () => {
  it("does not share answerable-question state between files in one layer", () => {
    const a = step("src/auth/login.ts", "layer-core");
    const b = step("src/auth/session.ts", "layer-core");

    expect(questionKey(a, 0)).not.toBe(questionKey(b, 0));
  });

  it("separates question indices within a single step", () => {
    const a = step("src/auth/login.ts", "layer-core");

    expect(questionKey(a, 0)).not.toBe(questionKey(a, 1));
  });
});
