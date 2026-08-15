/**
 * Layout engine for the neural-network architecture figure.
 *
 * Pure geometry — no React, no DOM, no d3. Everything the renderer needs is
 * computed here so the figure can be unit-tested and so the SVG can be
 * serialised for export without re-running any imperative draw code.
 *
 * ── Projection ────────────────────────────────────────────────────────────
 * Cabinet projection (an oblique axonometric), not true isometric. The x/y
 * axes stay square to the page and only z recedes, at 30° and half scale.
 * That is the convention every good architecture figure uses, because the
 * face carrying the meaning — the one whose height is the spatial dimension
 * and whose width is the channel count — stays undistorted and measurable.
 * True isometric would skew it and make two blocks of equal height look
 * unequal.
 *
 * ── Axis semantics (PlotNeuralNet convention, set by the backend) ─────────
 *   x → channels / features   (block width, horizontal)
 *   y → spatial H             (block height, vertical)
 *   z → spatial W             (extrusion, receding up-right)
 */

import type { NNModel, NNLayer, NNConnection } from "@/lib/api";

/** 30° recession at half depth. */
const Z_ANGLE = Math.PI / 6;
const Z_SCALE = 0.5;
const Z_COS = Math.cos(Z_ANGLE) * Z_SCALE;
const Z_SIN = Math.sin(Z_ANGLE) * Z_SCALE;

export interface Vec2 {
  x: number;
  y: number;
}

export interface FigureNode {
  key: string;
  layer: NNLayer;
  /** How many identical consecutive layers this node stands for. */
  repeat: number;
  /** Layer ids folded into this node (all of them when repeat > 1). */
  memberIds: string[];
  category: string;
  title: string;
  subtitle: string;
  /** Tensor shape rendered as a small annotation above the block. */
  shapeText: string;
  /** Polygon point strings, back-to-front paint order. */
  faces: { front: string; top: string; side: string };
  /** Outline of the whole silhouette, for the crisp keyline. */
  silhouette: string;
  /** Edge midpoints used to anchor connectors. */
  anchorLeft: Vec2;
  anchorRight: Vec2;
  /** Bounds in figure space. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  /** Editor colour override; falls back to the palette when absent. */
  colorOverride?: string;
  /** Ghost copies drawn behind a repeated block, far → near. */
  ghosts: Array<{ front: string; top: string; side: string; opacity: number }>;
}

export interface FigureEdge {
  key: string;
  kind: "sequential" | "skip";
  path: string;
  label?: string;
  labelAt?: Vec2;
  /** Position of the ⊕ merge glyph on a skip connection. */
  mergeAt?: Vec2;
}

export interface Figure {
  width: number;
  height: number;
  nodes: FigureNode[];
  edges: FigureEdge[];
  /** Categories actually present, in first-appearance order. */
  categories: string[];
  title: string;
  meta: string;
}

export interface LayoutOptions {
  /** Front-face height of the tallest block, in px. Everything scales to it. */
  targetHeight?: number;
  /** Horizontal clearance between block silhouettes. */
  gap?: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  /**
   * Per-layer nudges from the auto-layout position, keyed by layer id.
   *
   * Offsets rather than absolute coordinates on purpose: flow layout still
   * owns sizing and order, so a dragged diagram survives adding, deleting or
   * reordering a block instead of scattering. Free placement that forgets
   * the baseline is how hand-drawn diagrams rot.
   */
  offsets?: Record<string, { dx: number; dy: number }>;
  /** Per-layer base colour override, keyed by layer id. */
  colors?: Record<string, string>;
}

/*
 * Sizes are NORMALISED, never absolute.
 *
 * The previous version multiplied the backend's `block_dims` by a fixed
 * constant. That fails in both directions: a ResNet whose spatial dims span
 * 112→7 overflows the page, while a Keras model whose layers carry no
 * `output_shape` at all falls back to a constant dim and every block renders
 * at the minimum — a row of identical thumbnails in an ocean of white.
 *
 * Instead the raw dims are measured, then a single scalar maps the LARGEST
 * block to `targetHeight`. The figure therefore fills its canvas at any
 * model size, and relative proportions between layers are preserved exactly.
 */
