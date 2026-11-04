"use client";

/**
 * Mind map template adapter.
 *
 * The hand-drawn map is deliberately served from the supplied `Mind Map.html`
 * file rather than reconstructed in React. Its illustrated card and arrow
 * assets are part of the design, so approximating them with SVG or CSS would
 * quietly turn this into a different visual. This adapter leaves that document
 * intact and supplies the analyzed repository's labels after the frame loads.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Moon, Sun } from "lucide-react";

interface MindmapNode {
  id?: string;
  label?: string;
  name?: string;
  path?: string;
  children?: MindmapNode[];
}

interface RadialMindmapProps {
  root: MindmapNode;
}

/**
 * The source template's centre card is `c11`; the other IDs are ordered from
 * its nearest branches outward so the repository hierarchy stays legible in
 * the fixed composition.
 */
const CARD_ORDER = [
  "c11",
  "c3",
  "c4",
  "c10",
  "c12",
  "c0",
  "c2",
  "c6",
  "c1",
  "c5",
  "c7",
  "c9",
  "c16",
  "c13",
  "c17",
  "c18",
  "c8",
  "c15",
  "c14",
  "c19",
  "c20",
  "c21",
] as const;

/** Safe text capacities for the source template's differently sized cards. */
const CARD_LABEL_LIMITS: Record<(typeof CARD_ORDER)[number], number> = {
  c11: 26,
  c3: 16,
  c4: 16,
  c10: 13,
  c12: 12,
  c0: 12,
  c2: 12,
  c6: 12,
  c1: 14,
  c5: 14,
  c7: 14,
  c9: 12,
  c16: 16,
  c13: 13,
  c17: 13,
  c18: 13,
  c8: 9,
  c15: 9,
  c14: 11,
  c19: 9,
  c20: 9,
  c21: 9,
};

const TEMPLATE_CENTER = { x: 500, y: 281 };
const NODE_SPACING_FACTOR = 1.055;

const DARK_CARD_COLORS = {
  cream: "#FAF3E1",
  sand: "#f4e4be",
  orange: "#FA8112",
} as const;

const LIGHT_CARD_COLORS = {
  darkGreen: "#0A3323",
  moss: "#839958",
  beige: "#F7F4D5",
  rosy: "#D3968C",
  midnight: "#105666",
} as const;

type MindMapTheme = "lotus" | "citrus";

const ORANGE_CARDS = new Set(["c11", "c3", "c9", "c15", "c20"]);
const SAND_CARDS = new Set(["c4", "c10", "c12", "c16", "c19"]);

function cardTintColor(cardId: string, theme: MindMapTheme): string {
  if (theme === "citrus") {
    if (ORANGE_CARDS.has(cardId)) return DARK_CARD_COLORS.orange;
    if (SAND_CARDS.has(cardId)) return DARK_CARD_COLORS.sand;
    return DARK_CARD_COLORS.cream;
  }

  if (cardId === "c11") return LIGHT_CARD_COLORS.darkGreen;
  if (ORANGE_CARDS.has(cardId)) return LIGHT_CARD_COLORS.rosy;
  if (SAND_CARDS.has(cardId)) return LIGHT_CARD_COLORS.moss;
  return LIGHT_CARD_COLORS.midnight;
}

function labelTintColor(cardId: string, theme: MindMapTheme): string {
  if (theme === "citrus") {
    return ORANGE_CARDS.has(cardId) ? DARK_CARD_COLORS.cream : "#222222";
  }
  return SAND_CARDS.has(cardId) ? LIGHT_CARD_COLORS.darkGreen : LIGHT_CARD_COLORS.beige;
}

function nodeLabel(node: MindmapNode): string {
  return node.label || node.name || node.id || "Untitled";
}

/** Breadth-first order keeps the root and its categories nearest the centre. */
function flattenTree(root: MindmapNode): MindmapNode[] {
  const result: MindmapNode[] = [];
  const queue = [root];
  const seen = new Set<MindmapNode>();

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    result.push(node);
    queue.push(...(node.children ?? []));
  }

  return result;
}

