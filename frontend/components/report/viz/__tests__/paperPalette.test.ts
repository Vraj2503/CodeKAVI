/**
 * Regression guard for the NN figure's paper ground (D1, 2026-08-14).
 *
 * Every other chart in the viz suite follows the app theme via live
 * `hsl(var(--x))` tokens. This one deliberately opts out: the reference
 * figures it targets are ink-on-paper, and a figure that renders differently
 * on screen than exported is not something a researcher can screenshot
 * straight into a slide. So the figure's ink is concrete hex, in both themes,
 * always — there used to be a `toPaperPalette()` string transform that swapped
 * live tokens for concrete colors at export time; that function is gone
 * because there is no longer anything live to swap.
 *
 * What could silently regress this: someone "fixing" a color back to a
 * `cssVar()`/`inkVar()` call to match the rest of the suite, not realizing
 * this chart's on-screen and exported renders are the same image on purpose.
 */

import { describe, expect, it } from "vitest";
import { NN_PAPER_INK } from "../NeuralNetworkViz";

describe("NN_PAPER_INK", () => {
  it("is concrete hex, never a live theme reference", () => {
    for (const [name, value] of Object.entries(NN_PAPER_INK)) {
      expect(value, name).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(value, name).not.toContain("var(");
    }
  });
});
