"use client";

/**
 * Visualization color tokens.
 *
 * Every chart under `components/report/viz/` reads colors from here instead of
 * hardcoding hex. The tokens themselves live in `app/globals.css` under both
 * `:root` and `.dark`, so they follow the theme toggle.
 *
 * Two ways to consume them, and the choice matters:
 *
 *   1. `cssVar()` / `catVar()` / `inkVar()` return a LIVE `hsl(var(--x))`
 *      string. Assign these straight to SVG attributes. The browser resolves
 *      them on every paint, so a theme flip updates the chart with no React
 *      re-render and no D3 re-draw. Prefer this everywhere you can.
 *
 *   2. `seqColor()` and `resolve()` return a CONCRETE color. Only needed when
 *      you have to do math on the value (interpolating the complexity ramp,
 *      deciding label contrast). These are snapshots — they do NOT follow the
 *      theme on their own, so any effect that uses them must list
 *      `useVizThemeVersion()` in its dependency array.
 */

import { useEffect, useState } from "react";

/* ── Token names ──────────────────────────────────────────── */

export type VizToken =
  | "viz-cat-1" | "viz-cat-2" | "viz-cat-3" | "viz-cat-4"
  | "viz-cat-5" | "viz-cat-6" | "viz-cat-7" | "viz-cat-8"
  | "viz-cat-ink"
  | "viz-seq-from" | "viz-seq-to"
  | "viz-surface" | "viz-ink" | "viz-ink-dim" | "viz-edge"
  | "viz-highlight";

export const CAT_COUNT = 8;

/* ── Live references (preferred) ──────────────────────────── */

/** Live `hsl(var(--token))` string. Follows the theme with no re-render. */
export function cssVar(token: VizToken, alpha?: number): string {
  return alpha == null
    ? `hsl(var(--${token}))`
    : `hsl(var(--${token}) / ${alpha})`;
}

/** Categorical color by index, wrapping at 8. */
export function catVar(index: number, alpha?: number): string {
  const slot = (Math.abs(Math.trunc(index)) % CAT_COUNT) + 1;
  return cssVar(`viz-cat-${slot}` as VizToken, alpha);
}

/**
 * Text color for labels drawn ON a categorical fill (badges inside nodes).
 * Not the same as `inkVar()`, which is for labels on the page background.
 */
export const catInkVar = (alpha?: number) => cssVar("viz-cat-ink", alpha);

export const inkVar = (alpha?: number) => cssVar("viz-ink", alpha);
export const inkDimVar = (alpha?: number) => cssVar("viz-ink-dim", alpha);
export const edgeVar = (alpha?: number) => cssVar("viz-edge", alpha);
export const surfaceVar = (alpha?: number) => cssVar("viz-surface", alpha);
export const highlightVar = (alpha?: number) => cssVar("viz-highlight", alpha);

/**
 * Semantic node/module type → categorical slot.
 *
 * Preserves the mapping the old hardcoded `TYPE_COLORS` used: module/file and
 * routes were blue, class/component and models green, function/method and
 * services purple, external/package/database/config orange, and the
 * structurally-uninteresting kinds (utils, tests, other) were plain grey.
 */
const TYPE_SLOT: Record<string, number> = {
  module: 0, file: 0, routes: 0,
  class: 1, component: 1, models: 1,
  function: 2, method: 2, services: 2,
  external: 3, package: 3, database: 3, config: 3,
};

/** Color for a semantic node type. Unknown//structural types fall back to dim ink. */
export function typeVar(type: string | undefined | null): string {
  if (!type) return inkDimVar();
  const slot = TYPE_SLOT[type.toLowerCase()];
  return slot == null ? inkDimVar() : catVar(slot);
}

/* ── Concrete resolution (only when you need the numbers) ─── */

type Rgb = { r: number; g: number; b: number };

