import type { ReactFlowInstance } from "@xyflow/react";

/** E7 camera trap ceiling — give up on measured dimensions and fit whatever's
 * on screen instead of stranding the user. */
export const TOUR_CAMERA_TRAP_TIMEOUT_MS = 4000;

type CameraTrapFlow = Pick<ReactFlowInstance, "getInternalNode" | "fitView">;

/**
 * A tour step's node usually sits inside a container that was just expanded,
 * so it may not exist in the canvas with measured dimensions yet (Stage 2 ELK
 * layout is async). Poll the live React Flow store until it does, then
 * fitView on it; fall back to fitting the layer after the ceiling.
 *
 * Returns a cancel function.
 */
export function runCameraTrap(
  reactFlow: CameraTrapFlow,
  nodeId: string,
  opts: { now?: () => number; timeoutMs?: number } = {},
): () => void {
  const now = opts.now ?? (() => performance.now());
  const deadline = now() + (opts.timeoutMs ?? TOUR_CAMERA_TRAP_TIMEOUT_MS);
  let rafId: number;
  let cancelled = false;

  const poll = () => {
    const measured = reactFlow.getInternalNode(nodeId)?.measured;
    if (measured?.width && measured?.height) {
      // Imperative fitView doesn't inherit the component's fitViewOptions, and
      // the instance maxZoom defaults to 2 — without this a file node renders
      // at 2× and edge-to-edge. padding keeps its neighbours in frame.
      reactFlow.fitView({
        nodes: [{ id: nodeId }],
        duration: 300,
        maxZoom: 1,
        padding: 0.4,
      });
      return;
    }
    if (now() >= deadline) {
      reactFlow.fitView({ duration: 300 });
      return;
    }
    rafId = requestAnimationFrame(poll);
  };
  rafId = requestAnimationFrame(poll);

  return () => {
    if (!cancelled) {
      cancelled = true;
      cancelAnimationFrame(rafId);
    }
  };
}
