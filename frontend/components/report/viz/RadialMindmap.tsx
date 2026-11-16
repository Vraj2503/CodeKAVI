"use client";

/**
 * Mind map, drawn from the repository itself, in the original composition.
 *
 * The template's layout is kept: the repository in the middle, its branches
 * on either side in the two columns the template used, each branch trailing
 * its own files behind chunky brass-style arrows (straight for the middle
 * one, elbowed for the rest), and the bottom branch on the right dropping its
 * files into a row beneath it. What changed is that nothing is fixed any more:
 *
 *  - Only nodes that exist are drawn, so there are no empty cards.
 *  - Clicking a node with children opens or closes its branch, and the
 *    clusters re-space themselves around it.
 *  - A folder with more than 20 children shows 16, then a dashed "+N more"
 *    card that reveals the next 16.
 *  - Drag to pan, scroll to zoom, or use the buttons; the view re-fits after
 *    each change until you move it yourself.
 *
 * Colours come from a palette object, so the whole look can be changed with
 * the `palette` prop (a name from PALETTES, or your own object).
 * Lettering comes from the `font` prop (see FONTS). The component loads the
 * font itself from Google Fonts, so nothing needs setting up in the app, and the
 * fallback is a plain system face rather than a script one.
 */

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Maximize2, Minus, Plus, RotateCcw } from "lucide-react";

export interface MindmapNode {
  id?: string;
  label?: string;
  name?: string;
  path?: string;
  /** A file's sentence or purpose line, from the analysis's facts (T38). */
  description?: string;
  /** How many files an area or module holds (T38). */
  files?: number;
  children?: MindmapNode[];
}

interface Pair {
  fill: string;
  text: string;
}

export interface MindmapPalette {
  name: string;
  /** Ground. */
  bg: string;
  /** The repository card at the centre. */
  root: Pair;
  /** First ring of branches, alternating. */
  ring: [Pair, Pair];
  /** Everything further out. */
  deep: Pair;
  /** Outline drawn round every card. */
  rim: string;
  /** Arrows, badges and the "more" card. */
  arrow: string;
  /** Small helper text. */
  hint: string;
  /** Background of the zoom controls. */
  panel: string;
}

/**
 * Light palettes first, built from the product's colours (bone, brass, coffee,
 * jet, jungle, coral). Every card's text is at least 6:1 against its fill and
 * every arrow at least 3:1 against the ground.
 */