const DEFAULTS: Required<LayoutOptions> = {
  targetHeight: 300,
  gap: 104,
  padding: { top: 54, right: 64, bottom: 96, left: 64 },
  offsets: {},
  colors: {},
};

/** Floors, applied after normalisation, so no block becomes a sliver. */
const MIN_FACE_H = 118;
const MIN_FACE_W = 46;
const MIN_DEPTH = 30;
/** Depth is capped so a deep tensor cannot swallow its neighbours. */
const MAX_DEPTH_RATIO = 0.62;

interface RawDims {
  w: number;
  h: number;
  d: number;
}

function logScale(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v) || v <= 0) return lo;
  return lo + (hi - lo) * Math.min(1, Math.log2(v + 1) / 10);
}

function firstNumber(
  params: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const v = params?.[k];
    if (typeof v === "number" && v > 0) return v;
  }
  return null;
}

/**
 * Best available size signal for a layer, most truthful source first.
 *
 * 1. `output_shape` — a real tensor encoding: height = spatial H, width =
 *    channels, depth = spatial W.
 * 2. A declared unit/filter count — `units`, `filters`, `out_channels`,
 *    `out_features`. Keras layers routinely carry this even when the
 *    extractor could not infer a full shape.
 * 3. `param_count` — a coarse but honest proxy for "how much lives here".
 *
 * Falling through to 2 or 3 is why a Keras LSTM stack no longer renders as
 * six identical boxes.
 */
export function deriveDims(layer: NNLayer): RawDims {
  const shape = layer.output_shape;
  const params = layer.params ?? {};

  if (shape && shape.length >= 3) {
    return {
      h: logScale(shape[shape.length - 2], 10, 80),
      d: logScale(shape[shape.length - 1], 8, 60),
      w: logScale(shape[0], 4, 34),
    };
  }
  if (shape && shape.length === 2) {
    return { h: logScale(shape[1], 10, 80), d: 16, w: logScale(shape[0], 4, 34) };
  }
  if (shape && shape.length === 1) {
    return { h: logScale(shape[0], 12, 80), d: 14, w: 8 };
  }

  const units = firstNumber(params, [
    "units",
    "filters",
    "out_channels",
    "out_features",
    "hidden_size",
    "embedding_dim",
    "num_embeddings",
  ]);
  if (units != null) {
    return { h: logScale(units, 26, 80), d: 16, w: logScale(units, 5, 26) };
  }

  const pc = layer.param_count ?? 0;
  if (pc > 0) {
    // /64 keeps a 4K-param Dense from reading as heavier than a 512-channel
    // conv; this branch only orders layers against each other.
    return { h: logScale(pc / 64, 24, 62), d: 15, w: logScale(pc / 64, 5, 20) };
  }

  // Parameterless — dropout, pooling, activation. Deliberately the smallest
  // thing in the figure, which is also the truth about them.
  return { h: 22, d: 13, w: 5 };
}

export function project(x: number, y: number, z: number): Vec2 {
  return { x: x + z * Z_COS, y: -y - z * Z_SIN };
}

