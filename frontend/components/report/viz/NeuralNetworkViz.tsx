/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

/**
 * NeuralNetworkViz — isometric architecture figure.
 *
 * The visual language is PlotNeuralNet's: each layer is an oblique-projected
 * cuboid. Two axes carry data — height is the spatial footprint (from
 * `_propagate_spatial_shapes` in `backend/codekavi/nn_extractor.py`) and
 * thickness is the channel count — so `conv1` renders as a tall slab and
 * `layer4` as a short thick one, even though `layer4` holds most of the
 * weights. Depth is a FIXED lip, not a third data channel: it exists only to
 * make a block read as a solid rather than a rectangle. Parameter mass gets
 * its own panel rather than overwriting the geometry.
 *
 * The figure always draws on its own near-white paper panel, in both themes —
 * this chart deliberately opts out of theme-following (unlike every other
 * chart in the suite) because the reference figures it is chasing are
 * ink-on-paper, and a figure that looks different on screen than exported is
 * not publishable straight from a screenshot.
 *
 * Height is RELATIVE (1.0 at the input, halved per stride-2 layer) because
 * repo code almost never states its input resolution. Arrows print the
 * CHANNEL width when the source declares one (`feature_width`); the full
 * `64x112x112` form only appears where the code states an input shape.
 *
 * Repeated blocks always collapse — a twelve-layer encoder stack drawn as
 * forty-eight cuboids is unreadable. Clicking one opens a detail panel below
 * the figure showing that repetition's internals as flat nodes, the way the
 * transformer reference draws its "Encoder Layer" callout. The main figure
 * never reflows to show it.
 *
 * Chrome comes from `VizShell` (T12).
 */

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { Layers } from "lucide-react";
import { useVizCanvas } from "@/components/viz/useVizCanvas";
import { useVizZoom } from "@/components/viz/useVizZoom";
import { useVizNodeNav } from "@/components/viz/useVizNodeNav";
import { useReducedMotion } from "@/components/viz/useReducedMotion";
import {
  VizShell,
  VizLegend,
  VizTooltip,
  VizMessage,
  type VizLegendItem,
} from "@/components/viz/VizShell";
import { useMediaQuery, NARROW_QUERY } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import type { NNModel, NNLayer, NNRepeat } from "@/lib/api";
import { catVar } from "@/lib/viz/tokens";

/**
 * Concrete paper palette.
 *
 * Deliberately not theme tokens (`lib/viz/tokens.ts`). D1: the figure is
 * ink-on-paper in both themes, so what a user screenshots is what they can
 * paste into a slide — no export step required to get a publishable image.
 */
const PAPER_BG = "#FDFDFC";
const PAPER_BORDER = "#E4E4E1";
const INK = "#111827";
const INK_DIM = "#6B7280";
/** Also the residual/leader-line color — a grey hairline, not a saturated theme accent. */
const INK_FAINT = "#9CA3AF";
const SKIP_COLOR = INK_FAINT;

/**
 * Exported for a regression test only: this figure's ink must stay concrete.
 * Every other chart in the suite follows the app theme via `hsl(var(--x))`;
 * this one deliberately does not (D1), so a `var(` creeping back into any of
 * these would silently reintroduce the "invisible on export" failure mode
 * `toPaperPalette` used to patch over.
 */
export const NN_PAPER_INK = { PAPER_BG, PAPER_BORDER, INK, INK_DIM, INK_FAINT } as const;

/**
 * Layer-type palette.
 *
 * The one sanctioned hex palette in the viz suite (DESIGN.md §2): a genuine
 * categorical encoding that needs base/top/side face shading for the
 * isometric render, which flat tokens do not carry. Tuned to read on the
 * paper ground specifically — this chart does not need to also pass contrast
 * on a dark card, since it never draws on one.
 */
const CATEGORY_COLORS: Record<string, { base: string; top: string; side: string }> = {
  convolution:   { base: "#4A90D9", top: "#6BABEF", side: "#3570B0" },
  pooling:       { base: "#E8734A", top: "#F09B7A", side: "#C05A35" },
  dense:         { base: "#5CB85C", top: "#7ED47E", side: "#449944" },
  normalization: { base: "#F5A623", top: "#F8C060", side: "#D08E1C" },
  activation:    { base: "#9B59B6", top: "#B87AD0", side: "#7D4492" },
  dropout:       { base: "#95A5A6", top: "#B0BCBD", side: "#778889" },
  recurrent:     { base: "#1ABC9C", top: "#48D4B8", side: "#149A7E" },
  attention:     { base: "#E91E63", top: "#F06292", side: "#C2185B" },
  embedding:     { base: "#3F51B5", top: "#7986CB", side: "#303F9F" },
  output:        { base: "#C0392B", top: "#E06055", side: "#A02D22" },
  other:         { base: "#607D8B", top: "#8EAAB5", side: "#4A6470" },
};

const CATEGORY_LABELS: Record<string, string> = {
  convolution: "Convolution",
  pooling: "Pooling",
  dense: "Dense / FC",
  normalization: "Normalization",
  activation: "Activation",
  dropout: "Dropout",
  recurrent: "Recurrent",
  attention: "Attention",
  embedding: "Embedding",
  output: "Output",
  other: "Other",
};

const colorsFor = (category: string) => CATEGORY_COLORS[category] ?? CATEGORY_COLORS.other;
/** The category key actually used for gradient lookups — unknown categories fall back to "other". */
const categoryKey = (category: string) => (CATEGORY_COLORS[category] ? category : "other");

/* ── Color math for the face gradients ───────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lighten(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`;
}
function darken(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r * (1 - t))},${Math.round(g * (1 - t))},${Math.round(b * (1 - t))})`;
}

/* ── Geometry ─────────────────────────────────────────────── */

const ISO_ANGLE = Math.PI / 6; // 30 degrees
const Z_SCALE = 0.6;
const Z_X = Z_SCALE * Math.cos(ISO_ANGLE);
const Z_Y = Z_SCALE * Math.sin(ISO_ANGLE);

function isoProject(x: number, y: number, z: number) {
  return { sx: x + z * Z_X, sy: -y - z * Z_Y };
}

/**
 * @param w thickness along the flow axis (channels)
 * @param h spatial height
 * @param d depth of the oblique extrusion — a fixed lip, not spatial data
 */