export const PALETTES: Record<string, MindmapPalette> = {
  bone: {
    name: "Bone & brass",
    bg: "#F1E6DA",
    root: { fill: "#CF9D7B", text: "#0C1519" },
    ring: [
      { fill: "#724B39", text: "#F1E6DA" },
      { fill: "#3A3534", text: "#F1E6DA" },
    ],
    deep: { fill: "#FBF7F1", text: "#0C1519" },
    rim: "rgba(58,53,52,0.5)",
    arrow: "#724B39",
    hint: "#5B4A41",
    panel: "#FBF7F1",
  },
  paper: {
    name: "Paper & ink",
    bg: "#FBF8F2",
    root: { fill: "#0C1519", text: "#F1E6DA" },
    ring: [
      { fill: "#CF9D7B", text: "#0C1519" },
      { fill: "#E5D3C0", text: "#0C1519" },
    ],
    deep: { fill: "#FFFFFF", text: "#0C1519" },
    rim: "rgba(12,21,25,0.45)",
    arrow: "#0C1519",
    hint: "#5C5750",
    panel: "#FFFFFF",
  },
  sand: {
    name: "Sand & coffee",
    bg: "#E6D5BF",
    root: { fill: "#724B39", text: "#F1E6DA" },
    ring: [
      { fill: "#CF9D7B", text: "#0C1519" },
      { fill: "#3A3534", text: "#F1E6DA" },
    ],
    deep: { fill: "#F6ECDD", text: "#0C1519" },
    rim: "rgba(58,53,52,0.5)",
    arrow: "#3A3534",
    hint: "#5B4A41",
    panel: "#F6ECDD",
  },
  sage: {
    name: "Sage",
    bg: "#E3E9DF",
    root: { fill: "#1F4D3F", text: "#F1E6DA" },
    ring: [
      { fill: "#CF9D7B", text: "#0C1519" },
      { fill: "#A9BFA9", text: "#0C1519" },
    ],
    deep: { fill: "#F5F8F2", text: "#0C1519" },
    rim: "rgba(31,77,63,0.5)",
    arrow: "#1F4D3F",
    hint: "#4C5F54",
    panel: "#F5F8F2",
  },
  mist: {
    name: "Teal mist",
    bg: "#BCCFCD",
    root: { fill: "#162127", text: "#F1E6DA" },
    ring: [
      { fill: "#CF9D7B", text: "#0C1519" },
      { fill: "#724B39", text: "#F1E6DA" },
    ],
    deep: { fill: "#E7F0EF", text: "#0C1519" },
    rim: "rgba(22,33,39,0.5)",
    arrow: "#162127",
    hint: "#2F4146",
    panel: "#E7F0EF",
  },
  coral: {
    name: "Coral & white",
    bg: "#FBF8F3",
    root: { fill: "#E0674B", text: "#0C1519" },
    ring: [
      { fill: "#3A3534", text: "#F1E6DA" },
      { fill: "#CF9D7B", text: "#0C1519" },
    ],
    deep: { fill: "#FFFFFF", text: "#0C1519" },
    rim: "rgba(58,53,52,0.45)",
    arrow: "#E0674B",
    hint: "#5B4A41",
    panel: "#FFFFFF",
  },
  night: {
    name: "Night (the dark one)",
    bg: "#0C1519",
    root: { fill: "#CF9D7B", text: "#0C1519" },
    ring: [
      { fill: "#724B39", text: "#F1E6DA" },
      { fill: "#3A3534", text: "#F1E6DA" },
    ],
    deep: { fill: "#162127", text: "#F1E6DA" },
    rim: "rgba(241,230,218,0.25)",
    arrow: "#CF9D7B",
    hint: "#A8A39D",
    panel: "#162127",
  },
};

interface RadialMindmapProps {
  root: MindmapNode;
  /** A name from PALETTES, or a palette of your own. Defaults to "bone". */
  palette?: string | MindmapPalette;
  /** A name from FONTS, or a font of your own. Defaults to "shantell". */
  font?: string | MindmapFont;
  /** Replaces the default size, which is 562px tall and full width. */
  className?: string;
}

export interface MindmapFont {
  name: string;
  /** CSS font-family, with a plain fallback. */
  family: string;
  weight: number;
  /** Average letter width as a fraction of the font size, for sizing cards. */
  width: number;
  /** Stylesheet that loads it. */
  href: string;
}

const gf = (query: string) =>
  `https://fonts.googleapis.com/css2?family=${query}&display=swap`;

export const FONTS: Record<string, MindmapFont> = {
  patrick: {
    name: "Patrick Hand",
    family: '"Patrick Hand", system-ui, sans-serif',
    weight: 400,
    width: 0.47,
    href: gf("Patrick+Hand"),
  },
  kalam: {
    name: "Kalam",
    family: '"Kalam", system-ui, sans-serif',
    weight: 700,
    width: 0.54,
    href: gf("Kalam:wght@700"),
  },
  shantell: {
    name: "Shantell Sans",
    family: '"Shantell Sans", system-ui, sans-serif',
    weight: 600,
    width: 0.56,
    href: gf("Shantell+Sans:wght@600"),
  },
  architects: {
    name: "Architects Daughter",
    family: '"Architects Daughter", system-ui, sans-serif',
    weight: 400,
    width: 0.55,
    href: gf("Architects+Daughter"),
  },
  brush: {
    name: "Caveat Brush",
    family: '"Caveat Brush", system-ui, sans-serif',
    weight: 400,
    width: 0.43,
    href: gf("Caveat+Brush"),
  },
  nunito: {
    name: "Nunito (clean, not handwritten)",
    family: '"Nunito", system-ui, sans-serif',
    weight: 800,
    width: 0.56,
    href: gf("Nunito:wght@800"),
  },
};

const AUTO_OPEN_LIMIT = 24;
const PAGE_TRIGGER = 20;
const PAGE = 16;
const DURATION = 380;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;