function poly(pts: Vec2[]): string {
  return pts.map((p) => `${round(p.x)},${round(p.y)}`).join(" ");
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatParams(count: number | null | undefined): string {
  if (count == null || count <= 0) return "";
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
  return String(count);
}

export function formatShape(shape: number[] | undefined | null): string {
  if (!shape || shape.length === 0) return "";
  return shape.join("×");
}

/**
 * Signature used to fold consecutive identical layers into one stacked node.
 *
 * A 12-layer transformer encoder drawn as 12 identical slabs is 12× the ink
 * for zero extra information — and it squeezes every other block off the
 * page. Folding them into one block with ghost copies behind it and a "× 12"
 * multiplier is how every published transformer figure handles it.
 */
function signature(l: NNLayer): string {
  return [
    l.type,
    l.category,
    l.param_count ?? "",
    formatShape(l.output_shape),
    JSON.stringify(l.params ?? {}),
  ].join("|");
}

interface Group {
  layer: NNLayer;
  repeat: number;
  memberIds: string[];
}

export function groupRepeats(layers: NNLayer[]): Group[] {
  const out: Group[] = [];
  for (const layer of layers) {
    const prev = out[out.length - 1];
    if (prev && signature(prev.layer) === signature(layer)) {
      prev.repeat += 1;
      prev.memberIds.push(layer.id);
    } else {
      out.push({ layer, repeat: 1, memberIds: [layer.id] });
    }
  }
  return out;
}

/** Cuboid faces in figure space, centred on (cx, cy) of the front face. */
function cuboid(cx: number, cy: number, w: number, h: number, d: number) {
  const at = (x: number, y: number, z: number): Vec2 => {
    const p = project(x, y, z);
    return { x: cx + p.x, y: cy + p.y };
  };

  const hw = w / 2;
  const hh = h / 2;

  // Front plane at z = 0, back plane at z = d. Extruding backwards (rather
  // than centring on z) keeps the front face — the one being measured —
  // exactly where the layout puts it.
  const f = {
    bl: at(-hw, -hh, 0),
    br: at(hw, -hh, 0),
    tr: at(hw, hh, 0),
    tl: at(-hw, hh, 0),
  };
  const b = {
    bl: at(-hw, -hh, d),
    br: at(hw, -hh, d),
    tr: at(hw, hh, d),
    tl: at(-hw, hh, d),
  };

  return {
    front: poly([f.bl, f.br, f.tr, f.tl]),
    top: poly([f.tl, f.tr, b.tr, b.tl]),
    side: poly([f.br, b.br, b.tr, f.tr]),
    // Silhouette traces the outer boundary only, so the keyline never
    // double-strokes the two interior seams.
    silhouette: poly([f.bl, f.br, b.br, b.tr, b.tl, f.tl]),
    anchorLeft: { x: f.bl.x, y: (f.bl.y + f.tl.y) / 2 },
    anchorRight: { x: b.br.x, y: (b.br.y + b.tr.y) / 2 },
    minX: f.bl.x,
    maxX: b.br.x,
    minY: b.tl.y,
    maxY: f.bl.y,
  };
}

export function buildFigure(model: NNModel, opts: LayoutOptions = {}): Figure {
  /*
   * Resolved field-by-field, NOT by spreading `opts` over `DEFAULTS`.
   *
   * Object spread copies explicitly-undefined keys: `{...DEFAULTS, ...{offsets:
   * undefined}}` yields `offsets: undefined`, not the default `{}`. Callers
   * forward optional props straight through, so those keys arrive defined-as-
   * undefined and the defaults were being erased — then `offsets[id]` threw.
   */
  const targetHeight = opts.targetHeight ?? DEFAULTS.targetHeight;
  const gap = opts.gap ?? DEFAULTS.gap;
  const padding = opts.padding ?? DEFAULTS.padding;
  const offsets = opts.offsets ?? DEFAULTS.offsets;
  const colors = opts.colors ?? DEFAULTS.colors;
  const groups = groupRepeats(model.layers ?? []);

  // Ghost offset per repeated copy, in projected space.
  const GHOST_STEP = 22;

  interface Placed {
    g: Group;
    cx: number;
    cy: number;
    w: number;
    h: number;
    d: number;
    box: ReturnType<typeof cuboid>;
  }

  // Measure every block first, then derive ONE scalar that maps the tallest
  // to `targetHeight`. See the note on DEFAULTS.
  const raw = groups.map((g) => deriveDims(g.layer));
  const tallest = Math.max(...raw.map((r) => r.h), 1);
  const k = targetHeight / tallest;

  const placed: Placed[] = [];
  let cursor = 0;

  groups.forEach((g, i) => {
    const r = raw[i];
    const h = Math.max(r.h * k, MIN_FACE_H);
    const w = Math.max(r.w * k, MIN_FACE_W);
    const d = Math.min(
      Math.max(r.d * k, MIN_DEPTH),
      targetHeight * MAX_DEPTH_RATIO,
    );

    const ghostSpan = g.repeat > 1 ? GHOST_STEP * Math.min(g.repeat - 1, 3) : 0;

    // Provisional box at origin to measure its projected extent, since the
    // z-recession makes the silhouette wider than w.
    const probe = cuboid(0, 0, w, h, d);
    const cx = cursor - probe.minX;

    /*
     * Placement is FLOW-ONLY. Nudges are applied later, when the final boxes
     * are built.
     *
     * They used to be folded in here, before the normalisation pass — which
     * meant dragging a block left lowered `minX`, which raised `offsetX`,
     * which shifted every OTHER block right while the dragged one stayed
     * pinned. The drag read as inverted. The frame has to derive from the
     * layout alone so a nudge moves one block against a fixed background.
     */
    placed.push({ g, cx, cy: 0, w, h, d, box: cuboid(cx, 0, w, h, d) });
    // The cursor advances along the *flow* position, not the nudged one, so
    // dragging one block never cascades the whole row.
    cursor = cx + probe.maxX + ghostSpan + gap;
  });

  // Vertical extents including ghosts, labels and skip arcs.
  const minY = Math.min(...placed.map((p) => p.box.minY), 0);
  const maxY = Math.max(...placed.map((p) => p.box.maxY), 0);
  const minX = Math.min(...placed.map((p) => p.box.minX), 0);
  const offsetY = padding.top - minY;
  // Normalised on X too now: a block dragged left of the origin used to be
  // clipped by the viewBox rather than growing the canvas.
  const offsetX = padding.left - minX;

  const nodes: FigureNode[] = placed.map((p, i) => {
    // Screen-space delta: `cuboid` adds cx/cy AFTER projection, so +dx is
    // right and +dy is down. No axis flip belongs here.
    const nudge = offsets[p.g.layer.id] ?? { dx: 0, dy: 0 };
    const box = cuboid(
      p.cx + offsetX + nudge.dx,
      p.cy + offsetY + nudge.dy,
      p.w,
      p.h,
      p.d,
    );
    const ghosts = [];
    // Ghosts extend the silhouette up and to the right, so they have to be
    // folded into the node's bounds — otherwise the next block overlaps them
    // and the outgoing arrow starts underneath the stack.
    let ghostRight = box.maxX;
    let ghostTop = box.minY;
    if (p.g.repeat > 1) {
      const copies = Math.min(p.g.repeat - 1, 3);
      for (let k = copies; k >= 1; k--) {
        const gb = cuboid(
          p.cx + offsetX + nudge.dx + GHOST_STEP * k,
          p.cy + offsetY + nudge.dy - GHOST_STEP * k * Z_SIN * 2,
          p.w,
          p.h,
          p.d,
        );
        ghosts.push({
          front: gb.front,
          top: gb.top,
          side: gb.side,
          opacity: 0.1 + 0.09 * (copies - k),
        });
        ghostRight = Math.max(ghostRight, gb.maxX);
        ghostTop = Math.min(ghostTop, gb.minY);
      }
    }

    const params = p.g.layer.param_count ?? 0;
    const totalParams = params * p.g.repeat;

    return {
      key: `${p.g.layer.id}-${i}`,
      layer: p.g.layer,
      repeat: p.g.repeat,
      memberIds: p.g.memberIds,
      category: p.g.layer.category,
      title: p.g.layer.type,
      // `formatParams` returns "" for a parameterless layer, so the repeat
      // branch used to render a subtitle of just " total" — an orphaned word
      // under any stacked block with no parameter count.
      subtitle: (() => {
        const text = formatParams(p.g.repeat > 1 ? totalParams : params);
        if (!text) return "";
        return p.g.repeat > 1 ? `${text} total` : text;
      })(),
      shapeText: formatShape(p.g.layer.output_shape),
      colorOverride: colors[p.g.layer.id],
      faces: { front: box.front, top: box.top, side: box.side },
      silhouette: box.silhouette,
      anchorLeft: box.anchorLeft,
      anchorRight: box.anchorRight,
      left: box.minX,
      right: ghostRight,
      top: ghostTop,
      bottom: box.maxY,
      centerX: (box.minX + box.maxX) / 2,
      ghosts,
    };
  });

  // ── Connections ─────────────────────────────────────────────────────────
  // Members are folded, so a connection is mapped to whichever node absorbed
  // its endpoint. Edges that end up inside a single folded node are dropped —
  // they are the internal links of a repeated stack and drawing them would
  // scribble over the block.
  const idToNode = new Map<string, number>();
  nodes.forEach((n, i) => n.memberIds.forEach((id) => idToNode.set(id, i)));

  const edges: FigureEdge[] = [];
  const seen = new Set<string>();

  for (const conn of (model.connections ?? []) as NNConnection[]) {
    const a = idToNode.get(conn.from_id);
    const b = idToNode.get(conn.to_id);
    if (a === undefined || b === undefined || a === b) continue;

    const dedupe = `${a}->${b}:${conn.type}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    const from = nodes[a];
    const to = nodes[b];

    if (conn.type === "sequential" && b === a + 1) {
      const y = (from.anchorRight.y + to.anchorLeft.y) / 2;
      edges.push({
        key: dedupe,
        kind: "sequential",
        path: `M ${round(from.right)} ${round(y)} L ${round(to.left)} ${round(y)}`,
        label: from.shapeText || undefined,
        labelAt: { x: (from.right + to.left) / 2, y: y - 12 },
      });
    } else if (conn.type !== "sequential") {
      // Skip / residual / concat — an arc over the top, clear of the blocks.
      const x1 = from.centerX;
      const x2 = to.centerX;
      const peak = Math.min(from.top, to.top) - 52;
      const mid = (x1 + x2) / 2;
      edges.push({
        key: dedupe,
        kind: "skip",
        path: `M ${round(x1)} ${round(from.top)} C ${round(x1)} ${round(peak)}, ${round(x2)} ${round(peak)}, ${round(x2)} ${round(to.top)}`,
        label: conn.label,
        mergeAt: { x: mid, y: (from.top + peak) / 2 - 6 },
      });
    }
  }

  const categories: string[] = [];
  for (const n of nodes) {
    if (!categories.includes(n.category)) categories.push(n.category);
  }

  // Bounds are read back off the placed nodes rather than the pre-offset
  // probes, so ghosts, skip arcs and captions are all inside the canvas and
  // the figure has no dead margin.
  const skipHeadroom = edges.some((e) => e.kind === "skip") ? 78 : 0;
  const width = Math.max(...nodes.map((n) => n.right), 0) + padding.right;
  const contentTop = Math.min(...nodes.map((n) => n.top), offsetY);
  const contentBottom = Math.max(...nodes.map((n) => n.bottom), offsetY);
  const height =
    contentBottom - contentTop + padding.top + padding.bottom + skipHeadroom;

  const totalParams =
    model.total_params ??
    (model.layers ?? []).reduce((s, l) => s + (l.param_count ?? 0), 0);

  return {
    width: Math.max(width, 640),
    height: Math.max(height, 380),
    nodes,
    edges,
    categories,
    title: model.name,
    meta: [
      model.framework,
      `${(model.layers ?? []).length} layers`,
      totalParams ? `${formatParams(totalParams)} params` : "",
    ]
      .filter(Boolean)
      .join("  ·  "),
  };
}
