import { describe, it, expect } from "vitest";
import {
  buildFigure,
  groupRepeats,
  formatParams,
  formatShape,
  project,
  deriveDims,
} from "../nnLayout";
import type { NNModel, NNLayer } from "@/lib/api";

function layer(over: Partial<NNLayer> = {}): NNLayer {
  return {
    id: over.id ?? "l1",
    type: over.type ?? "Conv2d",
    category: over.category ?? "convolution",
    params: over.params ?? {},
    output_shape: over.output_shape,
    param_count: over.param_count,
    block_dims: over.block_dims ?? { width: 6, height: 30, depth: 14 },
    ...over,
  };
}

function model(over: Partial<NNModel> = {}): NNModel {
  return {
    name: "Net",
    file: "m.py",
    line: 1,
    framework: "pytorch",
    type: "class",
    layers: [],
    connections: [],
    ...over,
  } as NNModel;
}

describe("project", () => {
  it("keeps x and y square to the page", () => {
    // Cabinet projection: only z recedes. Two blocks of equal height must
    // measure equal on the page, which true isometric would break.
    // toBeCloseTo, not toEqual: negating a zero y yields -0, which is a
    // correct result that Object.is-based equality rejects.
    expect(project(10, 0, 0).x).toBeCloseTo(10, 6);
    expect(project(10, 0, 0).y).toBeCloseTo(0, 6);
    expect(project(0, 10, 0).x).toBeCloseTo(0, 6);
    expect(project(0, 10, 0).y).toBeCloseTo(-10, 6);
  });

  it("recedes z up and to the right at half scale", () => {
    const p = project(0, 0, 10);
    expect(p.x).toBeCloseTo(10 * Math.cos(Math.PI / 6) * 0.5, 5);
    expect(p.y).toBeCloseTo(-10 * Math.sin(Math.PI / 6) * 0.5, 5);
  });
});

describe("groupRepeats", () => {
  it("folds consecutive identical layers", () => {
    const enc = () =>
      layer({ type: "TransformerEncoderLayer", category: "attention" });
    const layers = [
      layer({ id: "a", type: "Embedding", category: "embedding" }),
      { ...enc(), id: "e1" },
      { ...enc(), id: "e2" },
      { ...enc(), id: "e3" },
      layer({ id: "z", type: "Linear", category: "dense" }),
    ];
    const groups = groupRepeats(layers);
    expect(groups.map((g) => g.repeat)).toEqual([1, 3, 1]);
    expect(groups[1].memberIds).toEqual(["e1", "e2", "e3"]);
  });

  it("does not fold non-adjacent duplicates", () => {
    const layers = [
      layer({ id: "a", type: "Conv2d" }),
      layer({ id: "b", type: "ReLU", category: "activation" }),
      layer({ id: "c", type: "Conv2d" }),
    ];
    expect(groupRepeats(layers).map((g) => g.repeat)).toEqual([1, 1, 1]);
  });

  it("treats differing param counts as distinct", () => {
    const layers = [
      layer({ id: "a", param_count: 100 }),
      layer({ id: "b", param_count: 200 }),
    ];
    expect(groupRepeats(layers)).toHaveLength(2);
  });
});