function shorten(label: string, limit: number): string {
  if (label.length <= limit) return label;
  return `${label.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

/** Shrink a label only when its source card cannot contain the wrapped text. */
function fitLabel(label: HTMLElement, card: HTMLElement): void {
  label.dataset.codekaviFontSize ??= label.style.fontSize;
  const originalFontSize = Number.parseFloat(label.dataset.codekaviFontSize) || 16;
  const cardHeight = Number.parseFloat(card.style.height) || card.clientHeight;
  const availableHeight = Math.max(20, cardHeight - 8);

  label.style.lineHeight = "1.05";
  label.style.maxHeight = `${availableHeight}px`;
  label.style.overflow = "hidden";
  label.style.overflowWrap = "anywhere";

  let fontSize = originalFontSize;
  label.style.fontSize = `${fontSize}px`;
  while (label.scrollHeight > availableHeight && fontSize > 12) {
    fontSize -= 1;
    label.style.fontSize = `${fontSize}px`;
  }
}

/**
 * Keep the original artwork, but give its cards a little more breathing room.
 * Arrows and cards move from the same centre point so their connections remain
 * aligned. This runs only once for each freshly loaded template document.
 */
function prepareTemplate(document: Document): void {
  if (document.documentElement.dataset.codekaviPrepared === "true") return;
  document.documentElement.dataset.codekaviPrepared = "true";

  // The standalone template is padded for a full browser tab. Inside the graph
  // panel that padding creates a needless nested scrollbar, so the frame owns
  // the clipping instead.
  document.documentElement.style.overflow = "hidden";
  document.body.style.padding = "0";
  document.body.style.overflow = "hidden";
  const scrollWrap = document.querySelector<HTMLElement>(".scroll-wrap");
  if (scrollWrap) {
    scrollWrap.style.padding = "0";
    scrollWrap.style.overflow = "hidden";
  }

  document.querySelectorAll<HTMLElement>(".card, .arrow").forEach((element) => {
    const left = Number.parseFloat(element.style.left);
    const top = Number.parseFloat(element.style.top);
    if (Number.isNaN(left) || Number.isNaN(top)) return;

    element.style.left = `${
      TEMPLATE_CENTER.x + (left - TEMPLATE_CENTER.x) * NODE_SPACING_FACTOR
    }px`;
    element.style.top = `${
      TEMPLATE_CENTER.y + (top - TEMPLATE_CENTER.y) * NODE_SPACING_FACTOR
    }px`;

    // Arrow bitmaps need to grow by the same small amount or their tips would
    // no longer meet the cards after the spacing adjustment.
    if (element.classList.contains("arrow")) {
      const width = Number.parseFloat(element.style.width);
      const height = Number.parseFloat(element.style.height);
      if (!Number.isNaN(width)) element.style.width = `${width * NODE_SPACING_FACTOR}px`;
      if (!Number.isNaN(height)) element.style.height = `${height * NODE_SPACING_FACTOR}px`;
    }
  });
}

/** Apply the map's local colour mode without altering the supplied artwork. */
function applyColorMode(document: Document, theme: MindMapTheme): void {
  const isDark = theme === "citrus";
  const background = theme === "citrus" ? "#222222" : LIGHT_CARD_COLORS.beige;
  document.documentElement.style.background = background;
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  document.body.style.background = background;
  document.body.style.colorScheme = isDark ? "dark" : "light";

  document.querySelectorAll<HTMLElement>(".arrow").forEach((arrow) => {
    arrow.dataset.codekaviFilter ??= arrow.style.filter;
    arrow.style.filter = theme === "citrus"
      ? "brightness(0) saturate(100%) invert(55%) sepia(86%) saturate(2500%) hue-rotate(359deg) brightness(101%) contrast(96%)"
      : "brightness(0) saturate(100%) invert(16%) sepia(52%) saturate(1251%) hue-rotate(107deg) brightness(95%) contrast(96%)";
  });
  document.querySelectorAll<HTMLElement>(".card").forEach((card) => {
    card.dataset.codekaviBackgroundImage ??= card.style.backgroundImage;
    card.dataset.codekaviBackgroundColor ??= card.style.backgroundColor;
    card.dataset.codekaviBackgroundBlendMode ??= card.style.backgroundBlendMode;
    const existingTint = card.querySelector<HTMLElement>(":scope > .codekavi-card-tint");

    {
      // A card PNG has transparent pixels around its irregular edge. Tinting
      // the card's background-color paints those pixels as a rectangle. Move
      // the source image into its own layer instead, so its alpha silhouette
      // remains unchanged while only the visible paper gets recoloured.
      card.style.backgroundImage = "none";
      card.style.backgroundColor = "transparent";
      card.style.backgroundBlendMode = "normal";

      const tint = existingTint ?? document.createElement("span");
      tint.className = "codekavi-card-tint";
      tint.setAttribute("aria-hidden", "true");
      tint.style.cssText = [
        "position:absolute",
        "inset:0",
        "pointer-events:none",
        `background-color:${cardTintColor(card.id, theme)}`,
        "-webkit-mask-size:100% 100%",
        "-webkit-mask-repeat:no-repeat",
        `-webkit-mask-image:${card.dataset.codekaviBackgroundImage}`,
        "mask-size:100% 100%",
        "mask-repeat:no-repeat",
        `mask-image:${card.dataset.codekaviBackgroundImage}`,
      ].join(";");
      if (!existingTint) card.prepend(tint);

      card.querySelectorAll<HTMLElement>(":scope > .label").forEach((label) => {
        label.dataset.codekaviPosition ??= label.style.position;
        label.dataset.codekaviZIndex ??= label.style.zIndex;
        label.style.position = "relative";
        label.style.zIndex = "1";
      });
    }
  });
  document.querySelectorAll<HTMLElement>(".label").forEach((label) => {
    label.dataset.codekaviColor ??= label.style.color;
    const cardId = label.closest(".card")?.id;
    label.style.color = labelTintColor(cardId ?? "", theme);
  });
  document.querySelectorAll<HTMLElement>(".hint").forEach((hint) => {
    hint.dataset.codekaviColor ??= hint.style.color;
    hint.style.color = theme === "citrus" ? DARK_CARD_COLORS.sand : LIGHT_CARD_COLORS.darkGreen;
  });
}

export const RadialMindmap = forwardRef<HTMLDivElement, RadialMindmapProps>(
  function RadialMindmap({ root }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [theme, setTheme] = useState<MindMapTheme>("lotus");

    useImperativeHandle(ref, () => containerRef.current!);

    const syncLabels = useCallback(() => {
      const document = frameRef.current?.contentDocument;
      if (!document) return;

      prepareTemplate(document);
      applyColorMode(document, theme);
      const nodes = flattenTree(root);
      const visibleNodeCount = CARD_ORDER.length;

      CARD_ORDER.forEach((cardId, index) => {
        const label = document.querySelector<HTMLElement>(`#${cardId} .label`);
        if (!label) return;

        const node = nodes[index];
        if (!node) {
          label.textContent = "";
          label.removeAttribute("title");
          return;
        }

        // The final card is the overflow indicator when the fixed original
        // composition cannot show every leaf. It keeps the map honest without
        // modifying its layout or its supplied artwork.
        if (index === visibleNodeCount - 1 && nodes.length > visibleNodeCount) {
          const remaining = nodes.length - (visibleNodeCount - 1);
          label.textContent = `+${remaining} more`;
          label.title = `${remaining} additional nodes in this mind map`;
          const card = document.getElementById(cardId);
          if (card) fitLabel(label, card);
          return;
        }

        const fullLabel = nodeLabel(node);
        label.textContent = shorten(fullLabel, CARD_LABEL_LIMITS[cardId]);
        label.title = node.path || fullLabel;
        const card = document.getElementById(cardId);
        if (card) fitLabel(label, card);
      });
    }, [root, theme]);

    useEffect(() => {
      if (isLoaded) syncLabels();
    }, [isLoaded, syncLabels]);

    return (
      <div
        ref={containerRef}
        className="relative h-[562px] max-h-full w-full overflow-hidden rounded-lg bg-white"
      >
        <iframe
          ref={frameRef}
          title="Codebase mind map"
          src="/api/mind-map-template"
          onLoad={() => setIsLoaded(true)}
          className="absolute inset-0 h-full w-full border-0"
        />
        <div
          role="group"
          aria-label="Mind map color theme"
          className="absolute bottom-3 right-3 z-10 flex overflow-hidden rounded-lg border border-border/70 bg-background/90 shadow-sm backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setTheme("lotus")}
            aria-label="Use the Lotus light theme"
            aria-pressed={theme === "lotus"}
            title="Lotus light theme"
            className={`flex h-9 w-9 items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
              theme === "lotus" ? "bg-foreground text-background" : "text-foreground hover:bg-muted"
            }`}
          >
            <Sun size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setTheme("citrus")}
            aria-label="Use the Citrus dark theme"
            aria-pressed={theme === "citrus"}
            title="Citrus dark theme"
            className={`flex h-9 w-9 items-center justify-center border-x border-border/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
              theme === "citrus" ? "bg-foreground text-background" : "text-foreground hover:bg-muted"
            }`}
          >
            <Moon size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  },
);
