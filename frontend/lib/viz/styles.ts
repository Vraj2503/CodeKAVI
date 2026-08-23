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
 * `publication` is the odd one out and sits outside that grid: it is `flat`,
 * so it draws a 2-D plate instead of cabinet-projected volumes, and it is
 * monochrome, so the palette select does not reach it. Layer types are told
 * apart by `PUB_TEXTURE` instead of by hue — which is also what makes it
 * survive being printed in greyscale.
 *
 * One honest tradeoff, stated up front: `3d` is the only *volumetric* style
 * with no gradients or filters. Gradients band when a figure is rasterised
 * at 3× and downsampled by a print pipeline, and SVG filters raster
 * differently across renderers. The other four volumetric styles exist for
 * slides, docs and the web, where that does not matter and the look does.
 */

import { shade, type Swatch } from "./palettes";
import type { Surface, SurfaceId } from "./palettes";

export interface FaceRender {
  fill: string;
  opacity: number;
}

export interface FigureStyle {
  id: string;
  label: string;
  description: string;
  /**
   * Surface this style implies. The user can still override it, and a style
   * with no opinion omits it and follows the app theme — see
   * `resolveSurface`.
   */
  surfaceId?: SurfaceId;
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
  /**
   * Draw the figure as a flat 2-D plate rather than cabinet-projected
   * volumes: rounded blocks, texture instead of hue, serif type. Collapses
   * the layout's depth to zero — see `LayoutOptions.flat`.
   */
  flat?: boolean;
}

export const STYLES: FigureStyle[] = [
  {
    id: "3d",
    label: "3D",
    description:
      "Cabinet-projected volumes in flat solids with crisp keylines. No gradients or filters — the only style that survives a print pipeline unchanged.",
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
    // Keeps its opinion: `resolveStroke` gives this style a literal dark ink,
    // which would vanish on a near-black canvas.
    surfaceId: "paper",
    face: { gradient: false, gloss: false, filled: true, opacity: 0.12 },
    stroke: { width: 2.2, glow: false, hued: false },
    shadow: "none",
    ghostBoost: 1,
  },
  {
    id: "publication",
    label: "Publication",
    description:
      "Flat 2-D line figure for a paper. Monochrome, texture-coded, greyscale-proof.",
    flat: true,
    // A paper figure is printed on paper. This one ignores the theme on
    // purpose — the ground is part of what the style *is*.
    surfaceId: "paper",
    face: { gradient: false, gloss: false, filled: true, opacity: 1 },
    stroke: { width: 1.8, glow: false, hued: false },
    shadow: "none",
    ghostBoost: 1,
  },
];

export const DEFAULT_STYLE = STYLES[0];

export function styleById(id: string): FigureStyle {
  return STYLES.find((s) => s.id === id) ?? DEFAULT_STYLE;
}

// ── Flat (publication) textures ──────────────────────────────────────────

export type PubTexture =
  "hatch" | "cross" | "lines" | "grey" | "dashed" | "plain";

/**
 * What distinguishes one layer type from another when there is no colour.
 *
 * Six textures across eleven categories, so pairs collide by design. The
 * pairing is chosen so a colliding pair rarely co-occurs in one figure — a
 * net with both convolution and attention blocks is unusual — and the legend
 * disambiguates when it does. Six patterns is already at the limit of what
 * stays legible at block size; a seventh reads as noise.
 */
export const PUB_TEXTURE: Record<string, PubTexture> = {
  convolution: "hatch",
  attention: "hatch",
  pooling: "cross",
  recurrent: "cross",
  dense: "lines",
  output: "lines",
  normalization: "grey",
  embedding: "grey",
  activation: "dashed",
  dropout: "dashed",
  other: "plain",
};

export function textureFor(category: string): PubTexture {
  return PUB_TEXTURE[category] ?? "plain";
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

  if (style.flat) {
    // No hue at all. The block is white paper; the texture overlay drawn on
    // top of it is what says which layer type this is. `grey` categories get
    // their tint from the same map, not from here.
    const white = { fill: "#FFFFFF", opacity: 1 };
    return { front: white, top: white, side: white };
  }

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
  // Monochrome by construction: these two ignore the palette entirely.
  if (style.id === "outline" || style.flat) return "#14181D";
  return style.stroke.hued ? sw.face : sw.edge;
}
