"use client";

/**
 * Subscribe to a CSS media query from React.
 *
 * `useSyncExternalStore`, not `useState` + `useEffect`: a media query is
 * exactly the external store that API exists for, and this repo enforces
 * `react-hooks/set-state-in-effect` as an error, which rules out the effect
 * version anyway. Same shape as `components/viz/useReducedMotion`.
 *
 * Server rendering has no `matchMedia`, so every query reads false there and
 * corrects on hydrate. Write layouts so that false is the desktop case — a
 * flash of "wide" is cheaper than a flash of "mobile" on a desktop.
 */

import { useCallback, useSyncExternalStore } from "react";

/** Below this the sidebar overlays the canvas instead of sitting beside it. */
export const NARROW_QUERY = "(max-width: 1023px)";

/** Coarse pointer — touch. Hover-only affordances are unreachable here. */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";

export function matches(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => matches(query), [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** True on touch devices, where there is no hover to trigger a tooltip. */
export const useCoarsePointer = () => useMediaQuery(COARSE_POINTER_QUERY);
