/**
 * Colour schemes for the architecture figure.
 *
 * Each palette declares ONE base colour per layer category. The lit top face,
 * shaded side face and keyline are derived from it, which is why a new
 * palette is ~12 lines instead of ~50 and why no palette can drift out of
 * internal consistency the way hand-listed face colours do.
 *
 * Colours are literal hex, never CSS custom properties: a serialised SVG has
 * no document to resolve variables against, so a token-driven figure exports
 * as a black rectangle. See the note at the top of NeuralNetworkViz.
 */

export interface Swatch {
  face: string;
  top: string;
  side: string;
  edge: string;
}

export const CATEGORIES = [
  "convolution",
  "pooling",
  "dense",
  "normalization",
  "activation",
  "dropout",
  "recurrent",
  "attention",
  "embedding",
  "output",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<string, string> = {
  convolution: "Convolution",
  pooling: "Pooling",
  dense: "Dense",
  normalization: "Normalization",
  activation: "Activation",
  dropout: "Dropout",
  recurrent: "Recurrent",
  attention: "Attention",
  embedding: "Embedding",
  output: "Output",
  other: "Other",
};

// ── Colour maths ─────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Lighten (amount > 0) or darken (amount < 0) toward white/black.
 *
 * Mixing toward the endpoints rather than scaling channels keeps hue stable —
 * naive multiplication drives saturated colours toward grey as they darken,
 * which is what makes a hand-shaded palette look muddy on the side faces.
 */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amount > 0 ? 255 : 0;
  const p = Math.abs(amount);
  return rgbToHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p);
}

/** Relative luminance, for picking legible text on a filled chip. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Near-black or near-white, whichever holds contrast on `hex`. */
export function inkOn(hex: string): string {
  return luminance(hex) > 0.45 ? "#12161A" : "#FFFFFF";
}

export function toSwatch(base: string): Swatch {
  return {
    face: base,
    top: shade(base, 0.22),
    side: shade(base, -0.24),
    edge: shade(base, -0.52),
  };
}

// ── Palettes ─────────────────────────────────────────────────────────────

export interface Palette {
  id: string;
  label: string;
  description: string;
  base: Record<string, string>;
}

export const PALETTES: Palette[] = [
  {
    id: "scientific",
    label: "Scientific",
    description: "Balanced primaries. Safe under deuteranopia.",
    base: {
      convolution: "#4A7FC1",
      pooling: "#E0763F",
      dense: "#4E9E5F",
      normalization: "#E0A32E",
      activation: "#8055B0",
      dropout: "#7C8A96",
      recurrent: "#2A9D8F",
      attention: "#C2385C",
      embedding: "#3D4C9A",
      output: "#B0392B",
      other: "#6B7A87",
    },
  },
  {
    id: "journal",
    label: "Journal",
    description: "Muted and ink-friendly. Reads calm at figure size.",
    base: {
      convolution: "#3E6B8A",
      pooling: "#B5734A",
      dense: "#5C7F5A",
      normalization: "#B8944E",
      activation: "#6E5A86",
      dropout: "#8A8F94",
      recurrent: "#4A8079",
      attention: "#9C5568",
      embedding: "#42527A",
      output: "#95523F",
      other: "#77808A",
    },
  },
  {
    id: "vivid",
    label: "Vivid",
    description: "High saturation. Built for projected slides.",
    base: {
      convolution: "#2563EB",
      pooling: "#F97316",
      dense: "#16A34A",
      normalization: "#EAB308",
      activation: "#9333EA",
      dropout: "#64748B",
      recurrent: "#06B6D4",
      attention: "#E11D48",
      embedding: "#4F46E5",
      output: "#DC2626",
      other: "#78716C",
    },
  },
  {
    id: "pastel",
    label: "Pastel",
    description: "Soft fills with dark keylines. Gentle on white.",
    base: {
      convolution: "#93B7E3",
      pooling: "#F3B48C",
      dense: "#9BCFA6",
      normalization: "#F1D391",
      activation: "#BFA3D9",
      dropout: "#BAC3CB",
      recurrent: "#93CFC6",
      attention: "#EBA0B4",
      embedding: "#A3ACD9",
      output: "#E5A79C",
      other: "#B6BEC7",
    },
  },
  {
    id: "mono",
    label: "Monochrome",
    description: "Greyscale steps for B&W print. Pair with textures.",
    base: {
      convolution: "#3F464D",
      pooling: "#9AA2AA",
      dense: "#5C656D",
      normalization: "#B4BBC2",
      activation: "#79828A",
      dropout: "#C9CFD5",
      recurrent: "#4E565E",
      attention: "#2B3238",
      embedding: "#68717A",
      output: "#22282D",
      other: "#8C949C",
    },
  },
  {
    id: "blueprint",
    label: "Blueprint",
    description: "Single-hue cyan ramp. Depth by value, not colour.",
    base: {
      convolution: "#1E5F86",
      pooling: "#4E93B8",
      dense: "#2E7BA6",
      normalization: "#6BAECD",
      activation: "#3F8BAF",
      dropout: "#9CC5D8",
      recurrent: "#17506F",
      attention: "#0F3D57",
      embedding: "#255F80",
      output: "#0B2F44",
      other: "#7FB0C8",
    },
  },
];

export const DEFAULT_PALETTE = PALETTES[0];

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? DEFAULT_PALETTE;
}

export function swatchFor(palette: Palette, category: string): Swatch {
  return toSwatch(palette.base[category] ?? palette.base.other);
}

// ── Figure surfaces ──────────────────────────────────────────────────────

export interface Surface {
  id: string;
  label: string;
  bg: string;
  ink: string;
  inkDim: string;
  rule: string;
}

export const SURFACES: Record<
  "paper" | "black" | "slide" | "transparent",
  Surface
> = {
  paper: {
    id: "paper",
    label: "Paper",
    bg: "#FFFFFF",
    ink: "#14181D",
    inkDim: "#6B7480",
    rule: "#B8C0C9",
  },
  black: {
    id: "black",
    label: "Black",
    /*
     * Matched to the app's own dark ground, `--background: 30 9% 6%` — a
     * WARM near-black. Pure #000 sat beside it as a colder, flatter patch,
     * and two blacks in one view read as a mistake rather than a choice.
     *
     * Hardcoded rather than read from the token: a serialised SVG has no
     * document to resolve `hsl(var(--background))` against and would export
     * the canvas as nothing at all.
     */
    bg: "#110F0E",
    ink: "#F5F2EF",
    inkDim: "#9A938C",
    rule: "#3E3934",
  },
  slide: {
    id: "slide",
    label: "Slide",
    bg: "#0E1116",
    ink: "#EDF1F5",
    inkDim: "#98A3AF",
    rule: "#48525E",
  },
  transparent: {
    id: "transparent",
    label: "Transparent",
    // Painted nowhere — export passes `null` so the PNG keeps its alpha and
    // the figure drops onto any slide background.
    bg: "transparent",
    ink: "#14181D",
    inkDim: "#6B7480",
    rule: "#B8C0C9",
  },
};