describe("buildFigure", () => {
  it("lays blocks out left to right without overlapping", () => {
    const fig = buildFigure(
      model({
        layers: [
          layer({ id: "a" }),
          layer({ id: "b", type: "ReLU", category: "activation" }),
          layer({ id: "c", type: "Linear", category: "dense" }),
        ],
      }),
    );
    expect(fig.nodes).toHaveLength(3);
    for (let i = 1; i < fig.nodes.length; i++) {
      expect(fig.nodes[i].left).toBeGreaterThan(fig.nodes[i - 1].right);
    }
  });

  it("renders every block at a substantial size", () => {
    // The regression this guards: a Keras model whose layers carry no
    // output_shape used to fall back to a constant dim, so every block
    // bottomed out at the floor and the figure was thumbnails in whitespace.
    const fig = buildFigure(
      model({
        layers: [
          layer({ id: "a", type: "Dropout", category: "dropout", params: {} }),
          layer({ id: "b", type: "Dense", category: "dense", params: {} }),
        ],
      }),
    );
    for (const n of fig.nodes) {
      expect(n.right - n.left).toBeGreaterThan(60);
      expect(n.bottom - n.top).toBeGreaterThan(100);
    }
  });

  it("scales the tallest block to the target height", () => {
    // Normalisation, not a fixed multiplier: the figure must fill its canvas
    // whether spatial dims span 112→7 or are absent entirely.
    const fig = buildFigure(
      model({
        layers: [
          layer({ id: "a", output_shape: [64, 112, 112] }),
          layer({ id: "b", output_shape: [512, 7, 7] }),
        ],
      }),
      { targetHeight: 300 },
    );
    const tallest = Math.max(...fig.nodes.map((n) => n.bottom - n.top));
    expect(tallest).toBeGreaterThan(280);
  });

  it("keeps a tall model and a flat model at comparable scale", () => {
    const big = buildFigure(
      model({ layers: [layer({ id: "a", output_shape: [64, 224, 224] })] }),
    );
    const small = buildFigure(
      model({ layers: [layer({ id: "a", output_shape: [8, 4, 4] })] }),
    );
    const hBig = big.nodes[0].bottom - big.nodes[0].top;
    const hSmall = small.nodes[0].bottom - small.nodes[0].top;
    expect(Math.abs(hBig - hSmall)).toBeLessThan(hBig * 0.35);
  });

  it("folds ghost copies into the node bounds", () => {
    // Otherwise the next block overlaps the stack and the outgoing arrow
    // starts underneath it.
    const enc = (id: string) =>
      layer({ id, type: "Enc", category: "attention" });
    const solo = buildFigure(model({ layers: [enc("e1")] }));
    const stack = buildFigure(
      model({ layers: [enc("e1"), enc("e2"), enc("e3")] }),
    );
    const soloW = solo.nodes[0].right - solo.nodes[0].left;
    const stackW = stack.nodes[0].right - stack.nodes[0].left;
    expect(stackW).toBeGreaterThan(soloW);
  });

  it("drops connections that fall inside one folded stack", () => {
    // The internal links of a repeated block would scribble over it.
    const enc = (id: string) =>
      layer({ id, type: "Enc", category: "attention" });
    const fig = buildFigure(
      model({
        layers: [enc("e1"), enc("e2"), enc("e3")],
        connections: [
          { from_id: "e1", to_id: "e2", type: "sequential" },
          { from_id: "e2", to_id: "e3", type: "sequential" },
        ],
      }),
    );
    expect(fig.nodes).toHaveLength(1);
    expect(fig.edges).toHaveLength(0);
  });

  it("routes a skip connection as an arc with a merge glyph", () => {
    const fig = buildFigure(
      model({
        layers: [
          layer({ id: "a" }),
          layer({ id: "b", type: "ReLU", category: "activation" }),
          layer({ id: "c", type: "Add", category: "other" }),
        ],
        connections: [
          { from_id: "a", to_id: "b", type: "sequential" },
          { from_id: "b", to_id: "c", type: "sequential" },
          { from_id: "a", to_id: "c", type: "skip" },
        ],
      }),
    );
    const skip = fig.edges.find((e) => e.kind === "skip");
    expect(skip).toBeDefined();
    expect(skip!.mergeAt).toBeDefined();
    expect(skip!.path.startsWith("M")).toBe(true);
  });

  it("reports only the categories actually present", () => {
    const fig = buildFigure(
      model({
        layers: [
          layer({ id: "a", category: "convolution" }),
          layer({ id: "b", category: "pooling", type: "MaxPool2d" }),
          layer({
            id: "c",
            category: "convolution",
            type: "Conv2d",
            param_count: 9,
          }),
        ],
      }),
    );
    expect(fig.categories).toEqual(["convolution", "pooling"]);
  });

  it("sums parameters across a folded stack", () => {
    const enc = (id: string) =>
      layer({ id, type: "Enc", category: "attention", param_count: 1_000_000 });
    const fig = buildFigure(
      model({ layers: [enc("e1"), enc("e2"), enc("e3")] }),
    );
    expect(fig.nodes[0].repeat).toBe(3);
    expect(fig.nodes[0].subtitle).toBe("3.0M total");
  });

  it("never renders an orphaned 'total' for a parameterless stack", () => {
    // formatParams(0) is "", so the repeat branch used to emit " total"
    // under any stacked block with no parameter count.
    const enc = (id: string) =>
      layer({ id, type: "Enc", category: "attention", param_count: undefined });
    const fig = buildFigure(model({ layers: [enc("e1"), enc("e2")] }));
    expect(fig.nodes[0].repeat).toBe(2);
    expect(fig.nodes[0].subtitle).toBe("");
  });

  it("moves a dragged block in the direction it was dragged", () => {
    /*
     * The regression: nudges used to be folded in before the normalisation
     * pass, so dragging a block left lowered minX, which raised offsetX,
     * which pushed every OTHER block right while the dragged one stayed
     * pinned. Left read as right.
     */
    const layers = [
      layer({ id: "a" }),
      layer({ id: "b", type: "ReLU", category: "activation" }),
    ];
    const base = buildFigure(model({ layers }));
    const moved = buildFigure(model({ layers }), {
      offsets: { a: { dx: -60, dy: 0 } },
    });

    // The dragged block goes left...
    expect(moved.nodes[0].left).toBeLessThan(base.nodes[0].left);
    // ...and its untouched neighbour does not move at all.
    expect(moved.nodes[1].left).toBeCloseTo(base.nodes[1].left, 5);
  });

  it("treats +dy as downward, matching pointer deltas", () => {
    const layers = [layer({ id: "a" })];
    const base = buildFigure(model({ layers }));
    const moved = buildFigure(model({ layers }), {
      offsets: { a: { dx: 0, dy: 40 } },
    });
    expect(moved.nodes[0].top).toBeGreaterThan(base.nodes[0].top);
  });

  it("handles an empty model without throwing", () => {
    const fig = buildFigure(model({ layers: [] }));
    expect(fig.nodes).toHaveLength(0);
    expect(fig.width).toBeGreaterThan(0);
    expect(fig.height).toBeGreaterThan(0);
  });
});

