import { describe, expect, it } from "vitest";
import { resolveSurface, SURFACES } from "../palettes";
import { styleById } from "../styles";

describe("resolveSurface", () => {
  const neon = styleById("neon"); // surfaceId "slide" + a surface override

  it("gives an opinionless style the theme's ground", () => {
    const glass = styleById("glass");
    expect(resolveSurface(glass, null, "black").bg).toBe(SURFACES.black.bg);
    expect(resolveSurface(glass, null, "paper").bg).toBe(SURFACES.paper.bg);
  });

  it("prefers the style's own ground over the theme", () => {
    expect(resolveSurface(neon, null, "paper").bg).toBe("#07090C");
  });

  it("returns an explicit pick unmerged", () => {
    // The regression: Neon's `surface.bg` used to bleed over a picked Paper.
    expect(resolveSurface(neon, "paper", "black")).toEqual(SURFACES.paper);
  });
});