type Kind = "root" | "branch" | "leaf" | "more";
type Dir = "right" | "left" | "down";
type Tone = "root" | "ring0" | "ring1" | "deep" | "more";

interface Item {
  key: string;
  full: string;
  hint: string;
  depth: number;
  kind: Kind;
  tone: Tone;
  parent: Item | null;
  children: Item[];
  childCount: number;
  open: boolean;
  dir: Dir;
  x: number;
  y: number;
  w: number;
  h: number;
  fs: number;
  lines: string[];
  exp: number;
  seed: number;
  rot: number;
  path: string;
}

interface Pos {
  x: number;
  y: number;
  o: number;
}

interface Camera {
  x: number;
  y: number;
  k: number;
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nodeLabel(node: MindmapNode): string {
  return node.label || node.name || node.id || "Untitled";
}

/**
 * Hover text for a card: where the node lives, then what it is. The cards hold
 * a short label only, so this is where a file's sentence shows.
 */
export function nodeTitle(node: MindmapNode): string {
  const where = node.path || nodeLabel(node);
  const what =
    node.description ??
    (node.files ? `${node.files} file${node.files === 1 ? "" : "s"}` : "");
  return what ? `${where}
${what}` : where;
}

/** Two lines at most, broken at a separator near the middle. */
function breakLabel(label: string, max: number): string[] {
  const clip = (s: string) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  if (label.length <= max) return [label];

  const middle = label.length / 2;
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 1; i < label.length - 1; i++) {
    if (/[\s/_\-.]/.test(label[i])) {
      const distance = Math.abs(i - middle);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
  }
  if (best < 0) return [clip(label)];

  const isSpace = label[best] === " ";
  const first = isSpace ? label.slice(0, best) : label.slice(0, best + 1);
  return [clip(first.trim()), clip(label.slice(best + 1).trim())];
}

/**
 * Which branches start open: a whole level at a time, so siblings are treated
 * alike, for as long as the map stays comfortably small. The root always opens.
 */
function initialExpanded(root: MindmapNode): Set<string> {
  const open = new Set<string>();
  let visible = 1;
  let frontier: { node: MindmapNode; key: string }[] = [{ node: root, key: "r" }];

  while (frontier.length > 0) {
    const parents = frontier.filter((f) => (f.node.children ?? []).length > 0);
    if (parents.length === 0) break;

    const shownOf = (n: MindmapNode) => {
      const count = (n.children ?? []).length;
      return count > PAGE_TRIGGER ? PAGE + 1 : count;
    };
    const added = parents.reduce((sum, f) => sum + shownOf(f.node), 0);
    if (frontier[0].key !== "r" && visible + added > AUTO_OPEN_LIMIT) break;

    const next: { node: MindmapNode; key: string }[] = [];
    for (const { node, key } of parents) {
      open.add(key);
      (node.children ?? []).slice(0, shownOf(node)).forEach((kid, i) => {
        next.push({ node: kid, key: `${key}.${i}` });
      });
    }
    visible += added;
    frontier = next;
  }
  return open;
}

function build(
  root: MindmapNode,
  expanded: Set<string>,
  limits: Record<string, number>,
  charW: number,
): Item {
  const make = (
    node: MindmapNode | null,
    key: string,
    depth: number,
    parent: Item | null,
    index: number,
    more?: string,
  ): Item => {
    const kids = node?.children ?? [];
    const kind: Kind = more
      ? "more"
      : depth === 0
        ? "root"
        : kids.length > 0
          ? "branch"
          : "leaf";
    const full = more ?? nodeLabel(node as MindmapNode);
    const seed = hashString(key);
    const rand = seeded(seed);

    const fs = depth === 0 ? 28 : depth === 1 ? 22 : 20;
    const lines = breakLabel(full, depth === 0 ? 18 : 13);
    const longest = Math.max(...lines.map((l) => l.length));
    let w = longest * fs * charW + (depth === 0 ? 60 : 42);
    let h = lines.length * fs * 1.1 + (depth === 0 ? 40 : 30);
    if (kind === "root" || kind === "branch") {
      h = Math.max(h, depth === 0 ? 84 : 72);
      w = Math.max(w, h * 1.15);
    } else {
      w = Math.max(w, 100);
      h = Math.max(h, 54);
    }

    const tone: Tone =
      kind === "root"
        ? "root"
        : kind === "more"
          ? "more"
          : depth === 1
            ? index % 2 === 0
              ? "ring0"
              : "ring1"
            : "deep";

    const item: Item = {
      key,
      full,
      hint: node ? nodeTitle(node) : full,
      depth,
      kind,
      tone,
      parent,
      children: [],
      childCount: kids.length,
      open: expanded.has(key) && kids.length > 0,
      dir: "right",
      x: 0,
      y: 0,
      w,
      h,
      fs,
      lines,
      exp: kind === "root" ? 6 : kind === "branch" ? 5 : seed % 3 === 0 ? 2 : 6,
      seed,
      rot: (rand() - 0.5) * 3,
      path: "",
    };

    if (item.open) {
      const limit =
        limits[key] ?? (kids.length > PAGE_TRIGGER ? PAGE : kids.length);
      item.children = kids
        .slice(0, limit)
        .map((kid, i) => make(kid, `${key}.${i}`, depth + 1, item, i));
      if (kids.length > limit) {
        item.children.push(
          make(null, `${key}:more`, depth + 1, item, limit, `+${kids.length - limit} more`),
        );
      }
    }
    return item;
  };

  return make(root, "r", 0, null, 0);
}

const horizontal = (d: Dir) => d !== "down";
const mainOf = (n: Item, d: Dir) => (horizontal(d) ? n.w : n.h);
const crossOf = (n: Item, d: Dir) => (horizontal(d) ? n.h : n.w);
const sibGap = (d: Dir) => (horizontal(d) ? 20 : 28);
const armGap = (d: Dir) => (horizontal(d) ? 112 : 80);

/** How much room a branch needs across its direction of travel. */
function extent(n: Item, d: Dir): number {
  const own = crossOf(n, d);
  if (n.children.length === 0) return own;
  const sum =
    n.children.reduce((s, c) => s + extent(c, d), 0) +
    (n.children.length - 1) * sibGap(d);
  return Math.max(own, sum);
}

/** How far a branch reaches along its direction of travel. */
function reach(n: Item, d: Dir): number {
  if (n.children.length === 0) return mainOf(n, d);
  return mainOf(n, d) + armGap(d) + Math.max(...n.children.map((c) => reach(c, d)));
}

/** Lay a branch's children out in a column (or a row) heading away from it. */
function place(n: Item, d: Dir): void {
  if (n.children.length === 0) return;
  const total =
    n.children.reduce((s, c) => s + extent(c, d), 0) +
    (n.children.length - 1) * sibGap(d);
  let cursor = -total / 2;

  for (const c of n.children) {
    const e = extent(c, d);
    const cross = cursor + e / 2;
    const main = mainOf(n, d) / 2 + armGap(d) + mainOf(c, d) / 2;
    if (d === "right") {
      c.x = n.x + main;
      c.y = n.y + cross;
    } else if (d === "left") {
      c.x = n.x - main;
      c.y = n.y + cross;
    } else {
      c.x = n.x + cross;
      c.y = n.y + main;
    }
    c.dir = d;
    place(c, d);
    cursor += e + sibGap(d);
  }
}

/**
 * The template's composition: root in the middle, branches stacked down the
 * right side then up the left (so they read clockwise), each with its files
 * trailing outward. The last branch on a crowded right side drops its files
 * below it as a row, as the template's bottom-right cluster does.
 */
function layout(root: Item): Item[] {
  root.x = 0;
  root.y = 0;
  const kids = root.children;
  const rightCount = Math.ceil(kids.length / 2);
  const right = kids.slice(0, rightCount);
  const left = kids.slice(rightCount).reverse();

  const arrange = (list: Item[], sign: 1 | -1) => {
    if (list.length === 0) return;
    const dirs: Dir[] = list.map(() => (sign === 1 ? "right" : "left"));
    const last = list.length - 1;
    const lastBranch = list[last];
    if (
      sign === 1 &&
      list.length >= 3 &&
      lastBranch.children.length >= 2 &&
      lastBranch.children.every((c) => c.children.length === 0)
    ) {
      dirs[last] = "down";
    }

    const heights = list.map((b, i) =>
      dirs[i] === "down" ? reach(b, "down") : extent(b, dirs[i]),
    );
    const gap = 26;
    const total = heights.reduce((s, v) => s + v, 0) + (list.length - 1) * gap;
    const ymax = Math.max(1, total / 2);
    let top = -total / 2;

    list.forEach((b, i) => {
      b.dir = dirs[i];
      b.y = dirs[i] === "down" ? top + b.h / 2 : top + heights[i] / 2;
      const t = Math.min(1, Math.abs(b.y) / ymax);
      const bulge = 56 * (1 - t * t);
      b.x = sign * (root.w / 2 + 132 + b.w / 2 + bulge);
      place(b, dirs[i]);
      top += heights[i] + gap;
    });
  };
  arrange(right, 1);
  arrange(left, -1);

  const all: Item[] = [];
  const walk = (item: Item) => {
    all.push(item);
    item.children.forEach(walk);
  };
  walk(root);
  all.forEach((item) => (item.path = shapePath(item)));
  return all;
}

/** A slightly wobbly squircle or ellipse, as a smooth closed curve. */
function shapePath(item: Item): string {
  const a = item.w / 2;
  const b = item.h / 2;
  const p = item.exp;
  const rand = seeded(item.seed ^ 0x9e3779b9);
  const N = 36;
  const pts: [number, number][] = [];

  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = Math.pow(
      Math.pow(Math.abs(Math.cos(t)) / a, p) + Math.pow(Math.abs(Math.sin(t)) / b, p),
      -1 / p,
    );
    const wobble = 1 + (rand() - 0.5) * 0.035;
    pts.push([
      Math.cos(t) * r * wobble + (rand() - 0.5) * 1.2,
      Math.sin(t) * r * wobble + (rand() - 0.5) * 1.2,
    ]);
  }

