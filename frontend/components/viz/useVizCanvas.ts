"use client";

/**
 * Container measurement for D3 charts.
 *
 * Extracted from DependencyGraph, the only visualization that got this fully
 * right. The debounce matters: the sidebar collapse animates, so an
 * unthrottled observer fires a re-layout on every frame of it.
 *
 * Observe the CONTAINER, never `window`. A sidebar collapse changes the
 * container without changing the window, so a window listener silently misses
 * it — that was the NeuralNetworkViz bug.
 *
 * Attachment is a callback ref rather than a ref object so consumers can spread
 * it straight onto an element without reading `.current` during render, which
 * React's compiler lint (correctly) rejects. `containerRef` is still exposed
 * for effect-time reads like `clientWidth`.
 */

import { useCallback, useRef, useState } from "react";

export interface VizCanvasSize {
  width: number;
  height: number;
}

export interface VizCanvas {
  /**
   * Attach to the measured element: `<div ref={canvas.attach}>`.
   * Named `attach`, not `ref`, because React's compiler lint treats any
   * `.ref` property access during render as reading a ref object.
   */
  attach: (el: HTMLDivElement | null) => void;
  /** For reads inside effects and imperative handles — never during render. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  size: VizCanvasSize;
  /** True once a real measurement has landed — guard draw effects on this. */
  ready: boolean;
}

export function useVizCanvas(debounceMs = 150): VizCanvas {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [size, setSize] = useState<VizCanvasSize>({ width: 0, height: 0 });

  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      // Callback refs fire again on unmount (with null) and on element swap,
      // so tear down unconditionally before deciding what to do next.
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);

      containerRef.current = el;
      if (!el) return;

      // Measure at attach time so the first paint is not a 0x0 chart.
      setSize({ width: el.clientWidth, height: el.clientHeight });

      const observer = new ResizeObserver((entries) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          const rect = entries[0]?.contentRect;
          if (!rect) return;
          // Ignore collapse-to-zero (hidden tab, display:none). Redrawing at
          // 0x0 throws the layout away and it never comes back on reveal.
          if (rect.width < 1 || rect.height < 1) return;
          setSize((prev) =>
            prev.width === rect.width && prev.height === rect.height
              ? prev
              : { width: rect.width, height: rect.height },
          );
        }, debounceMs);
      });
      observer.observe(el);
      observerRef.current = observer;
    },
    [debounceMs],
  );

  return { attach, containerRef, size, ready: size.width > 0 && size.height > 0 };
}
