import { describe, expect, it } from "vitest";
import { intrinsicSize, serializeSvg } from "../exportFigure";

/** Minimal stand-in for what FigureCanvas puts on the page. */
function makeSvg(trim: number): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 800 500");
  svg.setAttribute("width", "400"); // scaled to fit its pane
  svg.setAttribute("height", "250");
  svg.setAttribute("data-export-trim", String(trim));
  const legend = document.createElementNS("http://www.w3.org/2000/svg", "g");
  legend.setAttribute("data-export-hide", "");
  legend.setAttribute("id", "legend");
  svg.appendChild(legend);
  return svg;
}

describe("export cropping", () => {
  it("reads the intrinsic size off the viewBox, not the fitted attributes", () => {
    expect(intrinsicSize(makeSvg(0))).toEqual({ width: 800, height: 500 });
  });

  it("takes the trimmed band off the height", () => {
    expect(intrinsicSize(makeSvg(58))).toEqual({ width: 800, height: 442 });
  });

  it("drops marked furniture and re-crops the viewBox to match", () => {
    const out = serializeSvg(makeSvg(58), null);
    expect(out).not.toContain('id="legend"');
    expect(out).toContain('viewBox="0 0 800 442"');
    expect(out).toContain('height="442"');
  });
});
