"use client";

/**
 * Keyboard traversal over the nodes of a D3 chart.
 *
 * Before this, the visualization suite was operable by mouse only: no focusable
 * nodes, no tab order, and `DependencyGraph`'s entire drill-down feature was
 * unreachable without a pointer. The only text alternative was AI Insights,
 * which is opt-in, LLM-gated and quota-limited — i.e. not an alternative.
 *
 * The pattern is a roving tabindex, adapted for SVG that D3 rebuilds from
 * scratch on every draw:
 *
 *   - `VizShell`'s wrapper is the single tab stop. Tab lands on the chart, not
 *     on 250 tiles.
 *   - Nodes carry `tabindex="-1"`, so they are focusable programmatically but
 *     never by Tab.
 *   - Arrows move focus in DOM order. For these charts DOM order is the order
 *     the layout emitted — lanes top to bottom, tiles largest first — which is
 *     the order a reader would expect anyway.
 *   - Enter/Space activates, Escape backs out. Both are chart-specific and
 *     delegated to the caller.
 *
 * `register` is called from the draw effect, after the nodes exist, and again
 * with `null` on cleanup. The index survives a redraw only if the node count
 * does — a chart that just drilled into a subtree starts over at the top,
 * which is the right place to be.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

export interface VizNodeNav {
  /**
   * Point the controller at the freshly drawn nodes.
   *
   * `selector` is scoped to `root`, e.g. `"g.arch-node"`. Every match gets
   * `tabindex="-1"` so it can receive focus without joining the tab order.
   */
  register(root: SVGGElement | null, selector?: string): void;
  /** Returns true when the key was consumed, so zoom shortcuts can have the rest. */
  onKeyDown(event: React.KeyboardEvent): boolean;
}

export interface VizNodeNavOptions {
  /** Enter or Space on the focused node. */
  onActivate?: (el: SVGGElement) => void;
  /** Escape, with focus back on the chart. Close a panel, or drill up. */
  onEscape?: () => void;
}

const FORWARD = new Set(["ArrowRight", "ArrowDown"]);
const BACKWARD = new Set(["ArrowLeft", "ArrowUp"]);

export function useVizNodeNav(options: VizNodeNavOptions = {}): VizNodeNav {
  const rootRef = useRef<SVGGElement | null>(null);
  const selectorRef = useRef<string>("[data-viz-node]");
  const indexRef = useRef(0);
  // Held in a ref so a caller can pass fresh closures every render without
  // changing this controller's identity — charts put it in draw-effect deps,
  // and a new identity there would rebuild the whole SVG on every render.
  //
  // Written from an effect, not during render: this repo enforces
  // `react-hooks/refs`, which rejects a render-time ref write outright.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const nodes = useCallback((): SVGGElement[] => {
    const root = rootRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<SVGGElement>(selectorRef.current));
  }, []);

  const register: VizNodeNav["register"] = useCallback(
    (root, selector) => {
      rootRef.current = root;
      if (selector) selectorRef.current = selector;
      if (!root) return;

      const found = nodes();
      // Reset only when the shape changed. A pure re-layout (resize, theme
      // flip) should not throw away where the user was.
      if (indexRef.current >= found.length) indexRef.current = 0;
      found.forEach((el) => el.setAttribute("tabindex", "-1"));
    },
    [nodes],
  );

  const focusAt = useCallback(
    (index: number) => {
      const found = nodes();
      if (found.length === 0) return;
      // Wrap, rather than dead-ending at each extreme: with no visible
      // scrollbar to orient by, a silent no-op reads as broken.
      const next = ((index % found.length) + found.length) % found.length;
      indexRef.current = next;
      found[next].focus();
      // Chrome does not scroll a focused SVG element into view on its own.
      found[next].scrollIntoView?.({ block: "nearest", inline: "nearest" });
    },
    [nodes],
  );

  const onKeyDown: VizNodeNav["onKeyDown"] = useCallback(
    (event) => {
      const found = nodes();
      if (found.length === 0) return false;

      const active = document.activeElement as Element | null;
      const focused = found.findIndex((el) => el === active);
      // False when focus is still on the shell — the first arrow press after
      // Tab, or after focus left the chart and came back.
      const entered = focused >= 0;

      // Entering always lands on the remembered index (0 on a fresh chart),
      // whichever arrow was pressed. Making direction decide the entry point
      // would mean ArrowLeft jumps to the far end of a chart the user has not
      // seen yet, and it silently breaks "resume where I left off".
      if (FORWARD.has(event.key)) {
        event.preventDefault();
        focusAt(entered ? focused + 1 : indexRef.current);
        return true;
      }
      if (BACKWARD.has(event.key)) {
        event.preventDefault();
        focusAt(entered ? focused - 1 : indexRef.current);
        return true;
      }
      if (event.key === "Home") {
        event.preventDefault();
        focusAt(0);
        return true;
      }
      if (event.key === "End") {
        event.preventDefault();
        focusAt(found.length - 1);
        return true;
      }
      if ((event.key === "Enter" || event.key === " ") && focused >= 0) {
        event.preventDefault();
        optionsRef.current.onActivate?.(found[focused]);
        return true;
      }
      if (event.key === "Escape") {
        // Not preventDefault'd unconditionally: if the chart has nothing to
        // back out of, Escape should keep whatever meaning it has outside.
        if (optionsRef.current.onEscape) {
          event.preventDefault();
          optionsRef.current.onEscape();
          return true;
        }
      }
      return false;
    },
    [nodes, focusAt],
  );

  return useMemo(() => ({ register, onKeyDown }), [register, onKeyDown]);
}