/** Parse an `H S% L%` custom-property value into RGB 0-255. */
function hslTripletToRgb(triplet: string): Rgb | null {
  const parts = triplet.trim().split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/**
 * Read a token's current computed value as RGB.
 *
 * Snapshot, not live — re-read whenever `useVizThemeVersion()` changes.
 * Returns null during SSR, where there is no computed style to read.
 */
export function resolve(token: VizToken): Rgb | null {
  if (typeof window === "undefined") return null;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${token}`);
  return raw ? hslTripletToRgb(raw) : null;
}

const toCss = (c: Rgb) => `rgb(${c.r} ${c.g} ${c.b})`;

/* ── Sequential ramp (treemap complexity heat) ────────────── */

const SEQ_FALLBACK_FROM: Rgb = { r: 22, g: 27, b: 34 };
const SEQ_FALLBACK_TO: Rgb = { r: 240, g: 136, b: 62 };

/**
 * Build a cold → hot color scale over an explicit `[min, max]` domain.
 *
 * Interpolates in RGB rather than HSL on purpose: the light-theme ramp runs
 * from a blue-grey (h≈213) to a hot orange (h≈14), and interpolating that in
 * HSL takes the hue the long way round through green/yellow (or the short way
 * through purple/magenta, depending on direction). Neither reads as heat. RGB
 * gives a clean wash and matches the `d3.interpolateRgb` behavior this
 * replaced.
 *
 * The domain is min–max, not 0–max. Real metrics cluster well above zero, so
 * anchoring at 0 leaves the cold half of the ramp permanently unused and every
 * tile reads warm — which destroys the signal the chart exists to carry. Pair
 * this with a legend that prints the same two endpoints, so "hot" is a claim
 * the reader can check.
 *
 * `gamma` defaults to linear. A gamma below 1 was previously compensating for
 * the 0-anchored domain; with a real domain it only distorts the mapping away
 * from what the legend advertises.
 */
export function seqScale(
  domain: [number, number],
  gamma = 1,
): (value: number) => string {
  const from = resolve("viz-seq-from") ?? SEQ_FALLBACK_FROM;
  const to = resolve("viz-seq-to") ?? SEQ_FALLBACK_TO;
  const [lo, hi] = domain;
  // Degenerate domain (one distinct value, or bad data): put everything at the
  // cold end rather than dividing by zero and painting the whole chart hot.
  const span = hi > lo ? hi - lo : 0;

  return (value: number) => {
    const raw = span === 0 ? 0 : (value - lo) / span;
    const t = Math.min(1, Math.max(0, gamma === 1 ? raw : Math.pow(raw, gamma)));
    return toCss({
      r: Math.round(from.r + (to.r - from.r) * t),
      g: Math.round(from.g + (to.g - from.g) * t),
      b: Math.round(from.b + (to.b - from.b) * t),
    });
  };
}

/**
 * Label color that stays legible on a `seqScale` fill.
 *
 * Uses relative luminance rather than a fixed threshold, because the ramp's
 * light end is near-white in light mode and near-black in dark mode — a
 * hardcoded cutoff would be wrong in one theme or the other.
 */
export function inkOnFill(fill: string): string {
  const m = fill.match(/-?\d+(\.\d+)?/g);
  if (!m || m.length < 3) return inkVar();
  const [r, g, b] = m.slice(0, 3).map(Number);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // 0.36 sits between the two candidate contrasts (white vs near-black ink)
  // so whichever we pick clears 4.5:1 against the fill.
  return L > 0.36 ? "hsl(222 47% 11%)" : "hsl(0 0% 100%)";
}

/* ── Theme change subscription ────────────────────────────── */

/**
 * Increments whenever the theme changes.
 *
 * `next-themes` toggles the `class` attribute on `<html>`, which silently
 * changes every computed token. Anything holding a CONCRETE color (a
 * `seqScale`, an `inkOnFill` result) is stale after that and must redraw.
 * Put this in the dependency array of the effect that draws.
 *
 * Charts that only use the live `cssVar()` helpers do not need this.
 */
export function useVizThemeVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver((records) => {
      // Only react to class/style flips, not unrelated attribute churn.
      if (records.some((r) => r.attributeName === "class" || r.attributeName === "style")) {
        setVersion((v) => v + 1);
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);

  return version;
}
