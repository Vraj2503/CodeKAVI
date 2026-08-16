import { describe, expect, it } from "vitest";
import { CATEGORY_LABEL, swatchFor, DEFAULT_PALETTE } from "../palettes";
import {
  PUB_TEXTURE,
  resolveFaces,
  resolveStroke,
  styleById,
  textureFor,
} from "../styles";

describe("publication style", () => {
  const pub = styleById("publication");
  const sw = swatchFor(DEFAULT_PALETTE, "convolution");

  it("covers every layer category", () => {
    for (const cat of Object.keys(CATEGORY_LABEL)) {
      expect(PUB_TEXTURE[cat], cat).toBeDefined();
    }
    expect(textureFor("no-such-category")).toBe("plain");
  });

  it("is monochrome — the palette cannot reach it", () => {
    expect(resolveStroke(pub, sw)).toBe("#14181D");
    expect(resolveFaces(pub, sw).front.fill).toBe("#FFFFFF");
  });

  it("still colours the volumetric styles", () => {
    const threeD = styleById("3d");
    expect(resolveStroke(threeD, sw)).toBe(sw.edge);
    expect(resolveFaces(threeD, sw).front.fill).toBe(sw.face);
  });
});