  const f = (n: number) => n.toFixed(1);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % N];
    const p3 = pts[(i + 2) % N];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(
      p2[0] - (p3[0] - p1[0]) / 6,
    )} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/** Distance from a card's centre to its outline, in a given direction. */
function boundary(item: Item, phi: number): number {
  const a = item.w / 2;
  const b = item.h / 2;
  const p = item.exp;
  return Math.pow(
    Math.pow(Math.abs(Math.cos(phi)) / a, p) + Math.pow(Math.abs(Math.sin(phi)) / b, p),
    -1 / p,
  );
}

const f1 = (n: number) => n.toFixed(1);

/**
 * The arrow from a parent to a child. The middle child of a column gets a
 * straight arrow; the others leave the parent, turn, and run into their card
 * with a rounded elbow, as in the template.
 */
function edgePath(parent: Item, child: Item, pa: Pos, pb: Pos): string | null {
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;

  if (parent.depth > 0 && horizontal(child.dir) && Math.abs(dy) > 10) {
    const vx = child.dir === "right" ? 1 : -1;
    const s = Math.sign(dy);
    const x0 = pa.x + vx * (parent.w / 2 + 6);
    const y0 = pa.y + s * Math.min(parent.h * 0.22, Math.abs(dy) * 0.4);
    const x1 = pb.x - vx * (child.w / 2 + 14);
    const run = (x1 - x0) * vx;
    const xm = x0 + vx * Math.min(36, run * 0.4);
    const r = Math.min(18, Math.abs(pb.y - y0) / 2 - 1, Math.abs(xm - x0), run * 0.3);
    if (run > 40 && r > 4) {
      return (
        `M${f1(x0)} ${f1(y0)}L${f1(xm - vx * r)} ${f1(y0)}` +
        `Q${f1(xm)} ${f1(y0)} ${f1(xm)} ${f1(y0 + s * r)}` +
        `L${f1(xm)} ${f1(pb.y - s * r)}` +
        `Q${f1(xm)} ${f1(pb.y)} ${f1(xm + vx * r)} ${f1(pb.y)}` +
        `L${f1(x1)} ${f1(pb.y)}`
      );
    }
  }

  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const phi = Math.atan2(dy, dx);
  const start = boundary(parent, phi) + 8;
  const end = boundary(child, phi + Math.PI) + 14;
  if (length < start + end + 10) return null;

  const x1 = pa.x + ux * start;
  const y1 = pa.y + uy * start;
  const x2 = pb.x - ux * end;
  const y2 = pb.y - uy * end;
  const bend = (child.seed & 1 ? 1 : -1) * Math.min(5, length * 0.03);
  const mx = (x1 + x2) / 2 - uy * bend;
  const my = (y1 + y2) / 2 + ux * bend;
  return `M${f1(x1)} ${f1(y1)}Q${f1(mx)} ${f1(my)} ${f1(x2)} ${f1(y2)}`;
}

