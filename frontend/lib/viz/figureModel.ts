/**
 * The editable document behind the figure editor.
 *
 * `buildFigure` already consumes an `NNModel`, so the editor keeps its state
 * in that same shape rather than inventing a parallel one. Every edit is a
 * pure transform producing a new NNModel, which means:
 *
 *   · the live preview is literally the same renderer as the read-only view —
 *     no second code path to drift,
 *   · undo is a stack of previous documents, not a log of inverse operations,
 *   · a hand-built diagram and a detected one are indistinguishable
 *     downstream, so export works identically for both.
 */

import type { NNModel, NNLayer, NNConnection } from "@/lib/api";
import { CATEGORIES } from "./palettes";

let seq = 0;
/** Ids only need to be unique within one document. */
function nextId(prefix = "layer"): string {
  seq += 1;
  return `${prefix}-${seq}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Sensible starting geometry per category, so a new block looks right. */
type PresetParam = number | string | boolean;
const PRESETS: Record<
  string,
  { type: string; units?: number; params?: Record<string, PresetParam> }
> = {
  convolution: { type: "Conv2d", units: 64, params: { kernel_size: 3 } },
  pooling: { type: "MaxPool2d", params: { kernel_size: 2 } },
  dense: { type: "Linear", units: 512 },
  normalization: { type: "BatchNorm2d" },
  activation: { type: "ReLU" },
  dropout: { type: "Dropout", params: { p: 0.5 } },
  recurrent: { type: "LSTM", units: 256 },
  attention: { type: "MultiHeadAttention", units: 768, params: { heads: 12 } },
  embedding: { type: "Embedding", units: 768 },
  output: { type: "Softmax" },
  other: { type: "Block" },
};

export function makeLayer(category: string): NNLayer {
  const preset = PRESETS[category] ?? PRESETS.other;
  return {
    id: nextId(category),
    type: preset.type,
    category,
    params: {
      ...(preset.params ?? {}),
      ...(preset.units ? { units: preset.units } : {}),
    },
    param_count: undefined,
    output_shape: undefined,
  };
}

export function emptyModel(name = "Untitled"): NNModel {
  return {
    name,
    file: "",
    line: 0,
    framework: "custom",
    type: "sequential",
    layers: [],
    connections: [],
  } as NNModel;
}

/**
 * Rebuild the sequential chain after any structural edit.
 *
 * Skip connections are preserved by id, but only where BOTH endpoints still
 * exist — a residual pointing at a deleted block would otherwise render as an
 * arc into empty space.
 */
export function relink(model: NNModel): NNModel {
  const ids = model.layers.map((l) => l.id);
  const alive = new Set(ids);

  const sequential: NNConnection[] = [];
  for (let i = 1; i < ids.length; i++) {
    sequential.push({ from_id: ids[i - 1], to_id: ids[i], type: "sequential" });
  }

  const skips = (model.connections ?? []).filter(
    (c) => c.type !== "sequential" && alive.has(c.from_id) && alive.has(c.to_id),
  );

  return { ...model, connections: [...sequential, ...skips] };
}

// ── Edits ────────────────────────────────────────────────────────────────

export function addLayer(
  model: NNModel,
  category: string,
  atIndex?: number,
): { model: NNModel; id: string } {
  const layer = makeLayer(category);
  const layers = [...model.layers];
  layers.splice(atIndex ?? layers.length, 0, layer);
  return { model: relink({ ...model, layers }), id: layer.id };
}

export function removeLayer(model: NNModel, id: string): NNModel {
  return relink({
    ...model,
    layers: model.layers.filter((l) => l.id !== id),
  });
}

export function duplicateLayer(model: NNModel, id: string): NNModel {
  const i = model.layers.findIndex((l) => l.id === id);
  if (i < 0) return model;
  const copy: NNLayer = {
    ...model.layers[i],
    id: nextId(model.layers[i].category),
    params: { ...model.layers[i].params },
  };
  const layers = [...model.layers];
  layers.splice(i + 1, 0, copy);
  return relink({ ...model, layers });
}

/** Move the layer at `from` so it sits at index `to`. */
export function moveLayer(model: NNModel, from: number, to: number): NNModel {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= model.layers.length ||
    to >= model.layers.length
  ) {
    return model;
  }
  const layers = [...model.layers];
  const [moved] = layers.splice(from, 1);
  layers.splice(to, 0, moved);
  return relink({ ...model, layers });
}

export function updateLayer(
  model: NNModel,
  id: string,
  patch: Partial<NNLayer>,
): NNModel {
  return {
    ...model,
    layers: model.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  };
}

/**
 * Set how many times a block repeats.
 *
 * The figure derives `×N` from a run of consecutive identical layers rather
 * than storing a count, so "repeat" is really "how many adjacent twins does
 * this layer have". Editing it adds or removes those twins, which keeps the
 * document a plain layer list and means a hand-built ×12 encoder stack folds
 * exactly like a detected one.
 */
export function setRepeat(model: NNModel, id: string, n: number): NNModel {
  const target = Math.max(1, Math.min(Math.round(n) || 1, 64));
  const i = model.layers.findIndex((l) => l.id === id);
  if (i < 0) return model;

  const proto = model.layers[i];
  const sig = (l: NNLayer) =>
    `${l.type}|${l.category}|${l.param_count ?? ""}|${JSON.stringify(l.params ?? {})}|${(l.output_shape ?? []).join("x")}`;
  const key = sig(proto);

  // Find the full run this layer belongs to.
  let start = i;
  while (start > 0 && sig(model.layers[start - 1]) === key) start--;
  let end = i;
  while (end < model.layers.length - 1 && sig(model.layers[end + 1]) === key) end++;

  const run: NNLayer[] = [];
  for (let k = 0; k < target; k++) {
    run.push(
      k === 0
        ? proto
        : { ...proto, id: nextId(proto.category), params: { ...proto.params } },
    );
  }

  const layers = [
    ...model.layers.slice(0, start),
    ...run,
    ...model.layers.slice(end + 1),
  ];
  return relink({ ...model, layers });
}

/** How many adjacent twins a layer currently has, inclusive. */
export function repeatOf(model: NNModel, id: string): number {
  const i = model.layers.findIndex((l) => l.id === id);
  if (i < 0) return 1;
  const sig = (l: NNLayer) =>
    `${l.type}|${l.category}|${l.param_count ?? ""}|${JSON.stringify(l.params ?? {})}|${(l.output_shape ?? []).join("x")}`;
  const key = sig(model.layers[i]);
  let n = 1;
  for (let k = i - 1; k >= 0 && sig(model.layers[k]) === key; k--) n++;
  for (let k = i + 1; k < model.layers.length && sig(model.layers[k]) === key; k++) n++;
  return n;
}

/** Toggle a residual arc between two blocks. */
export function toggleSkip(
  model: NNModel,
  fromId: string,
  toId: string,
): NNModel {
  const exists = (model.connections ?? []).some(
    (c) => c.type === "skip" && c.from_id === fromId && c.to_id === toId,
  );
  const connections = exists
    ? model.connections.filter(
        (c) => !(c.type === "skip" && c.from_id === fromId && c.to_id === toId),
      )
    : [...model.connections, { from_id: fromId, to_id: toId, type: "skip" as const }];
  return { ...model, connections };
}

/** Parse a user-typed "64x112x112" (or "64, 112, 112") into a shape. */
export function parseShape(text: string): number[] | undefined {
  const parts = text
    .split(/[×x,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n <= 0)) {
    return undefined;
  }
  return parts;
}

export const ADDABLE_CATEGORIES = CATEGORIES;