describe("deriveDims", () => {
  it("prefers a real tensor shape", () => {
    const wide = deriveDims(layer({ output_shape: [512, 7, 7] }));
    const narrow = deriveDims(layer({ output_shape: [8, 7, 7] }));
    // More channels → wider front face, same spatial height.
    expect(wide.w).toBeGreaterThan(narrow.w);
    expect(wide.h).toBeCloseTo(narrow.h, 5);
  });

  it("falls back to a declared unit count when no shape is known", () => {
    // Keras layers routinely carry `units` without a resolvable shape.
    const big = deriveDims(
      layer({ output_shape: undefined, params: { units: 512 } }),
    );
    const small = deriveDims(
      layer({ output_shape: undefined, params: { units: 8 } }),
    );
    expect(big.w).toBeGreaterThan(small.w);
  });

  it("falls back to param_count when nothing else is known", () => {
    const heavy = deriveDims(
      layer({ output_shape: undefined, params: {}, param_count: 4_200_000 }),
    );
    const light = deriveDims(
      layer({ output_shape: undefined, params: {}, param_count: 42 }),
    );
    expect(heavy.w).toBeGreaterThan(light.w);
  });

  it("makes parameterless layers the smallest thing in the figure", () => {
    const drop = deriveDims(
      layer({
        type: "Dropout",
        category: "dropout",
        output_shape: undefined,
        params: {},
      }),
    );
    const dense = deriveDims(
      layer({ output_shape: undefined, params: {}, param_count: 4200 }),
    );
    expect(drop.h).toBeLessThan(dense.h);
  });
});

describe("buildFigure — flat", () => {
  const enc = (i: number) =>
    layer({
      id: `e${i}`,
      type: "TransformerEncoderLayer",
      category: "attention",
      output_shape: [1, 197, 768],
      param_count: 7_000_000,
    });

  it("collapses depth so the block is a plain rect", () => {
    const flat = buildFigure(model({ layers: [enc(1)] }), { flat: true });
    const n = flat.nodes[0];
    // Zero recession: the right anchor sits on the rect's right edge instead
    // of on a receded back face.
    expect(n.anchorRight.x).toBeCloseTo(n.rect.x + n.rect.w, 6);
    expect(n.rect.h).toBeCloseTo(n.bottom - n.top, 6);
    expect(n.rect.w).toBeGreaterThan(0);
  });

  it("drops ghosts and braces a repeated stack instead", () => {
    const layers = [enc(1), enc(2), enc(3)];
    const flat = buildFigure(model({ layers }), { flat: true });
    const solid = buildFigure(model({ layers }));

    expect(flat.nodes[0].ghosts).toHaveLength(0);
    expect(solid.nodes[0].ghosts.length).toBeGreaterThan(0);

    expect(flat.braces).toHaveLength(1);
    const [brace] = flat.braces;
    expect(brace.x1).toBeCloseTo(flat.nodes[0].left, 6);
    expect(brace.x2).toBeCloseTo(flat.nodes[0].right, 6);
    expect(brace.y).toBeGreaterThan(flat.nodes[0].bottom);
    expect(brace.label).toBe("× 3 TransformerEncoderLayer");

    expect(solid.braces).toEqual([]);
  });

  it("leaves the volumetric build untouched", () => {
    const solid = buildFigure(model({ layers: [enc(1)] }));
    const n = solid.nodes[0];
    // Still recedes, so the right anchor overhangs the front face.
    expect(n.anchorRight.x).toBeGreaterThan(n.rect.x);
    expect(n.faces.top).not.toBe("");
    expect(n.rect.w).toBeGreaterThan(0);
  });
});

describe("formatters", () => {
  it("abbreviates parameter counts", () => {
    expect(formatParams(85_100_000)).toBe("85.1M");
    expect(formatParams(1_500)).toBe("1.5K");
    expect(formatParams(512)).toBe("512");
    expect(formatParams(0)).toBe("");
    expect(formatParams(null)).toBe("");
  });

  it("joins shapes with the multiplication sign", () => {
    expect(formatShape([64, 112, 112])).toBe("64×112×112");
    expect(formatShape([])).toBe("");
    expect(formatShape(undefined)).toBe("");
  });
});
