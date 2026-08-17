import { describe, it, expect } from "vitest";
import {
  addLayer,
  duplicateLayer,
  emptyModel,
  moveLayer,
  parseShape,
  relink,
  removeLayer,
  repeatOf,
  setRepeat,
  toggleSkip,
  updateLayer,
} from "../figureModel";

function build(...cats: string[]) {
  let m = emptyModel("Test");
  for (const c of cats) m = addLayer(m, c).model;
  return m;
}

const seqIds = (m: ReturnType<typeof build>) =>
  m.connections.filter((c) => c.type === "sequential").map((c) => [c.from_id, c.to_id]);

describe("relink", () => {
  it("rebuilds the sequential chain in list order", () => {
    const m = build("convolution", "activation", "dense");
    expect(seqIds(m)).toEqual([
      [m.layers[0].id, m.layers[1].id],
      [m.layers[1].id, m.layers[2].id],
    ]);
  });

  it("drops residuals whose endpoint no longer exists", () => {
    // An arc into empty space would still render; it has to be pruned.
    let m = build("convolution", "activation", "dense");
    m = toggleSkip(m, m.layers[0].id, m.layers[2].id);
    expect(m.connections.filter((c) => c.type === "skip")).toHaveLength(1);

    m = removeLayer(m, m.layers[2].id);
    expect(m.connections.filter((c) => c.type === "skip")).toHaveLength(0);
  });

  it("is idempotent", () => {
    const m = build("convolution", "dense");
    expect(relink(relink(m)).connections).toEqual(relink(m).connections);
  });
});

describe("structural edits", () => {
  it("adds a layer at the end by default", () => {
    const m = build("convolution", "dense");
    expect(m.layers.map((l) => l.category)).toEqual(["convolution", "dense"]);
  });

  it("inserts at an index when asked", () => {
    let m = build("convolution", "dense");
    m = addLayer(m, "activation", 1).model;
    expect(m.layers.map((l) => l.category)).toEqual([
      "convolution",
      "activation",
      "dense",
    ]);
  });

  it("moves a layer and relinks around it", () => {
    let m = build("convolution", "activation", "dense");
    const movedId = m.layers[2].id;
    m = moveLayer(m, 2, 0);
    expect(m.layers[0].id).toBe(movedId);
    expect(seqIds(m)[0][0]).toBe(movedId);
  });

  it("ignores an out-of-range move", () => {
    const m = build("convolution", "dense");
    expect(moveLayer(m, 0, 9)).toBe(m);
    expect(moveLayer(m, -1, 0)).toBe(m);
  });

  it("duplicates with a fresh id so the two are independent", () => {
    let m = build("convolution");
    m = duplicateLayer(m, m.layers[0].id);
    expect(m.layers).toHaveLength(2);
    expect(m.layers[0].id).not.toBe(m.layers[1].id);
  });

  it("updates only the targeted layer", () => {
    let m = build("convolution", "dense");
    m = updateLayer(m, m.layers[0].id, { type: "Renamed" });
    expect(m.layers[0].type).toBe("Renamed");
    expect(m.layers[1].type).not.toBe("Renamed");
  });
});

describe("repeat", () => {
  it("expands a layer into adjacent twins", () => {
    // ×N is derived from a run of identical layers, so setting it has to
    // materialise those twins rather than store a count.
    let m = build("attention");
    m = setRepeat(m, m.layers[0].id, 12);
    expect(m.layers).toHaveLength(12);
    expect(repeatOf(m, m.layers[0].id)).toBe(12);
  });

  it("collapses a run back down", () => {
    let m = build("attention");
    m = setRepeat(m, m.layers[0].id, 6);
    m = setRepeat(m, m.layers[0].id, 2);
    expect(m.layers).toHaveLength(2);
  });

  it("leaves neighbouring layers untouched", () => {
    let m = build("embedding", "attention", "dense");
    m = setRepeat(m, m.layers[1].id, 4);
    expect(m.layers.map((l) => l.category)).toEqual([
      "embedding",
      "attention",
      "attention",
      "attention",
      "attention",
      "dense",
    ]);
  });

  it("clamps to a sane range", () => {
    let m = build("dense");
    m = setRepeat(m, m.layers[0].id, 0);
    expect(m.layers).toHaveLength(1);
    m = setRepeat(m, m.layers[0].id, 9999);
    expect(m.layers.length).toBeLessThanOrEqual(64);
  });
});

describe("toggleSkip", () => {
  it("adds then removes the same residual", () => {
    let m = build("convolution", "activation", "dense");
    const [a, , c] = m.layers;
    m = toggleSkip(m, a.id, c.id);
    expect(m.connections.some((x) => x.type === "skip")).toBe(true);
    m = toggleSkip(m, a.id, c.id);
    expect(m.connections.some((x) => x.type === "skip")).toBe(false);
  });
});

describe("parseShape", () => {
  it("accepts the separators people actually type", () => {
    expect(parseShape("64x112x112")).toEqual([64, 112, 112]);
    expect(parseShape("64×112×112")).toEqual([64, 112, 112]);
    expect(parseShape("64, 112, 112")).toEqual([64, 112, 112]);
    expect(parseShape(" 512 768 ")).toEqual([512, 768]);
  });

  it("rejects anything non-positive or unparseable", () => {
    expect(parseShape("")).toBeUndefined();
    expect(parseShape("abc")).toBeUndefined();
    expect(parseShape("64x0")).toBeUndefined();
    expect(parseShape("-4x8")).toBeUndefined();
  });
});