function fit(items: Item[], size: { w: number; h: number }): Camera {
  if (!size.w || !size.h || items.length === 0) return { x: 0, y: 0, k: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of items) {
    minX = Math.min(minX, n.x - n.w / 2);
    maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2);
    maxY = Math.max(maxY, n.y + n.h / 2);
  }
  const bw = maxX - minX + 110;
  const bh = maxY - minY + 110;
  const k = Math.max(MIN_ZOOM, Math.min(size.w / bw, size.h / bh, 1.1));
  return {
    k,
    x: size.w / 2 - ((minX + maxX) / 2) * k,
    y: size.h / 2 - ((minY + maxY) / 2) * k,
  };
}

function zoomAt(c: Camera, px: number, py: number, factor: number): Camera {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.k * factor));
  const r = k / c.k;
  return { k, x: px - (px - c.x) * r, y: py - (py - c.y) * r };
}

export const RadialMindmap = forwardRef<HTMLDivElement, RadialMindmapProps>(
  function RadialMindmap({ root, palette, font, className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => containerRef.current!);
    const markerId = `mm-arrow-${useId().replace(/:/g, "")}`;

    const colors: MindmapPalette =
      typeof palette === "object" && palette
        ? palette
        : PALETTES[palette ?? "bone"] ?? PALETTES.bone;

    const face: MindmapFont =
      typeof font === "object" && font ? font : FONTS[font ?? "shantell"] ?? FONTS.shantell;

    // Load the font once; harmless if the app already has it.
    useEffect(() => {
      const id = `mm-font-${face.name.replace(/\W+/g, "-")}`;
      if (document.getElementById(id)) return;
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = face.href;
      document.head.appendChild(link);
    }, [face]);

    const [expanded, setExpanded] = useState(() => initialExpanded(root));
    const [limits, setLimits] = useState<Record<string, number>>({});
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [cam, setCam] = useState<Camera>({ x: 0, y: 0, k: 1 });
    const [pos, setPos] = useState<Map<string, Pos>>(new Map());
    const [focused, setFocused] = useState<string | null>(null);

    const moved = useRef(false);
    /** The branch just opened: if the whole map is too small to read, zoom to it. */
    const focus = useRef<string | null>(null);
    const camRef = useRef(cam);
    const posRef = useRef(pos);
    camRef.current = cam;
    posRef.current = pos;

    // A different repository starts from its own default view.
    const first = useRef(true);
    useEffect(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      setExpanded(initialExpanded(root));
      setLimits({});
      moved.current = false;
    }, [root]);

    const items = useMemo(
      () => layout(build(root, expanded, limits, face.width)),
      [root, expanded, limits, face.width],
    );

    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const observer = new ResizeObserver(([entry]) => {
        setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    // Wheel zoom needs a non-passive listener to keep the page from scrolling.
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        moved.current = true;
        const box = el.getBoundingClientRect();
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;
        setCam((c) => zoomAt(c, px, py, Math.exp(-event.deltaY * 0.0015)));
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, []);

    // Move nodes and camera to the new layout. New nodes grow out of their
    // parent; nodes that were already there slide to their new place.
    useEffect(() => {
      if (!size.w) return;
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const before = posRef.current;
      const camFrom = camRef.current;
      const initial = before.size === 0;

      let camTo = camFrom;
      if (!moved.current) {
        camTo = fit(items, size);
        const target = focus.current
          ? items.find((i) => i.key === focus.current)
          : undefined;
        if (target && camTo.k < 0.5) {
          const group: Item[] = [];
          const gather = (n: Item) => {
            group.push(n);
            n.children.forEach(gather);
          };
          gather(target);
          camTo = fit(group, size);
        }
      }
      focus.current = null;

      const targets = new Map(items.map((i) => [i.key, { x: i.x, y: i.y }]));
      const starts = new Map<string, Pos>(
        items.map((i) => {
          const prev = before.get(i.key);
          const parent = i.parent ? before.get(i.parent.key) : undefined;
          const start: Pos =
            prev ??
            (parent
              ? { x: parent.x, y: parent.y, o: 0 }
              : { x: i.x, y: i.y, o: 1 });
          return [i.key, start];
        }),
      );

      const apply = (e: number) => {
        const next = new Map<string, Pos>();
        targets.forEach((t, key) => {
          const s = starts.get(key) as Pos;
          next.set(key, {
            x: s.x + (t.x - s.x) * e,
            y: s.y + (t.y - s.y) * e,
            o: s.o + (1 - s.o) * e,
          });
        });
        setPos(next);
        setCam({
          x: camFrom.x + (camTo.x - camFrom.x) * e,
          y: camFrom.y + (camTo.y - camFrom.y) * e,
          k: camFrom.k + (camTo.k - camFrom.k) * e,
        });
      };

      if (calm || initial) {
        apply(1);
        return;
      }

      const t0 = performance.now();
      let raf = 0;
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / DURATION);
        apply(1 - Math.pow(1 - t, 3));
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [items, size]);

    const activate = (item: Item) => {
      if (item.kind === "more") {
        const key = (item.parent as Item).key;
        focus.current = key;
        setLimits((l) => ({ ...l, [key]: (l[key] ?? PAGE) + PAGE }));
        return;
      }
      if (item.childCount === 0) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(item.key)) next.delete(item.key);
        else {
          next.add(item.key);
          focus.current = item.key;
        }
        return next;
      });
    };

    const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
    const onDown = (event: ReactPointerEvent<SVGSVGElement>) => {
      if ((event.target as Element).closest("[data-node]")) return;
      drag.current = { x: event.clientX, y: event.clientY, cx: cam.x, cy: cam.y };
      event.currentTarget.setPointerCapture(event.pointerId);
    };
    const onMove = (event: ReactPointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (!d) return;
      moved.current = true;
      setCam((c) => ({ ...c, x: d.cx + event.clientX - d.x, y: d.cy + event.clientY - d.y }));
    };
    const onUp = () => {
      drag.current = null;
    };

    const zoomBy = (factor: number) => {
      moved.current = true;
      setCam((c) => zoomAt(c, size.w / 2, size.h / 2, factor));
    };
    const refit = () => {
      moved.current = false;
      setCam(fit(items, size));
    };
    const reset = () => {
      setExpanded(initialExpanded(root));
      setLimits({});
      moved.current = false;
    };

    const pair = (tone: Tone): Pair => {
      if (tone === "root") return colors.root;
      if (tone === "ring0") return colors.ring[0];
      if (tone === "ring1") return colors.ring[1];
      if (tone === "more") return { fill: "transparent", text: colors.arrow };
      return colors.deep;
    };

    const controlStyle = { color: colors.hint } as const;
    const controlClass =
      "flex h-9 w-9 items-center justify-center bg-transparent transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset";

    return (
      <div
        ref={containerRef}
        className={
          className ?? "relative h-[562px] max-h-full w-full overflow-hidden rounded-lg"
        }
        style={{ background: colors.bg, position: "relative", overflow: "hidden" }}
      >
        <svg
          width="100%"
          height="100%"
          role="group"
          aria-label="Codebase mind map. Select a node with children to open or close its branch."
          className="absolute inset-0 touch-none select-none"
          style={{ cursor: "grab" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <defs>
            <marker
              id={markerId}
              markerWidth="24"
              markerHeight="24"
              refX="20"
              refY="12"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d="M2 2.5 L21 12 L2 21.5 Z"
                fill={colors.arrow}
                stroke={colors.arrow}
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </marker>
          </defs>

          <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
            {items.map((item) => {
              if (!item.parent) return null;
              const pa = pos.get(item.parent.key);
              const pb = pos.get(item.key);
              if (!pa || !pb) return null;
              const d = edgePath(item.parent, item, pa, pb);
              if (!d) return null;
              return (
                <path
                  key={`e-${item.key}`}
                  d={d}
                  fill="none"
                  stroke={colors.arrow}
                  strokeWidth={item.depth <= 1 ? 7 : 5.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={pb.o}
                  markerEnd={`url(#${markerId})`}
                />
              );
            })}

            {items.map((item) => {
              const p = pos.get(item.key);
              if (!p) return null;

              const tone = pair(item.tone);
              const interactive = item.childCount > 0 || item.kind === "more";
              const lineHeight = item.fs * 1.08;
              const badge = item.open ? "−" : `+${item.childCount}`;
              const badgeWidth = item.open ? 22 : 14 + badge.length * 7.5;
              const label = interactive
                ? item.kind === "more"
                  ? `Show more in ${(item.parent as Item).full}`
                  : `${item.full}, ${item.childCount} items, ${item.open ? "open" : "closed"}`
                : item.full;

              return (
                <g
                  key={item.key}
                  data-node
                  transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${item.rot.toFixed(2)})`}
                  opacity={p.o}
                  role={interactive ? "button" : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  aria-expanded={item.childCount > 0 ? item.open : undefined}
                  aria-label={label}
                  style={{ cursor: interactive ? "pointer" : "default", outline: "none" }}
                  onClick={() => activate(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      activate(item);
                    }
                  }}
                  onFocus={() => setFocused(item.key)}
                  onBlur={() => setFocused((k) => (k === item.key ? null : k))}
                >
                  <title>{item.hint}</title>
                  <path
                    d={item.path}
                    fill={tone.fill}
                    stroke={item.kind === "more" ? colors.arrow : colors.rim}
                    strokeWidth={2.5}
                    strokeDasharray={item.kind === "more" ? "7 6" : undefined}
                  />
                  {focused === item.key && (
                    <path
                      d={item.path}
                      fill="none"
                      stroke={colors.arrow}
                      strokeWidth={3}
                      strokeDasharray="5 4"
                      transform="scale(1.1)"
                    />
                  )}
                  <text
                    textAnchor="middle"
                    fontFamily={face.family}
                    fontSize={item.fs}
                    fontWeight={face.weight}
                    fill={tone.text}
                    pointerEvents="none"
                  >
                    {item.lines.map((line, i) => (
                      <tspan
                        key={i}
                        x={0}
                        y={-((item.lines.length - 1) * lineHeight) / 2 + i * lineHeight + item.fs * 0.32}
                      >
                        {line}
                      </tspan>
                    ))}
                  </text>

                  {item.childCount > 0 && (
                    <g
                      transform={`translate(${item.w / 2 - 8} ${item.h / 2 - 4})`}
                      pointerEvents="none"
                    >
                      <rect
                        x={-badgeWidth / 2}
                        y={-10}
                        width={badgeWidth}
                        height={20}
                        rx={10}
                        fill={colors.arrow}
                        stroke={colors.bg}
                        strokeWidth={2}
                      />
                      <text
                        textAnchor="middle"
                        y={4.5}
                        fontSize={12}
                        fontWeight={700}
                        fill={colors.bg}
                        style={{ fontFamily: "system-ui, sans-serif" }}
                      >
                        {badge}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        <p
          data-export-ignore="true"
          className="pointer-events-none absolute bottom-3 left-4 m-0 font-mono text-[11px]"
          style={{ color: colors.hint }}
        >
          click a node to branch it · drag to pan · scroll to zoom
        </p>

        <div
          data-export-ignore="true"
          role="group"
          aria-label="Mind map view"
          className="absolute bottom-3 right-3 z-10 flex overflow-hidden rounded-lg border shadow-sm"
          style={{ background: colors.panel, borderColor: colors.rim }}
        >
          <button type="button" className={controlClass} style={controlStyle} onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" className={controlClass} style={controlStyle} onClick={() => zoomBy(0.8)} aria-label="Zoom out" title="Zoom out">
            <Minus size={16} aria-hidden="true" />
          </button>
          <button type="button" className={controlClass} style={controlStyle} onClick={refit} aria-label="Fit to view" title="Fit to view">
            <Maximize2 size={16} aria-hidden="true" />
          </button>
          <button type="button" className={controlClass} style={controlStyle} onClick={reset} aria-label="Reset branches" title="Reset branches">
            <RotateCcw size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  },
);