function buildCuboidPolygons(cx: number, cy: number, w: number, h: number, d: number) {
  const corners = [
    { x: -w / 2, y: -h / 2, z: -d / 2 },
    { x:  w / 2, y: -h / 2, z: -d / 2 },
    { x:  w / 2, y:  h / 2, z: -d / 2 },
    { x: -w / 2, y:  h / 2, z: -d / 2 },
    { x: -w / 2, y: -h / 2, z:  d / 2 },
    { x:  w / 2, y: -h / 2, z:  d / 2 },
    { x:  w / 2, y:  h / 2, z:  d / 2 },
    { x: -w / 2, y:  h / 2, z:  d / 2 },
  ].map((c) => {
    const p = isoProject(c.x, c.y, c.z);
    return { x: cx + p.sx, y: cy + p.sy };
  });

  const poly = (...idx: number[]) => idx.map((i) => `${corners[i].x},${corners[i].y}`).join(" ");
  const mid = (...idx: number[]) => ({
    x: idx.reduce((s, i) => s + corners[i].x, 0) / idx.length,
    y: idx.reduce((s, i) => s + corners[i].y, 0) / idx.length,
  });

  return {
    front: poly(0, 1, 2, 3),
    top: poly(3, 2, 6, 7),
    right: poly(1, 5, 6, 2),
    center: { x: cx, y: cy },
    rightAnchor: mid(1, 5, 6, 2),
    leftAnchor: mid(0, 4, 7, 3),
    /** Bottom corners of the FRONT face — where a leader line to a detail panel starts. */
    frontBottomLeft: corners[0],
    frontBottomRight: corners[1],
    lowestY: Math.max(corners[0].y, corners[1].y, corners[4].y, corners[5].y),
    highestY: Math.min(corners[3].y, corners[2].y, corners[6].y, corners[7].y),
  };
}

type Cuboid = ReturnType<typeof buildCuboidPolygons>;

/* ── Formatting ───────────────────────────────────────────── */

function formatParamCount(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(count)) return "—";
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
  return String(count);
}

function formatShape(shape: number[] | undefined): string {
  return shape?.length ? shape.join("×") : "";
}

/**
 * The channel/feature width to print on an arrow, or "" if none is known.
 *
 * Prefers the full declared tensor shape (rare — only when the source states
 * an input size); falls back to the channel width alone, which the extractor
 * carries forward from the last layer that declared one. Never invented: an
 * unresolvable layer upstream leaves this "" rather than guessing.
 */
function arrowLabel(layer: NNLayer): string {
  const shape = formatShape(layer.output_shape);
  if (shape) return shape;
  return layer.feature_width != null ? String(layer.feature_width) : "";
}

/**
 * What to write under a block.
 *
 * The extractor names a layer after the attribute it was assigned to, so `id`
 * is already `conv1` / `layer1` / `fc` — exactly what the reference figure
 * labels. Drawing `type` instead gave a ResNet five blocks all reading
 * "Conv2d". Sequential children are the one exception: they get generated ids
 * like `blocks_3`, where the type is the more useful of the two.
 */
const GENERATED_ID = /_\d+$/;

function slotLabel(layer: NNLayer): string {
  const id = layer.id ?? "";
  return !id || GENERATED_ID.test(id) ? layer.type : id;
}

/* ── Slot model ───────────────────────────────────────────── */

/**
 * One drawn cuboid.
 *
 * A repeat contributes exactly ONE slot for the whole period, not `length`
 * of them — a 6-layer "encoder layer" repeated 12 times draws one outer
 * block with a ghost stack behind it, not six individually captioned blocks
 * shoulder to shoulder. Drawing one slot per layer in the period looked
 * right for a period of 1 (a single repeated Conv2d) but fell apart for
 * anything longer: six caption baselines packed into the width of six THIN
 * blocks overlap into unreadable text. The reference figure's "Encoder
 * Layer" is one block; its internals only ever appear in the detail panel
 * (D3). Every layer id in the whole span — every repetition, every position
 * in the period — maps to this one slot, which is what keeps a connection
 * into or out of any repetition landing on a drawn cuboid.
 */
interface Slot {
  layer: NNLayer;
  /** Set when this slot represents a collapsed repeat. */
  group?: NNRepeat;
  /** A group slot is always both — kept as two fields because the brace-
   * and panel-anchoring code below treats "the group" as a span, and a
   * single-slot span is the degenerate case of that, not a special one. */
  groupStart?: boolean;
  groupEnd?: boolean;
}

export function buildSlots(
  layers: NNLayer[],
  repeats: NNRepeat[],
): { slots: Slot[]; layerToSlot: Map<string, number> } {
  const repeatAt = new Map<number, NNRepeat>();
  for (const r of repeats) repeatAt.set(r.start, r);

  const slots: Slot[] = [];
  const layerToSlot = new Map<string, number>();

  let i = 0;
  while (i < layers.length) {
    const repeat = repeatAt.get(i);
    const span = repeat ? repeat.length * repeat.count : 0;

    if (repeat && span > 0) {
      const index = slots.length;
      // Sized after the TALLEST layer in the period, not the first — an
      // outer block shorter than what it contains would misrepresent its
      // own silhouette. Category/type/params ride along from that same
      // layer so the block still colors and describes itself sensibly;
      // label and per-block param count come from the repeat itself.
      const period = layers.slice(i, i + repeat.length);
      const tallest = period.reduce((a, b) =>
        (b.block_dims?.height ?? 0) > (a.block_dims?.height ?? 0) ? b : a,
      );
      slots.push({
        layer: {
          ...tallest,
          id: `__repeat_${repeat.start}`,
          param_count: repeat.param_count ?? tallest.param_count,
        },
        group: repeat,
        groupStart: true,
        groupEnd: true,
      });
      // Every layer id in every repetition — not just the first — maps to
      // this one slot, so a connection anywhere in the span lands on it.
      for (let k = 0; k < span && i + k < layers.length; k++) {
        layerToSlot.set(layers[i + k].id, index);
      }
      i += span;
      continue;
    }

    layerToSlot.set(layers[i].id, slots.length);
    slots.push({ layer: layers[i] });
    i += 1;
  }

  return { slots, layerToSlot };
}

/* ── Layout constants ─────────────────────────────────────── */

const SCALE = 1.8;
// Spacing is derived from the blocks at draw time, not fixed here: a constant
// gap is either cavernous around a small Keras model or cramped on a ResNet.
const GHOST_MAX = 3;
const GHOST_DX = 15;
const GHOST_DY = -11;
const SVG_NS = "http://www.w3.org/2000/svg";

/* ── Component ────────────────────────────────────────────── */

interface ModelFigureProps {
  model: NNModel;
  massPanelOpen: boolean;
}

