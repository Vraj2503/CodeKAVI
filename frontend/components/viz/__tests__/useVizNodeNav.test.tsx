/**
 * Tests for keyboard traversal of a chart's nodes (T12).
 *
 * The defect these exist to prevent: the visualization suite had no focusable
 * nodes at all, so `DependencyGraph`'s drill-down — the most useful thing it
 * does — was reachable by mouse only, and a screen reader met a wall of
 * unlabeled `<rect>`s.
 *
 * The invariants are about *reachability*: every node can be focused, focus
 * never dead-ends, and Enter does exactly what a click does.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { useVizNodeNav, type VizNodeNavOptions } from "../useVizNodeNav";

/** Minimal stand-in for a chart: a root <g> holding three labelled nodes. */
function Chart({ options, count = 3 }: { options?: VizNodeNavOptions; count?: number }) {
  const nav = useVizNodeNav(options);
  const rootRef = useRef<SVGGElement>(null);

  useEffect(() => {
    nav.register(rootRef.current, "g.viz-node");
    return () => nav.register(null);
  }, [nav, count]);

  return (
    <div data-testid="shell" tabIndex={0} onKeyDown={(e) => nav.onKeyDown(e)}>
      <svg>
        <g ref={rootRef}>
          {Array.from({ length: count }, (_, i) => (
            <g key={i} className="viz-node" data-testid={`n${i}`} aria-label={`node ${i}`} />
          ))}
        </g>
      </svg>
    </div>
  );
}

const shell = () => screen.getByTestId("shell");
const focusedLabel = () => document.activeElement?.getAttribute("aria-label") ?? null;

beforeEach(() => {
  // jsdom does not implement scrollIntoView; the hook calls it optionally.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  // The config has no `globals`, so testing-library's auto-cleanup never
  // registers and mounted trees would stack across cases.
  cleanup();
  vi.clearAllMocks();
});

describe("useVizNodeNav", () => {
  it("makes nodes focusable without putting them in the tab order", () => {
    // The shell is the single tab stop. 250 treemap tiles in the tab order
    // would be worse than none at all.
    render(<Chart />);
    expect(screen.getByTestId("n0").getAttribute("tabindex")).toBe("-1");
    expect(screen.getByTestId("n2").getAttribute("tabindex")).toBe("-1");
  });

  it("moves focus onto the first node on the first arrow press", () => {
    render(<Chart />);
    shell().focus();
    fireEvent.keyDown(shell(), { key: "ArrowRight" });
    expect(focusedLabel()).toBe("node 0");
  });

  it("enters at the same node whichever arrow was pressed", () => {
    // Direction decides where you go *next*, not where you come in. Letting
    // ArrowLeft enter at the far end drops the user into a part of a chart
    // they have not seen, and breaks resuming where they left off.
    render(<Chart />);
    shell().focus();
    fireEvent.keyDown(shell(), { key: "ArrowLeft" });
    expect(focusedLabel()).toBe("node 0");
  });

  it("walks forward and backward", () => {
    render(<Chart />);
    fireEvent.keyDown(shell(), { key: "ArrowRight" });
    fireEvent.keyDown(shell(), { key: "ArrowDown" });
    expect(focusedLabel()).toBe("node 1");
    fireEvent.keyDown(shell(), { key: "ArrowLeft" });
    expect(focusedLabel()).toBe("node 0");
  });

  it("wraps at both ends rather than silently doing nothing", () => {
    // A chart has no scrollbar to orient by, so a no-op at the edge reads as
    // broken input rather than as a boundary.
    render(<Chart />);
    fireEvent.keyDown(shell(), { key: "ArrowRight" }); // enter at node 0
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(focusedLabel()).toBe("node 2");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(focusedLabel()).toBe("node 0");
  });

  it("jumps to the ends with Home and End", () => {
    render(<Chart />);
    fireEvent.keyDown(shell(), { key: "End" });
    expect(focusedLabel()).toBe("node 2");
    fireEvent.keyDown(shell(), { key: "Home" });
    expect(focusedLabel()).toBe("node 0");
  });

  it("activates the focused node with Enter and Space", () => {
    const onActivate = vi.fn();
    render(<Chart options={{ onActivate }} />);

    fireEvent.keyDown(shell(), { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0][0]).toBe(screen.getByTestId("n0"));

    fireEvent.keyDown(document.activeElement!, { key: " " });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it("does not activate when focus is still on the shell", () => {
    // Enter before any arrow press has no node to act on. Firing on node 0
    // would drill somewhere the user never pointed at.
    const onActivate = vi.fn();
    render(<Chart options={{ onActivate }} />);
    shell().focus();
    fireEvent.keyDown(shell(), { key: "Enter" });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("leaves Escape alone when the chart has nothing to back out of", () => {
    // Consuming Escape unconditionally would break whatever owns it outside
    // the chart — a modal, a menu.
    render(<Chart />);
    const handled = { current: true };
    const el = shell();
    el.addEventListener("keydown", (e) => {
      handled.current = e.defaultPrevented;
    });
    fireEvent.keyDown(el, { key: "Escape" });
    expect(handled.current).toBe(false);
  });

  it("calls onEscape when the chart does have somewhere to go", () => {
    const onEscape = vi.fn();
    render(<Chart options={{ onEscape }} />);
    fireEvent.keyDown(shell(), { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("reports whether it consumed the key, so zoom can have the rest", () => {
    // `VizShell` forwards unhandled keys to the zoom controller. If this
    // returned true for everything, +/-/0 would stop working.
    const seen: boolean[] = [];
    function Probe() {
      const nav = useVizNodeNav();
      const rootRef = useRef<SVGGElement>(null);
      useEffect(() => {
        nav.register(rootRef.current, "g.viz-node");
      }, [nav]);
      return (
        <div
          data-testid="shell"
          tabIndex={0}
          onKeyDown={(e) => seen.push(nav.onKeyDown(e))}
        >
          <svg>
            <g ref={rootRef}>
              <g className="viz-node" aria-label="node 0" />
            </g>
          </svg>
        </div>
      );
    }
    render(<Probe />);
    fireEvent.keyDown(screen.getByTestId("shell"), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByTestId("shell"), { key: "+" });
    expect(seen).toEqual([true, false]);
  });

  it("survives a redraw that changes the node count", () => {
    // D3 replaces every element on redraw. An index left pointing past the end
    // would throw on the next arrow press.
    const { rerender } = render(<Chart count={5} />);
    fireEvent.keyDown(shell(), { key: "End" });
    expect(focusedLabel()).toBe("node 4");

    rerender(<Chart count={2} />);
    fireEvent.keyDown(shell(), { key: "ArrowRight" });
    expect(focusedLabel()).toBe("node 0");
  });
});
