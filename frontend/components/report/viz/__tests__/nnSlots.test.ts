/**
 * Tests for collapsing repeated blocks into drawn slots.
 *
 * A repeat contributes exactly ONE slot for the whole period, not one slot
 * per layer in the period (2026-08-14). The first version of this collapsed
 * a `x12` group of period 4 into 4 slots instead of 48 — real progress over
 * inline-expanding all 48, but a real transformer's period is usually
 * MultiheadAttention + LayerNorm + Linear + GELU + Linear + LayerNorm (6
 * layers), and 6 individually captioned blocks packed shoulder to shoulder
 * overlap into unreadable text once the blocks themselves are thin (a Linear
 * layer has no spatial footprint). One slot per period, sized after its
 * tallest member, is what the reference figure actually draws — internals
 * only ever appear in the detail panel (D3), which is exercised in the
 * browser, not here.
 *
 * Every layer id in the run — every repetition, every position in the
 * period — still has to resolve to a slot, or a connection into or out of
 * any repetition points at nothing and the model silently detaches.
 */

import { describe, expect, it } from "vitest";
import { buildSlots } from "../NeuralNetworkViz";
import type { NNLayer, NNRepeat } from "@/lib/api";

function layer(id: string, type = "Linear", height?: number): NNLayer {
  return {
    id,
    type,
    category: "dense",
    params: {},
    block_dims: height != null ? { height, depth: 14, width: 6 } : undefined,
  };
}

/** `embed` + 12 x (attn, norm) + `head` — a miniature BERT. */
function encoderStack() {
  const layers: NNLayer[] = [layer("embed", "Embedding")];
  for (let i = 0; i < 12; i++) {
    layers.push(layer(`attn_${i}`, "MultiheadAttention"), layer(`norm_${i}`, "LayerNorm"));
  }
  layers.push(layer("head", "Linear"));
  const repeat: NNRepeat = { start: 1, length: 2, count: 12, label: "Encoder" };
  return { layers, repeats: [repeat] };
}

describe("buildSlots", () => {
  it("collapses a whole repeated period into one slot, not one per layer", () => {
    const { layers, repeats } = encoderStack();
    const { slots } = buildSlots(layers, repeats);
    // embed + ONE slot for the (attn, norm) period + head — not
    // embed + attn + norm + head, and nowhere near embed + 24 + head.
    expect(slots).toHaveLength(3);
    expect(slots[0].layer.type).toBe("Embedding");
    expect(slots[1].group).toBe(repeats[0]);
    expect(slots[2].layer.type).toBe("Linear");
  });

  it("sizes the group slot after the TALLEST layer in the period", () => {
    // A real encoder layer's Linear/GELU members have no spatial footprint;
    // sizing the outer block off whichever layer happens to be first would
    // make it a sliver even though the block it represents contains a
    // full-height attention layer.
    const layers: NNLayer[] = [
      layer("lin_0", "Linear", 20),
      layer("attn_0", "MultiheadAttention", 90),
      layer("lin_1", "Linear", 20),
    ];
    const repeats: NNRepeat[] = [{ start: 0, length: 3, count: 4, label: "Block" }];
    const { slots } = buildSlots(layers, repeats);
    expect(slots).toHaveLength(1);
    expect(slots[0].layer.block_dims?.height).toBe(90);
  });

  it("folds every layer in every repetition onto the one group slot", () => {
    const { layers, repeats } = encoderStack();
    const { layerToSlot } = buildSlots(layers, repeats);
    for (let i = 0; i < 12; i++) {
      expect(layerToSlot.get(`attn_${i}`)).toBe(1);
      expect(layerToSlot.get(`norm_${i}`)).toBe(1);
    }
  });

  it("gives every layer in the run a slot, so no connection dangles", () => {
    const { layers, repeats } = encoderStack();
    const { slots, layerToSlot } = buildSlots(layers, repeats);
    for (const l of layers) {
      const slot = layerToSlot.get(l.id);
      expect(slot, `${l.id} has no slot`).toBeDefined();
      expect(slot).toBeLessThan(slots.length);
    }
  });

  it("keeps the layers after a collapsed run in the right order", () => {
    const { layers, repeats } = encoderStack();
    const { slots, layerToSlot } = buildSlots(layers, repeats);
    expect(layerToSlot.get("head")).toBe(slots.length - 1);
    expect(layerToSlot.get("embed")).toBe(0);
  });

  it("marks the group slot as both start and end — a span of one is not a special case", () => {
    const { layers, repeats } = encoderStack();
    const { slots } = buildSlots(layers, repeats);
    expect(slots.map((s) => Boolean(s.groupStart))).toEqual([false, true, false]);
    expect(slots.map((s) => Boolean(s.groupEnd))).toEqual([false, true, false]);
  });

  it("is identity-preserving when there are no repeats", () => {
    const layers = [layer("a"), layer("b"), layer("c")];
    const { slots, layerToSlot } = buildSlots(layers, []);
    expect(slots.map((s) => s.layer.id)).toEqual(["a", "b", "c"]);
    expect(layerToSlot.get("c")).toBe(2);
  });

  it("handles two collapsed groups without overlap", () => {
    const layers = [
      layer("x", "Conv2d"),
      layer("a0"), layer("a1"), layer("a2"),
      layer("y", "MaxPool2d"),
      layer("b0", "ReLU"), layer("b1", "ReLU"),
    ];
    const repeats: NNRepeat[] = [
      { start: 1, length: 1, count: 3, label: "A" },
      { start: 5, length: 1, count: 2, label: "B" },
    ];
    const { slots } = buildSlots(layers, repeats);
    expect(slots.map((s) => s.layer.type)).toEqual(["Conv2d", "Linear", "MaxPool2d", "ReLU"]);
    expect(slots.map((s) => s.group?.label ?? null)).toEqual([null, "A", null, "B"]);
  });

  it("survives a repeat whose run overruns the layer list", () => {
    const layers = [layer("a"), layer("b")];
    const repeats: NNRepeat[] = [{ start: 0, length: 2, count: 9, label: "bad" }];
    const { slots, layerToSlot } = buildSlots(layers, repeats);
    // One group slot, even though the declared span (18) overruns the two
    // real layers available — both fold onto that one slot.
    expect(slots).toHaveLength(1);
    expect(layerToSlot.get("a")).toBe(0);
    expect(layerToSlot.get("b")).toBe(0);
  });

  it("ignores a degenerate zero-length repeat instead of looping forever", () => {
    const layers = [layer("a"), layer("b")];
    const repeats: NNRepeat[] = [{ start: 0, length: 0, count: 0 }];
    const { slots } = buildSlots(layers, repeats);
    expect(slots.map((s) => s.layer.id)).toEqual(["a", "b"]);
  });
});
