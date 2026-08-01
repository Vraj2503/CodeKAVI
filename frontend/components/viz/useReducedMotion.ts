"use client";

/**
 * Tracks the OS "reduce motion" setting.
 *
 * The visualizations lean on motion more than the rest of the app:
 * DataFlowGraph runs a particle animation that re-arms itself forever, the
 * mind map tweens every expand, and the neural-net view staggers its entrance.
 * None of it was guarded. Beyond the accessibility problem, the perpetual
 * particle loop is a background CPU and battery drain that never stops.
 *
 * Implemented with useSyncExternalStore rather than useState + useEffect: a
 * media query is exactly the "external store" that API exists for, and reading
 * it in an effect would mean an extra render on every mount just to correct
 * the initial guess.
 */

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/** No media queries on the server — assume motion is allowed and correct on hydrate. */
function getServerSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