function ModelFigure({ model, massPanelOpen }: ModelFigureProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvas = useVizCanvas();
  const reducedMotion = useReducedMotion();
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const zoom = useVizZoom(!reducedMotion);

  /** Start index of the repeat whose detail panel is open, or null. One at a time. */
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; slot: Slot } | null>(null);
  /** Structure signature of the last auto-fit, so a resize does not re-fit. */
  const fittedRef = useRef<string | null>(null);

  const repeats = useMemo(() => model.repeats ?? [], [model.repeats]);

  const { slots, layerToSlot } = useMemo(
    () => buildSlots(model.layers, repeats),
    [model.layers, repeats],
  );

  const toggleGroup = useCallback((start: number) => {
    setOpenGroup((prev) => (prev === start ? null : start));
    setTip(null);
  }, []);

  const nav = useVizNodeNav({
    onActivate: (el) => {
      const start = el.getAttribute("data-group-start");
      if (start != null) toggleGroup(Number(start));
    },
    onEscape: () => {
      setOpenGroup(null);
      setTip(null);
    },
  });

  /** Download the figure framed to its own paper panel. */
  const exportFigure = useCallback(() => {
    const svg = svgRef.current;
    const live = svg?.querySelector<SVGGElement>("g.nn-root");
    if (!svg || !live) return;

    let box: DOMRect;
    try {
      box = live.getBBox();
    } catch {
      return; // not rendered (hidden tab)
    }
    if (!box.width || !box.height) return;

    const pad = 36;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Drop the pan/zoom transform so the export frames the figure, not
    // whatever corner the reader happened to be looking at.
    clone.querySelector("g.nn-root")?.removeAttribute("transform");
    clone.setAttribute("xmlns", SVG_NS);
    clone.setAttribute("width", String(Math.ceil(box.width + pad * 2)));
    clone.setAttribute("height", String(Math.ceil(box.height + pad * 2)));
    clone.setAttribute(
      "viewBox",
      `${box.x - pad} ${box.y - pad} ${box.width + pad * 2} ${box.height + pad * 2}`,
    );

    // Outer margin around the paper panel itself, like a page floating on a
    // desk. The panel's own near-white fill (painted as part of the live
    // figure) is what makes this white-on-white in practice — this rect only
    // matters when `pad` shows background outside the panel's own border.
    const ground = document.createElementNS(SVG_NS, "rect");
    ground.setAttribute("x", String(box.x - pad));
    ground.setAttribute("y", String(box.y - pad));
    ground.setAttribute("width", String(box.width + pad * 2));
    ground.setAttribute("height", String(box.height + pad * 2));
    ground.setAttribute("fill", "#ffffff");
    clone.insertBefore(ground, clone.firstChild);

    const markup = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${model.name || "model"}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }, [model.name]);

  /* ── Draw ── */

  const draw = useCallback(() => {
    if (!svgRef.current || !canvas.ready || slots.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = canvas.size.width;
    const height = canvas.size.height;
    svg.attr("width", width).attr("height", height);

    const root = svg.append("g").attr("class", "nn-root");
    // Paint order is the z-order in SVG. Residual arcs belong ON TOP of the
    // blocks: drawn underneath they read as a line passing through the model
    // rather than around it, which is the opposite of what a skip connection is.
    // The paper rect is inserted as the FIRST child at the very end, once the
    // full bbox is known — see the bottom of this function.
    const edges = root.append("g").attr("class", "nn-edges");
    const nodes = root.append("g").attr("class", "nn-nodes");
    const skipLayer = root.append("g").attr("class", "nn-skips");
    const brackets = root.append("g").attr("class", "nn-brackets").attr("pointer-events", "none");
    const legendLayer = root.append("g").attr("class", "nn-legend-chips").attr("pointer-events", "none");
    const panelLayer = root.append("g").attr("class", "nn-panel");

    /* Positions. Laid out in content space from the origin; `fitToView` frames
       it, so no viewBox — a viewBox plus a zoom transform double-transforms. */
    const sized = slots.map((slot) => {
      const dims = slot.layer.block_dims ?? { width: 6, height: 40, depth: 14 };
      return {
        slot,
        w: dims.width * SCALE,
        h: dims.height * SCALE,
        d: dims.depth * SCALE,
      };
    });

    // Gap scaled to the blocks rather than fixed. Depth no longer contributes
    // real horizontal room (it is a constant lip), so the gap is driven mostly
    // by block thickness now.
    const footprints = sized.map((s) => s.w + s.d * Z_X).sort((a, b) => a - b);
    const median = footprints[Math.floor(footprints.length / 2)] || 30;
    const gap = Math.max(14, median * 0.22);
    const groupPad = gap * 0.8;

    // Caption text is measured before layout, not just the block's own
    // visual footprint. A repeat's own label ("MultiheadAttention +
    // LayerNorm + Linear + … block") is far wider than the block it labels —
    // a Linear layer has no spatial footprint at all — and spacing purely by
    // block geometry let one long caption bleed straight into its neighbor's.
    const CAPTION_GAP = 10;
    const captionOf = (slot: Slot) =>
      slot.group ? (slot.group.label ?? slot.layer.type) : slotLabel(slot.layer);
    const captionHalfWidths = sized.map(
      ({ slot }) => measureText(nodes, captionOf(slot), "13px", "600") / 2,
    );

    const placed: { slot: Slot; cuboid: Cuboid }[] = [];
    let x = 0;
    let prevCaptionRight = -Infinity;
    sized.forEach(({ slot, w, h, d }, i) => {
      if (slot.groupStart) x += groupPad;
      let cx = x + w / 2 + d * Z_X;
      const half = captionHalfWidths[i];
      // If this block's caption would start before the previous one's
      // ends, push both the block and its caption right by the shortfall —
      // spacing is driven by whichever is wider, the blocks or their names.
      if (cx - half < prevCaptionRight + CAPTION_GAP) {
        const shift = prevCaptionRight + CAPTION_GAP - (cx - half);
        x += shift;
        cx += shift;
      }
      placed.push({ slot, cuboid: buildCuboidPolygons(cx, 0, w, h, d) });
      prevCaptionRight = cx + half;
      x += w + d * Z_X + gap;
      if (slot.groupEnd) x += groupPad;
    });

    /** Where an edge should start or end, for a layer id. Terminal pseudo-ids
     * (`input`/`output`) resolve to nothing — the reference figures begin and
     * end at the first and last block with no chip, so those connections are
     * simply not drawn, same as any other unresolvable endpoint. */
    const anchorFor = (id: string, side: "left" | "right") => {
      const index = layerToSlot.get(id);
      if (index != null && placed[index]) {
        const c = placed[index].cuboid;
        return side === "left" ? c.leftAnchor : c.rightAnchor;
      }
      return null;
    };

    /* ── Gradients (one per category present, one per face) ── */
    const defs = svg.append("defs");
    const presentCategories = new Set(placed.map((p) => categoryKey(p.slot.layer.category)));
    for (const cat of presentCategories) {
      const colors = colorsFor(cat);
      const grad = (face: "front" | "top" | "right", from: string, to: string) => {
        const g = defs
          .append("linearGradient")
          .attr("id", `nn-grad-${cat}-${face}`)
          .attr("x1", "0").attr("y1", "0").attr("x2", "0").attr("y2", "1");
        g.append("stop").attr("offset", "0%").attr("stop-color", from);
        g.append("stop").attr("offset", "100%").attr("stop-color", to);
      };
      grad("front", lighten(colors.base, 0.16), colors.base);
      grad("top", lighten(colors.top, 0.12), colors.top);
      grad("right", colors.side, darken(colors.side, 0.14));
    }

    /* ── Markers ── */
    const marker = (id: string, fill: string) =>
      defs
        .append("marker")
        .attr("id", id)
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 9)
        .attr("refY", 5)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M 0 0 L 10 5 L 0 10 z")
        .attr("fill", fill);
    marker("nn-arrow", INK_DIM);

    /* ── Connections ── */
    const drawn = new Set<string>();

    for (const conn of model.connections) {
      const from = layerToSlot.get(conn.from_id);
      const to = layerToSlot.get(conn.to_id);
      // A folded repetition can produce an edge from a slot to itself.
      if (from != null && to != null && from === to) continue;

      const a = anchorFor(conn.from_id, "right");
      const b = anchorFor(conn.to_id, "left");
      if (!a || !b) continue;

      const key = `${conn.from_id}:${from ?? "t"}->${conn.to_id}:${to ?? "t"}:${conn.type}`;
      if (drawn.has(key)) continue;
      drawn.add(key);

      if (conn.type === "skip" || conn.type === "concat" || conn.type === "add") {
        const midX = (a.x + b.x) / 2;
        // Clear the tallest block the arc flies over, not just its two
        // endpoints. Measuring only the ends sent the residual straight through
        // the stack it is supposed to bypass.
        const lo = Math.min(from ?? 0, to ?? 0);
        const hi = Math.max(from ?? placed.length - 1, to ?? placed.length - 1);
        const spanTop = placed
          .slice(lo, hi + 1)
          .reduce((acc, p) => Math.min(acc, p.cuboid.highestY), Math.min(a.y, b.y));
        // A quadratic reaches only halfway to its control point — its apex is
        // (P0 + 2C + P2)/4 — so putting the control at the clearance height left
        // the curve sagging back through the blocks. Solve for the control that
        // puts the APEX where we want it.
        const apex = spanTop - 30;
        const arcY = (4 * apex - a.y - b.y) / 2;
        skipLayer
          .append("path")
          .attr("d", `M ${a.x} ${a.y} Q ${midX} ${arcY} ${b.x} ${b.y}`)
          .attr("fill", "none")
          .attr("stroke", SKIP_COLOR)
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "8,6");

        // Only the first residual in the model is named — the reference
        // figure names the connection type once, not on every arc.
        if (!drawn.has("__residual_label__")) {
          drawn.add("__residual_label__");
          skipLayer
            .append("text")
            .attr("x", midX)
            .attr("y", apex - 8)
            .attr("text-anchor", "middle")
            .attr("font-size", "11px")
            .attr("font-style", "italic")
            .attr("fill", INK_DIM)
            .attr("pointer-events", "none")
            .text(conn.label || (conn.type === "concat" ? "concat" : "residual"));
        }

        // The merge glyph is where the residual actually rejoins the trunk.
        // A bare arc leaves the reader guessing whether it adds or replaces.
        const merge = skipLayer.append("g").attr("pointer-events", "none");
        merge
          .append("circle")
          .attr("cx", b.x)
          .attr("cy", b.y)
          .attr("r", 7)
          .attr("fill", PAPER_BG)
          .attr("stroke", SKIP_COLOR)
          .attr("stroke-width", 1.5);
        merge
          .append("text")
          .attr("x", b.x)
          .attr("y", b.y)
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("font-size", "11px")
          .attr("fill", INK_DIM)
          .text(conn.type === "concat" ? "⊕" : "+");
        continue;
      }

      edges
        .append("line")
        .attr("x1", a.x)
        .attr("y1", a.y)
        .attr("x2", b.x)
        .attr("y2", b.y)
        .attr("stroke", INK_DIM)
        .attr("stroke-width", 2)
        .attr("marker-end", "url(#nn-arrow)");

      // Channel width the source declares, or the full shape on the rare
      // model that states an input size. Never invented (D2).
      const label = from != null ? arrowLabel(placed[from].slot.layer) : "";
      if (label) {
        edges
          .append("text")
          .attr("x", (a.x + b.x) / 2)
          .attr("y", (a.y + b.y) / 2 - 8)
          .attr("text-anchor", "middle")
          .attr("font-size", "10px")
          .attr("font-family", "monospace")
          .attr("fill", INK_DIM)
          .attr("pointer-events", "none")
          .text(label);
      }
    }

    /* ── Shared label baseline ──
       All names sit on one line, all param counts on the line beneath it,
       regardless of each block's own height — the reference figure's labels
       read as one row, not a staircase following the silhouette. */
    const maxLowestY = placed.length ? Math.max(...placed.map((p) => p.cuboid.lowestY)) : 0;
    const labelY = maxLowestY + 30;
    const countY = labelY + 15;

    /* ── Cuboids ── */

    placed.forEach(({ slot, cuboid }, i) => {
      const catKey = categoryKey(slot.layer.category);
      const g = nodes
        .append("g")
        .attr("class", "nn-node")
        .attr("data-viz-node", "")
        .attr("cursor", slot.group ? "pointer" : "default")
        .attr("role", "img")
        .attr(
          "aria-label",
          slot.group
            ? `${slot.group.label ?? slot.layer.type}, repeated ${slot.group.count} times`
            : `${slot.layer.type}, ${formatParamCount(slot.layer.param_count)} parameters`,
        );

      // On every slot of the group, not just the first: Enter anywhere inside a
      // collapsed block toggles its panel, matching what clicking already does.
      if (slot.group) {
        g.attr("data-group-start", String(slot.group.start));
      }

      // Ghost planes behind a collapsed repetition. Capped at three regardless
      // of count: the numeral carries the true depth, and twelve stacked planes
      // would just be a smear.
      if (slot.group) {
        const colors = colorsFor(slot.layer.category);
        const ghosts = Math.min(GHOST_MAX, slot.group.count - 1);
        for (let k = ghosts; k >= 1; k--) {
          const gg = g
            .append("g")
            .attr("transform", `translate(${k * GHOST_DX}, ${k * GHOST_DY})`)
            .attr("opacity", 0.42 - (k - 1) * 0.11)
            .attr("pointer-events", "none");
          gg.append("polygon").attr("points", cuboid.right).attr("fill", colors.side);
          gg.append("polygon").attr("points", cuboid.top).attr("fill", colors.top);
          gg.append("polygon").attr("points", cuboid.front).attr("fill", colors.base);
        }
      }

      // Crisp near-black outline on every face, plus a subtle top-to-bottom
      // gradient per face — this is most of what makes a block read as a
      // solid PlotNeuralNet-style slab rather than a flat colored shape.
      const right = g
        .append("polygon")
        .attr("points", cuboid.right)
        .attr("fill", `url(#nn-grad-${catKey}-right)`)
        .attr("stroke", INK)
        .attr("stroke-width", 1.25);
      const top = g
        .append("polygon")
        .attr("points", cuboid.top)
        .attr("fill", `url(#nn-grad-${catKey}-top)`)
        .attr("stroke", INK)
        .attr("stroke-width", 1.25);
      const front = g
        .append("polygon")
        .attr("points", cuboid.front)
        .attr("fill", `url(#nn-grad-${catKey}-front)`)
        .attr("stroke", INK)
        .attr("stroke-width", 1.25);

      // A group slot's own id is a synthetic placeholder (see buildSlots), so
      // its caption comes from the repeat's own label, not slotLabel().
      g.append("text")
        .attr("x", cuboid.center.x)
        .attr("y", labelY)
        .attr("text-anchor", "middle")
        .attr("font-size", "13px")
        .attr("font-weight", "600")
        .attr("fill", INK)
        .attr("pointer-events", "none")
        .text(slot.group ? (slot.group.label ?? slot.layer.type) : slotLabel(slot.layer));

      if (slot.layer.param_count) {
        g.append("text")
          .attr("x", cuboid.center.x)
          .attr("y", countY)
          .attr("text-anchor", "middle")
          .attr("font-size", "11px")
          .attr("font-family", "monospace")
          .attr("fill", INK_DIM)
          .attr("pointer-events", "none")
          .text(formatParamCount(slot.layer.param_count));
      }

      const faces = [right, top, front];
      g.on("mouseenter", (event: MouseEvent) => {
        // A hairline halo, not a fill swap — the gradient fills already do
        // the shading work, so hover only needs to say "this is interactive".
        faces.forEach((f) => f.attr("stroke-width", 2.25));
        const rect = canvas.containerRef.current?.getBoundingClientRect();
        if (rect) {
          setTip({ x: event.clientX - rect.left, y: event.clientY - rect.top, slot });
        }
      })
        .on("mouseleave", () => {
          faces.forEach((f) => f.attr("stroke-width", 1.25));
          setTip(null);
        })
        .on("click", () => {
          if (slot.group) toggleGroup(slot.group.start);
        });

      if (!reducedMotion) {
        g.style("opacity", 0)
          .transition()
          .delay(Math.min(i * 45, 600))
          .duration(360)
          .style("opacity", 1);
      }
    });

    /* ── Repeat brace + × N ── */

    for (let i = 0; i < placed.length; i++) {
      const { slot } = placed[i];
      if (!slot.group || !slot.groupStart) continue;

      let end = i;
      while (end < placed.length - 1 && !placed[end].slot.groupEnd) end++;

      const last = placed[end].cuboid;
      const ghostCount = Math.min(GHOST_MAX, slot.group.count - 1);
      const ghostTipX = last.rightAnchor.x + ghostCount * GHOST_DX;
      const ghostTipY = last.highestY + ghostCount * GHOST_DY;
      const braceStartX = ghostTipX;
      const braceStartY = (last.highestY + last.lowestY) / 2;
      const braceEndX = braceStartX + 30;
      const braceEndY = ghostTipY - 18;

      brackets
        .append("path")
        .attr(
          "d",
          `M ${braceStartX} ${braceStartY} Q ${braceStartX + 18} ${braceEndY} ${braceEndX} ${braceEndY}`,
        )
        .attr("fill", "none")
        .attr("stroke", INK_DIM)
        .attr("stroke-width", 1.25)
        .attr("stroke-dasharray", "3,3");

      brackets
        .append("text")
        .attr("x", braceEndX + 8)
        .attr("y", braceEndY)
        .attr("dominant-baseline", "central")
        .attr("font-size", "24px")
        .attr("font-weight", "800")
        .attr("fill", INK)
        .text(`x ${slot.group.count}`);
    }

    /* ── In-figure legend ──
       Drawn as SVG so it exports with the figure — a chip bar reading left to
       right, matching the reference's contiguous legend row. */
    if (placed.length) {
      const leftMostX = Math.min(...placed.map((p) => p.cuboid.frontBottomLeft.x));
      const legendY = countY + 26;
      const CHIP = 10;
      const CHIP_GAP = 6;
      const ITEM_GAP = 18;
      const present = new Set(model.layers.map((l) => l.category));
      const legendCats = [...present].filter((c) => CATEGORY_COLORS[c]).sort();
      let lx = leftMostX;
      for (const cat of legendCats) {
        legendLayer
          .append("rect")
          .attr("x", lx)
          .attr("y", legendY - CHIP / 2)
          .attr("width", CHIP)
          .attr("height", CHIP)
          .attr("rx", 2)
          .attr("fill", colorsFor(cat).base);
        const label = legendLayer
          .append("text")
          .attr("x", lx + CHIP + CHIP_GAP)
          .attr("y", legendY)
          .attr("dominant-baseline", "central")
          .attr("font-size", "11px")
          .attr("fill", INK_DIM)
          .text(CATEGORY_LABELS[cat] ?? cat);
        const w = (label.node() as SVGTextElement).getComputedTextLength();
        lx += CHIP + CHIP_GAP + w + ITEM_GAP;
      }
      if (model.connections.some((c) => c.type !== "sequential")) {
        legendLayer
          .append("line")
          .attr("x1", lx)
          .attr("x2", lx + 14)
          .attr("y1", legendY)
          .attr("y2", legendY)
          .attr("stroke", SKIP_COLOR)
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "4,3");
        legendLayer
          .append("text")
          .attr("x", lx + 14 + CHIP_GAP)
          .attr("y", legendY)
          .attr("dominant-baseline", "central")
          .attr("font-size", "11px")
          .attr("fill", INK_DIM)
          .text("Skip / residual");
      }

      /* ── Detail panel for the open repeat group ── */
      if (openGroup != null) {
        renderDetailPanel({
          panelLayer,
          placed,
          model,
          openGroup,
          belowY: legendY + 34,
        });
      }
    }

    /* ── Zoom ── */
    const behavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 3])
      .on("zoom", (event) => root.attr("transform", event.transform.toString()));
    svg.call(behavior);

    zoom.register(svgRef.current, behavior, root.node());
    nav.register(root.node(), "g.nn-node");

    // Paper panel — sized to the FULL laid-out content (blocks, labels,
    // legend, an open detail panel) and inserted as the first child, so it
    // paints behind everything else. getBBox() is synchronous once elements
    // are in the DOM, so this can run after the rest of the figure is drawn
    // rather than needing a separate measurement pass.
    let paperBox: DOMRect | null = null;
    const rootNode = root.node();
    if (rootNode) {
      try {
        paperBox = rootNode.getBBox();
      } catch {
        paperBox = null;
      }
    }
    if (paperBox && paperBox.width && paperBox.height) {
      const pad = 28;
      root
        .insert("rect", ":first-child")
        .attr("class", "nn-paper")
        .attr("x", paperBox.x - pad)
        .attr("y", paperBox.y - pad)
        .attr("width", paperBox.width + pad * 2)
        .attr("height", paperBox.height + pad * 2)
        .attr("rx", 10)
        .attr("fill", PAPER_BG)
        .attr("stroke", PAPER_BORDER)
        .attr("stroke-width", 1);
    }

    // Fit when the FIGURE changed shape, not on every redraw. A resize must not
    // throw away the pan and zoom the user just set (DESIGN.md §4), but
    // opening a detail panel changes the content bounds and leaving the
    // viewport where it was could strand the panel off-screen.
    // Size is part of the key, not just structure: a 1440 -> 375 viewport change
    // makes the old transform meaningless, and preserving it left a phone
    // showing one block at desktop scale. Bucketed so ordinary reflow jitter
    // does not count as a change and steal the user's pan.
    const sizeKey = `${Math.round(width / 120)}x${Math.round(height / 120)}`;
    const structureKey = `${slots.length}:${openGroup ?? "none"}:${sizeKey}`;
    if (fittedRef.current !== structureKey) {
      fittedRef.current = structureKey;
      // Never animated: tweening from identity on first paint reads as an
      // unrequested zoom rather than as a chart appearing.
      zoom.fitToView({ animate: false });
    } else {
      // The redraw above wiped the SVG, so `root` is brand new and carries no
      // transform even though d3 still holds the user's on the <svg> node.
      // Skipping the re-apply left the figure at the raw origin, where the
      // cuboids' upper halves sit at negative y and are simply not on screen.
      root.attr("transform", d3.zoomTransform(svgRef.current).toString());
    }
  }, [
    canvas.ready,
    canvas.size.width,
    canvas.size.height,
    canvas.containerRef,
    slots,
    layerToSlot,
    openGroup,
    model,
    reducedMotion,
    toggleGroup,
    zoom,
    nav,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  /* ── Legend (narrow-viewport fallback only — the in-figure chip bar above
     is the primary legend and is what exports with the figure) ── */

  const legendItems = useMemo<VizLegendItem[]>(() => {
    const present = new Set(model.layers.map((l) => l.category));
    const items: VizLegendItem[] = [...present]
      .filter((c) => CATEGORY_COLORS[c])
      .sort()
      .map((c) => ({ color: colorsFor(c).base, label: CATEGORY_LABELS[c] ?? c }));
    if (model.connections.some((c) => c.type !== "sequential")) {
      items.push({ color: SKIP_COLOR, label: "Skip / residual", shape: "line" });
    }
    return items;
  }, [model.layers, model.connections]);

  /* ── Parameter mass ── */

  const mass = useMemo(() => {
    const entries: { label: string; value: number }[] = [];
    let unknown = 0;
    const repeatAt = new Map<number, NNRepeat>();
    for (const r of repeats) repeatAt.set(r.start, r);

    let i = 0;
    while (i < model.layers.length) {
      const repeat = repeatAt.get(i);
      if (repeat) {
        const span = repeat.length * repeat.count;
        const per = repeat.param_count ?? 0;
        if (per > 0) {
          entries.push({ label: `${repeat.label ?? "Block"} ×${repeat.count}`, value: per * repeat.count });
        } else {
          unknown += span;
        }
        i += span;
        continue;
      }
      const layer = model.layers[i];
      // Same label the figure draws, so a row can be found in the diagram — and
      // unique, where `type` gave four rows all reading "Conv2d".
      if (layer.param_count) entries.push({ label: slotLabel(layer), value: layer.param_count });
      else unknown += 1;
      i += 1;
    }

    entries.sort((a, b) => b.value - a.value);
    const total = entries.reduce((s, e) => s + e.value, 0);
    return { entries: entries.slice(0, 8), total, unknown };
  }, [model.layers, repeats]);

  return (
    <VizShell
      canvas={canvas}
      zoom={zoom}
      nav={nav}
      className="min-h-[520px]"
      label={`${model.name} architecture diagram`}
      description={
        `${model.layers.length} layers drawn as isometric blocks. Block height is the feature ` +
        `map's spatial extent; its thickness along the sequence is channel count. Depth is a ` +
        `fixed 3D lip and carries no data. Color is layer type. Parameter count is printed ` +
        `under each block, not encoded in size.` +
        (repeats.length > 0
          ? ` ${repeats.length} repeated block${repeats.length === 1 ? "" : "s"} shown once ` +
            `each; press Enter on one to see its internals.`
          : "")
      }
      // The narrow-viewport fallback strip — the in-figure chip bar is
      // primary and always renders; this is a supplementary larger-text
      // version for screens where the in-figure one is too small to read.
      footer={isNarrow ? <VizLegend items={legendItems} orientation="horizontal" /> : undefined}
      // Top-left: the parameter-mass panel owns the top-right corner.
      toolbarLeft={
        <button
          type="button"
          onClick={exportFigure}
          className={cn(
            "rounded-lg border border-border bg-card/90 px-2.5 py-1.5 text-xs font-medium",
            "text-muted-foreground shadow-sm backdrop-blur-sm transition-colors",
            "hover:bg-accent hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--viz-highlight))]",
          )}
        >
          Export figure
        </button>
      }
      overlay={
        <>
          {massPanelOpen && mass.entries.length > 0 && (
            <div className="absolute right-3 top-3 z-10 w-60 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Parameter mass
              </div>
              <div className="mt-0.5 text-sm font-semibold text-foreground">
                {formatParamCount(mass.total)} total
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {mass.entries.map((entry, index) => (
                  <li key={`${entry.label}-${index}`}>
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="truncate text-muted-foreground">{entry.label}</span>
                      <span className="shrink-0 font-mono text-foreground">
                        {formatParamCount(entry.value)}
                      </span>
                    </div>
                    <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${mass.total > 0 ? (entry.value / mass.total) * 100 : 0}%`,
                          backgroundColor: catVar(0),
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {mass.unknown > 0 && (
                <p className="mt-2.5 border-t border-border pt-2 text-[10px] leading-snug text-muted-foreground">
                  {mass.unknown} layer{mass.unknown === 1 ? "" : "s"} have no parameter estimate and
                  are not counted.
                </p>
              )}
            </div>
          )}
          {tip && (
            <VizTooltip
              x={tip.x}
              y={tip.y}
              containerWidth={canvas.size.width}
              containerHeight={canvas.size.height}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: colorsFor(tip.slot.layer.category).base }}
                />
                <span className="truncate font-semibold text-foreground">{tip.slot.layer.type}</span>
              </div>
              {tip.slot.group && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {tip.slot.group.label ?? "Block"} · repeated ×{tip.slot.group.count}
                  {tip.slot.group.param_count
                    ? ` · ${formatParamCount(tip.slot.group.param_count)} each`
                    : ""}
                  . Click to see its internals.
                </div>
              )}
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
                <dt>Parameters</dt>
                <dd className="text-right font-mono text-foreground">
                  {formatParamCount(tip.slot.layer.param_count)}
                </dd>
                {tip.slot.layer.output_shape && (
                  <>
                    <dt>Output</dt>
                    <dd className="text-right font-mono text-foreground">
                      {formatShape(tip.slot.layer.output_shape)}
                    </dd>
                  </>
                )}
                {!tip.slot.layer.output_shape && tip.slot.layer.feature_width != null && (
                  <>
                    <dt>Width</dt>
                    <dd className="text-right font-mono text-foreground">
                      {tip.slot.layer.feature_width}
                    </dd>
                  </>
                )}
                {tip.slot.layer.activation && (
                  <>
                    <dt>Activation</dt>
                    <dd className="text-right font-mono text-foreground">
                      {tip.slot.layer.activation}
                    </dd>
                  </>
                )}
                {Object.entries(tip.slot.layer.params ?? {}).slice(0, 6).map(([k, v]) => (
                  <div className="contents" key={k}>
                    <dt className="truncate">{k}</dt>
                    <dd className="text-right font-mono text-foreground">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </VizTooltip>
          )}
        </>
      }
    >
      <svg ref={svgRef} className="h-full w-full" />
    </VizShell>
  );
}

/* ── Detail panel ─────────────────────────────────────────── */

type D3Group = d3.Selection<SVGGElement, unknown, null, undefined>;

/** Append `text`, measure it, remove it. For sizing decisions made before the
 * real element is placed (the panel's own width has to be known before its
 * background rect can be drawn). */
function measureText(container: D3Group, text: string, fontSize: string, fontWeight = "400"): number {
  const probe = container
    .append("text")
    .attr("font-size", fontSize)
    .attr("font-weight", fontWeight)
    .style("visibility", "hidden")
    .text(text);
  const width = (probe.node() as SVGTextElement).getComputedTextLength();
  probe.remove();
  return width;
}

const PANEL_PAD = 14;
const PANEL_TITLE_H = 22;
const PANEL_NODE_H = 34;
const PANEL_NODE_GAP = 30;
const PANEL_ARC_RISE = 22;

/**
 * The callout panel a click on a collapsed repeat opens: that repetition's
 * layers drawn as flat nodes, the way the transformer reference draws its
 * "Encoder Layer" inset. Lives in `draw()`'s closure — it needs the fully
 * laid-out block positions (for the leader lines) and is only ever called
 * from there.
 */
function renderDetailPanel(args: {
  panelLayer: D3Group;
  placed: { slot: Slot; cuboid: Cuboid }[];
  model: NNModel;
  openGroup: number;
  belowY: number;
}) {
  const { panelLayer, placed, model, openGroup, belowY } = args;

  const groupPlaced = placed.filter((p) => p.slot.group?.start === openGroup);
  if (groupPlaced.length === 0) return;
  const repeat = groupPlaced[0].slot.group!;
  const groupLayers = model.layers.slice(repeat.start, repeat.start + repeat.length);
  if (groupLayers.length === 0) return;

  // This repetition's own connections — a later repetition's layers have
  // distinct ids and will not match this filter. The one exception is the
  // FIRST layer's own residual: a real "x = x + Attention(x)" wraps the
  // block's input, so its source is definitionally the layer BEFORE the
  // block, never an interior one. Excluding it would mean a block's very
  // first residual arc — the mockup's "around Multi-Head Attention" arc —
  // could never be drawn, in the panel or anywhere else.
  const groupIds = new Set(groupLayers.map((l) => l.id));
  const blockInputId = repeat.start > 0 ? model.layers[repeat.start - 1]?.id : undefined;
  const groupConns = model.connections.filter(
    (c) =>
      groupIds.has(c.to_id) && (groupIds.has(c.from_id) || c.from_id === blockInputId),
  );
  const hasArcs = groupConns.some((c) => c.type !== "sequential");

  // Node widths are text-driven so a label like "Multi-Head Attention (12
  // heads)" is not truncated to fit a fixed box.
  const nodeMeta = groupLayers.map((layer) => {
    const label = slotLabel(layer);
    const w = measureText(panelLayer, label, "11px", "600");
    return { layer, label, width: Math.max(52, w + 20) };
  });
  const totalNodesWidth =
    nodeMeta.reduce((s, n) => s + n.width, 0) + (nodeMeta.length - 1) * PANEL_NODE_GAP;
  const panelWidth = Math.max(totalNodesWidth + PANEL_PAD * 2, 200);
  const arcClearance = hasArcs ? PANEL_ARC_RISE + 10 : 0;
  const panelHeight = PANEL_PAD + PANEL_TITLE_H + arcClearance + PANEL_NODE_H + PANEL_PAD;

  const groupCenterX =
    (groupPlaced[0].cuboid.center.x + groupPlaced[groupPlaced.length - 1].cuboid.center.x) / 2;
  const panelX = groupCenterX - panelWidth / 2;
  const panelY = belowY;

  /* ── Leader lines from the collapsed block's own bottom corners ── */
  const leaderLeft = groupPlaced[0].cuboid.frontBottomLeft;
  const leaderRight = groupPlaced[groupPlaced.length - 1].cuboid.frontBottomRight;
  panelLayer
    .append("line")
    .attr("x1", leaderLeft.x).attr("y1", leaderLeft.y)
    .attr("x2", panelX).attr("y2", panelY)
    .attr("stroke", INK_FAINT)
    .attr("stroke-width", 1.25)
    .attr("stroke-dasharray", "4,4");
  panelLayer
    .append("line")
    .attr("x1", leaderRight.x).attr("y1", leaderRight.y)
    .attr("x2", panelX + panelWidth).attr("y2", panelY)
    .attr("stroke", INK_FAINT)
    .attr("stroke-width", 1.25)
    .attr("stroke-dasharray", "4,4");

  /* ── Panel frame ── */
  panelLayer
    .append("rect")
    .attr("x", panelX).attr("y", panelY)
    .attr("width", panelWidth).attr("height", panelHeight)
    .attr("rx", 10)
    .attr("fill", PAPER_BG)
    .attr("stroke", INK)
    .attr("stroke-width", 1.25);

  panelLayer
    .append("text")
    .attr("x", panelX + PANEL_PAD)
    .attr("y", panelY + PANEL_PAD + 4)
    .attr("dominant-baseline", "hanging")
    .attr("font-size", "12px")
    .attr("font-weight", "700")
    .attr("fill", INK)
    .text(repeat.label ?? "Repeated block");

  /* ── Nodes ── */
  const rowY = panelY + PANEL_PAD + PANEL_TITLE_H + arcClearance + PANEL_NODE_H / 2;
  const marker = "url(#nn-arrow)";
  const nodeAnchor = new Map<string, { left: number; right: number; centerX: number }>();

  let nx = panelX + PANEL_PAD;
  const positioned = nodeMeta.map((meta) => {
    const left = nx;
    const right = nx + meta.width;
    const centerX = (left + right) / 2;
    nodeAnchor.set(meta.layer.id, { left, right, centerX });
    nx = right + PANEL_NODE_GAP;
    return { ...meta, left, right, centerX };
  });

  for (let i = 0; i < positioned.length; i++) {
    const n = positioned[i];
    const colors = colorsFor(n.layer.category);
    panelLayer
      .append("rect")
      .attr("x", n.left).attr("y", rowY - PANEL_NODE_H / 2)
      .attr("width", n.width).attr("height", PANEL_NODE_H)
      .attr("rx", 7)
      .attr("fill", colors.base)
      .attr("stroke", INK)
      .attr("stroke-width", 1);
    panelLayer
      .append("text")
      .attr("x", n.centerX).attr("y", rowY)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", "11px")
      .attr("font-weight", "600")
      .attr("fill", "#FFFFFF")
      .text(n.label);

    if (i < positioned.length - 1) {
      const next = positioned[i + 1];
      panelLayer
        .append("line")
        .attr("x1", n.right).attr("y1", rowY)
        .attr("x2", next.left).attr("y2", rowY)
        .attr("stroke", INK_DIM)
        .attr("stroke-width", 1.5)
        .attr("marker-end", marker);
    }
  }

  // A residual sourced outside the block (the block's own input, see
  // `blockInputId` above) anchors at the row's own left edge — visually, the
  // arc arrives from off the left of the panel, which is where that tensor
  // actually comes from.
  if (blockInputId != null && positioned.length > 0) {
    const edge = positioned[0].left;
    nodeAnchor.set(blockInputId, { left: edge, right: edge, centerX: edge });
  }

  /* ── Internal residual arcs, same visual language as the main figure ── */
  for (const conn of groupConns) {
    if (conn.type !== "skip" && conn.type !== "concat" && conn.type !== "add") continue;
    const a = nodeAnchor.get(conn.from_id);
    const b = nodeAnchor.get(conn.to_id);
    if (!a || !b) continue;

    const startX = a.right;
    const endX = b.right;
    const midX = (startX + endX) / 2;
    const apex = rowY - PANEL_NODE_H / 2 - PANEL_ARC_RISE;
    const startY = rowY - PANEL_NODE_H / 2;
    const arcY = (4 * apex - startY - startY) / 2;

    panelLayer
      .append("path")
      .attr("d", `M ${startX} ${startY} Q ${midX} ${arcY} ${endX} ${startY}`)
      .attr("fill", "none")
      .attr("stroke", SKIP_COLOR)
      .attr("stroke-width", 1.25)
      .attr("stroke-dasharray", "5,4");

    const merge = panelLayer.append("g");
    merge
      .append("circle")
      .attr("cx", endX).attr("cy", startY)
      .attr("r", 5.5)
      .attr("fill", PAPER_BG)
      .attr("stroke", SKIP_COLOR)
      .attr("stroke-width", 1.25);
    merge
      .append("text")
      .attr("x", endX).attr("y", startY)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", "9px")
      .attr("fill", INK_DIM)
      .text(conn.type === "concat" ? "⊕" : "+");
  }
}

/* ── Export ───────────────────────────────────────────────── */

interface NeuralNetworkVizProps {
  models?: NNModel[];
  data?: any; // Fallback for VizContainer data passing
}

export function NeuralNetworkViz({ models, data }: NeuralNetworkVizProps) {
  const resolved: NNModel[] = models ?? data?.models ?? [];
  const [active, setActive] = useState(0);
  // Closed by default: it floats over the canvas, and the figure is the thing
  // people came to see. The toggle sits next to the title.
  const [massPanelOpen, setMassPanelOpen] = useState(false);

  if (resolved.length === 0) {
    return (
      <VizMessage
        title="No model architecture to draw"
        body="We didn't find a neural network in this repository. This view reads PyTorch (nn.Module, nn.Sequential), Keras and TensorFlow models, and Hugging Face transformers loaded with from_pretrained. Classical machine learning — scikit-learn pipelines, XGBoost, LightGBM — isn't drawn here yet."
      />
    );
  }

  const model = resolved[Math.min(active, resolved.length - 1)];

  return (
    <div className="flex h-full min-h-[560px] w-full flex-col">
      {/* Model identity. `file:line` is the thing hfviewer structurally cannot
          show — it reads published configs; this is parsed from the repo. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-1 pb-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Layers size={16} className="text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-foreground">{model.name}</h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-mono">
              {model.file}:{model.line}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{model.framework}</span>
            <span>{model.layers.length} layers</span>
            {model.total_params != null && <span>{formatParamCount(model.total_params)} params</span>}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMassPanelOpen((v) => !v)}
            aria-pressed={massPanelOpen}
            className={cn(
              "rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--viz-highlight))]",
              massPanelOpen
                ? "bg-accent text-foreground"
                : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            Parameter mass
          </button>
        </div>
      </div>

      {resolved.length > 1 && (
        <div className="flex shrink-0 flex-wrap gap-1.5 px-1 py-2" role="tablist" aria-label="Models">
          {resolved.map((m, i) => (
            <button
              key={`${m.name}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--viz-highlight))]",
                i === active
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {/* Keyed so switching models resets the open panel and zoom rather
            than carrying one model's state onto another. */}
        <ModelFigure key={`${model.name}-${active}`} model={model} massPanelOpen={massPanelOpen} />
      </div>
    </div>
  );
}
