"use client";

/**
 * Shared zoom/pan controller for D3 charts.
 *
 * Each chart still creates its own `d3.zoom` behavior inside its draw effect
 * (the scale extent and what the transform is applied to are chart-specific),
 * then hands the pieces here via `register()`. VizShell's zoom cluster and the
 * keyboard shortcuts drive this controller, so every chart gets identical
 * controls without duplicating the button markup — which was previously
 * copy-pasted byte-for-byte between DependencyGraph and DataFlowGraph.
 *
 * `fitToView` measures the real rendered content with `getBBox()`. Do not
 * substitute guessed layout constants: ArchitectureGraph did that and misfit
 * whenever content was narrower than its lane.
 */

import { useCallback, useMemo, useRef } from "react";
import * as d3 from "d3";

export const ZOOM_MIN = 0.15;
export const ZOOM_MAX = 3;
const ZOOM_STEP = 1.3;
/** Leave a margin so fitted content does not touch the frame. */
const FIT_PADDING = 0.85;

export interface VizZoom {
  /** Call from the draw effect once the svg, behavior, and root <g> exist. */
  register(
    svg: SVGSVGElement | null,
    behavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null,
    root: SVGGElement | null,
  ): void;
  zoomIn(): void;
  zoomOut(): void;
  /**
   * Frame the rendered content.
   *
   * Pass `{ animate: false }` for the initial fit a chart runs after layout —
   * animating from the identity transform on first paint reads as an unrequested
   * zoom-in rather than a chart appearing. User-triggered fits keep the tween.
   */
  fitToView(opts?: { animate?: boolean }): void;
  /** Handles +/-/0 so charts are operable without a mouse. */
  onKeyDown(event: React.KeyboardEvent): void;
}

export function useVizZoom(animate = true): VizZoom {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const behaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const rootRef = useRef<SVGGElement | null>(null);

  const register: VizZoom["register"] = useCallback((svg, behavior, root) => {
    svgRef.current = svg;
    behaviorRef.current = behavior;
    rootRef.current = root;
  }, []);

  const scaleBy = useCallback(
    (factor: number) => {
      const svg = svgRef.current;
      const behavior = behaviorRef.current;
      if (!svg || !behavior) return;
      const sel = d3.select(svg);
      (animate ? sel.transition().duration(200) : (sel as never)).call(
        behavior.scaleBy as never,
        factor,
      );
    },
    [animate],
  );

  const zoomIn = useCallback(() => scaleBy(ZOOM_STEP), [scaleBy]);
  const zoomOut = useCallback(() => scaleBy(1 / ZOOM_STEP), [scaleBy]);

  const fitToView = useCallback(
    (opts?: { animate?: boolean }) => {
    const shouldAnimate = opts?.animate ?? animate;
    const svg = svgRef.current;
    const behavior = behaviorRef.current;
    const root = rootRef.current;
    if (!svg || !behavior || !root) return;

    // Real content bounds, not assumed ones.
    let bbox: DOMRect;
    try {
      bbox = root.getBBox();
    } catch {
      // getBBox throws if the element is not rendered (hidden tab).
      return;
    }
    if (bbox.width === 0 || bbox.height === 0) return;

    const w = svg.clientWidth || 800;
    const h = svg.clientHeight || 500;
    const scale = Math.max(
      ZOOM_MIN,
      Math.min(ZOOM_MAX, Math.min(w / bbox.width, h / bbox.height) * FIT_PADDING),
    );
    const tx = w / 2 - scale * (bbox.x + bbox.width / 2);
    const ty = h / 2 - scale * (bbox.y + bbox.height / 2);

    const sel = d3.select(svg);
    (shouldAnimate ? sel.transition().duration(300) : (sel as never)).call(
      behavior.transform as never,
      d3.zoomIdentity.translate(tx, ty).scale(scale),
    );
    },
    [animate],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      } else if (event.key === "0") {
        event.preventDefault();
        fitToView();
      }
    },
    [zoomIn, zoomOut, fitToView],
  );

  return useMemo(
    () => ({ register, zoomIn, zoomOut, fitToView, onKeyDown }),
    [register, zoomIn, zoomOut, fitToView, onKeyDown],
  );
}
