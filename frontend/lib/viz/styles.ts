/**
 * Render styles — the *material* the figure is made of.
 *
 * This is deliberately a separate axis from the palette. Palette answers
 * "which hues", style answers "how does the surface behave": is it flat ink
 * on paper, frosted glass, emissive neon, or a wireframe drafting sheet.
 * Six styles × six palettes is thirty-six looks from two small tables, and
 * every combination stays internally consistent because both are derived
 * rather than hand-listed.
 *
 * One honest tradeoff, stated up front: `publication` is the only style with
 * no gradients or filters. Gradients band when a figure is rasterised at 3×
 * and downsampled by a print pipeline, and SVG filters raster differently
 * across renderers. The other five exist for slides, docs and the web, where
 * that does not matter and the look does.
 */

import { shade, type Swatch } from "./palettes";
import type { Surface } from "./palettes";

export interface FaceRender {
  fill: string;
  opacity: number;
}

export interface FigureStyle {
  id: string;
  label: string;
  description: string;
  /** Surface this style implies. The user can still override it. */
  surfaceId: "paper" | "slide" | "transparent";
  /** Override the implied surface with style-specific values. */
  surface?: Partial<Surface>;
  face: {
    /** Vertical gradient across the front face. */
    gradient: boolean;
    /** Specular sheen band across the upper front face. */
    gloss: boolean;
    /** Draw fills at all, or line-art only. */
    filled: boolean;
    opacity: number;
  };
  stroke: {
    width: number;
    /** Emissive halo behind the keyline. */
    glow: boolean;
    /** Keyline takes the layer hue rather than a dark derived edge. */
    hued: boolean;
  };
  shadow: "none" | "soft" | "deep";
  /** Ghost copies of a repeated stack are dimmer on dark surfaces. */
  ghostBoost: number;
}

export const STYLES: FigureStyle[] = [
  {
    id: "publication",
    label: "Publication",
    description:
      "Flat solids, crisp keylines. No gradients or filters — the only style that survives a print pipeline unchanged.",
    surfaceId: "paper",
    face: { gradient: false, gloss: false, filled: true, opacity: 1 },
    stroke: { width: 1.8, glow: false, hued: false },
    shadow: "none",
    ghostBoost: 1,
  },
  {
    id: "glass",
    label: "Glass",
    description:
      "Frosted translucent faces with a specular sheen and a soft cast shadow.",
    surfaceId: "paper",
    face: { gradient: true, gloss: true, filled: true, opacity: 0.62 },
    stroke: { width: 1.4, glow: false, hued: true },
    shadow: "soft",
    ghostBoost: 0.8,
  },
  {
    id: "neon",
    label: "Neon",
    description:
      "Near-black volumes lit by emissive hued edges. Terminal energy.",
    surfaceId: "slide",
    surface: { bg: "#07090C", rule: "#3A4450" },
    face: { gradient: true, gloss: false, filled: true, opacity: 0.34 },
    stroke: { width: 2, glow: true, hued: true },
    shadow: "none",
    ghostBoost: 0.6,
  },
  {
    id: "studio",
    label: "Studio",
    description:
      "Rich vertical gradients and a deep cast shadow. Built for a title slide.",
    surfaceId: "slide",
    surface: { bg: "#12161C" },
    face: { gradient: true, gloss: true, filled: true, opacity: 1 },
    stroke: { width: 1.2, glow: false, hued: false },
    shadow: "deep",
    ghostBoost: 0.85,
  },
  {
    id: "blueprint",
    label: "Blueprint",
    description:
      "Drafting sheet. Hairline wireframe volumes, no fills, technical throughout.",
    surfaceId: "slide",
    surface: {
      bg: "#0B2138",
      ink: "#DCEAF7",
      inkDim: "#7FA6C8",
      rule: "#3C6A96",
    },
    face: { gradient: false, gloss: false, filled: true, opacity: 0.14 },
    stroke: { width: 1.5, glow: false, hued: true },
    shadow: "none",
    ghostBoost: 0.7,
  },
  {
    id: "outline",
    label: "Outline",
    description:
      "Pure line art on white. Maximum legibility, minimum ink, greyscale-proof.",
    surfaceId: "paper",
    face: { gradient: false, gloss: false, filled: true, opacity: 0.12 },
    stroke: { width: 2.2, glow: false, hued: false },
    shadow: "none",
    ghostBoost: 1,
  },
];

export const DEFAULT_STYLE = STYLES[0];

export function styleById(id: string): FigureStyle {
  return STYLES.find((s) => s.id === id) ?? DEFAULT_STYLE;
}

/**
 * Resolve the three cuboid faces for a style + swatch.
 *
 * `neon` inverts the usual logic: the volume is a dark tint of the hue and
 * the *edge* carries the colour, which is what makes it read as emitted
 * light rather than painted plastic.
 */
export function resolveFaces(
  style: FigureStyle,
  sw: Swatch,
): { front: FaceRender; top: FaceRender; side: FaceRender } {
  const o = style.face.opacity;

  if (style.id === "neon") {
    return {
      front: { fill: shade(sw.face, -0.62), opacity: o },
      top: { fill: shade(sw.face, -0.42), opacity: o },
      side: { fill: shade(sw.face, -0.74), opacity: o },
    };
  }

  if (style.id === "blueprint" || style.id === "outline") {
    // Wireframe-leaning: a whisper of fill so the volume still reads as
    // solid, with the keyline doing the actual describing.
    return {
      front: { fill: sw.face, opacity: o },
      top: { fill: sw.top, opacity: o * 0.7 },
      side: { fill: sw.side, opacity: o * 1.2 },
    };
  }

  return {
    front: { fill: sw.face, opacity: o },
    top: { fill: sw.top, opacity: o },
    side: { fill: sw.side, opacity: o },
  };
}

export function resolveStroke(style: FigureStyle, sw: Swatch): string {
  if (style.id === "outline") return "#14181D";
  return style.stroke.hued ? sw.face : sw.edge;
}
