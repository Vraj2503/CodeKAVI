"use client";

import { forwardRef, useMemo, useRef } from "react";
import type { NNModel } from "@/lib/api";
import { buildFigure, type FigureNode } from "@/lib/viz/nnLayout";
import {
  CATEGORY_LABEL,
  inkOn,
  swatchFor,
  toSwatch,
  type Palette,
  type Surface,
} from "@/lib/viz/palettes";
import {
  resolveFaces,
  resolveStroke,
  textureFor,
  DEFAULT_STYLE,
  type FigureStyle,
} from "@/lib/viz/styles";

/*
 * The figure itself. One renderer, shared by the read-only view and the
 * editor's live preview — a second draw path would drift, and then an
 * exported figure would stop matching what was edited.
 *
 * Everything here is literal: hex colours, named font stacks with real
 * fallbacks, no CSS custom properties. A serialised SVG has no document to
 * inherit from, so anything token-driven exports blank.
 */

const FONT_SANS =
  "'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const FONT_MONO = "'IBM Plex Mono', 'SF Mono', Menlo, Consolas, monospace";
/** Publication figures are set in serif; `serif` alone exports unpredictably. */
const FONT_SERIF = "'Times New Roman', Times, 'Liberation Serif', serif";

/**
 * Largest serif size at which `text` still fits inside a block when set
 * rotated −90°: it runs along the block's HEIGHT and its glyphs are as tall
 * as the block is WIDE. A thin pooling layer therefore gets small type
 * instead of spilling out both sides.
 */
function fitRotated(text: string, w: number, h: number): number {
  return Math.max(
    7,
    Math.min(19, w * 0.6, h / Math.max(text.length * 0.56, 1)),
  );
}

/** Curly brace spanning x1…x2, opening upward toward the block above it. */
function bracePath(x1: number, x2: number, y: number, r: number): string {
  const mid = (x1 + x2) / 2;
  return [
    `M ${x1} ${y}`,
    `q 0 ${r}, ${r} ${r}`,
    `H ${mid - r}`,
    `q ${r} 0, ${r} ${r}`,
    `q 0 ${-r}, ${r} ${-r}`,
    `H ${x2 - r}`,
    `q ${r} 0, ${r} ${-r}`,
  ].join(" ");
}

export interface FigureCanvasProps {
  model: NNModel;
  palette: Palette;
  surface: Surface;
  style?: FigureStyle;
  offsets?: Record<string, { dx: number; dy: number }>;
  colors?: Record<string, string>;
  /** Unique per mounted canvas — scopes marker and pattern ids. */
  uid: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Enables pointer-dragging of blocks; reports a delta in figure units. */
  onNodeDrag?: (id: string, dx: number, dy: number) => void;
  onHoverNode?: (e: React.MouseEvent, node: FigureNode) => void;
  onLeaveNode?: () => void;
  showHeader?: boolean;
  showLegend?: boolean;
  /**
   * Caption fields for the flat publication figure. A paper numbers its
   * plates in its own order and rarely calls one by the model's internal
   * name, so both halves of `Figure N: Title.` are the author's to set.
   */
  figureNumber?: string;
  figureLabel?: string;
  /**
   * Available width in CSS px. When the figure is wider, it is scaled down to
   * fit instead of overflowing.
   *
   * The viewBox keeps the intrinsic size, so this is a uniform visual scale —
   * no reflow, and `exportFigure` still reads the full-resolution geometry
   * off the viewBox rather than the shrunken width attribute.
   */
  fitWidth?: number;
  /**
   * Lower bound on the fit scale. Defaults to 0.45 so an interactive canvas
   * cannot shrink itself into an unreadable ribbon as blocks are added — but
   * a thumbnail deliberately wants to go smaller, and without an override it
   * would overflow its frame and be clipped instead.
   */
  minFit?: number;
  /**
   * Ground pattern drawn behind the figure.
   *
   * Rendered INSIDE the svg rather than as a CSS background on the wrapper,
   * so it survives serialisation — a CSS ground would look right on screen
   * and vanish from every exported file.
   */
  ground?: "plain" | "grid" | "dots";
}

export const FigureCanvas = forwardRef<SVGSVGElement, FigureCanvasProps>(
  function FigureCanvas(
    {
      model,
      palette,
      surface,
      style = DEFAULT_STYLE,
      offsets,
      colors,
      uid,
      selectedId,
      onSelect,
      onNodeDrag,
      onHoverNode,
      onLeaveNode,
      showHeader = true,
      showLegend = true,
      figureNumber = "1",
      figureLabel,
      fitWidth,
      minFit = 0.45,
      ground = "plain",
    },
    ref,
  ) {
    const innerRef = useRef<SVGSVGElement | null>(null);
    const setRefs = (el: SVGSVGElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref)
        (ref as React.MutableRefObject<SVGSVGElement | null>).current = el;
    };
    const figure = useMemo(
      () => buildFigure(model, { offsets, colors, flat: style.flat }),
      [model, offsets, colors, style.flat],
    );

    /*
     * Drag maps client pixels into figure units through the SVG's own CTM.
     * Using raw clientX deltas would drift the moment the figure is scaled to
     * fit its pane — the block would lag or outrun the cursor.
     */
    const dragRef = useRef<{ id: string; x: number; y: number } | null>(null);
    const toFigureUnits = (dxPx: number, dyPx: number) => {
      const svg = innerRef.current;
      const ctm = svg?.getScreenCTM();
      if (!ctm) return { dx: dxPx, dy: dyPx };
      return { dx: dxPx / ctm.a, dy: dyPx / ctm.d };
    };

    const flat = !!style.flat;
    // Flat drops the top-left title block entirely — a paper figure is
    // identified by the caption under it, not by a heading over it.
    const HEADER_H = showHeader && !flat ? 72 : 24;
    const CAPTION_H = showHeader && flat ? 42 : 0;
    const hasLegend = showLegend && figure.categories.length > 0;
    const LEGEND_H = hasLegend ? 58 : 16;
    const totalH = figure.height + HEADER_H + LEGEND_H + CAPTION_H;
    /*
     * Fit-to-width, but FLOORED.
     *
     * An unclamped fit shrinks the whole figure every time a block is added,
     * so a 20-layer model ends up as an unreadable ribbon. Below MIN_FIT the
     * scaling stops and the pane scrolls instead — blocks keep a legible size
     * and you pan, which is how any real canvas behaves.
     */
    const fit =
      fitWidth && fitWidth > 0 && figure.width > fitWidth
        ? Math.max(minFit, fitWidth / figure.width)
        : 1;

    return (
      <svg
        ref={setRefs}
        width={figure.width * fit}
        height={totalH * fit}
        viewBox={`0 0 ${figure.width} ${totalH}`}
        /* The legend is a reading aid for the app, not part of the plate: it
           is stripped on export, and its band comes off the height with it. */
        data-export-trim={hasLegend ? LEGEND_H : 0}
        /* No `minWidth: 100%`. Stretching the element past its viewBox makes
           preserveAspectRatio letterbox the drawing, which shrinks every
           block and pads the canvas with dead white. */
        style={{
          display: "block",
          background: surface.bg === "transparent" ? undefined : surface.bg,
        }}
      >
        <defs>
          {/* Colour alone cannot carry layer type — the figure has to survive
              a greyscale print and a colour-blind reader. Dropout gets a
              hatch, and a stochastic mask drawn as a hatch is the one texture
              here that actually means something. */}
          <pattern
            id={`hatch-${uid}`}
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              stroke="#FFFFFF"
              strokeOpacity="0.4"
              strokeWidth="2.5"
            />
          </pattern>

          {/* Publication textures. With no colour to spend, layer type is
              carried by fill pattern — the one encoding that survives both a
              greyscale printer and a colour-blind reader. Stroked in ink at
              half opacity so the rotated layer name stays readable over it. */}
          {flat && (
            <>
              <pattern
                id={`pub-hatch-${uid}`}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="6"
                  stroke={surface.ink}
                  strokeOpacity="0.5"
                  strokeWidth="0.9"
                />
              </pattern>
              <pattern
                id={`pub-cross-${uid}`}
                width="7"
                height="7"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <path
                  d="M0 0 V7 M0 0 H7"
                  stroke={surface.ink}
                  strokeOpacity="0.5"
                  strokeWidth="0.9"
                  fill="none"
                />
              </pattern>
              <pattern
                id={`pub-lines-${uid}`}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="6"
                  y2="0"
                  stroke={surface.ink}
                  strokeOpacity="0.5"
                  strokeWidth="0.9"
                />
              </pattern>
            </>
          )}

          {/* Per-category gradients. Declared only when the style asks for
              them, so `3d` exports with no gradient stops at all. */}
          {style.face.gradient &&
            figure.categories.map((cat) => {
              const c = swatchFor(palette, cat);
              const f = resolveFaces(style, c);
              return (
                <linearGradient
                  key={cat}
                  id={`grad-${uid}-${cat}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="0%"
                    stopColor={c.top}
                    stopOpacity={f.front.opacity}
                  />
                  <stop
                    offset="55%"
                    stopColor={f.front.fill}
                    stopOpacity={f.front.opacity}
                  />
                  <stop
                    offset="100%"
                    stopColor={c.side}
                    stopOpacity={f.front.opacity}
                  />
                </linearGradient>
              );
            })}

          {style.face.gloss && (
            <linearGradient id={`gloss-${uid}`} x1="0" y1="0" x2="0.35" y2="1">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.34" />
              <stop offset="42%" stopColor="#FFFFFF" stopOpacity="0.06" />
              <stop offset="43%" stopColor="#FFFFFF" stopOpacity="0" />
            </linearGradient>
          )}

          {/* Emissive halo. Two blurred copies merged under the source keeps
              the core stroke crisp while the bloom stays soft. */}
          {style.stroke.glow && (
            <filter
              id={`glow-${uid}`}
              x="-60%"
              y="-60%"
              width="220%"
              height="220%"
            >
              <feGaussianBlur stdDeviation="5" result="b1" />
              <feGaussianBlur stdDeviation="12" result="b2" />
              <feMerge>
                <feMergeNode in="b2" />
                <feMergeNode in="b1" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}

          {style.shadow !== "none" && (
            <filter
              id={`shadow-${uid}`}
              x="-40%"
              y="-40%"
              width="200%"
              height="200%"
            >
              <feDropShadow
                dx="0"
                dy={style.shadow === "deep" ? 18 : 8}
                stdDeviation={style.shadow === "deep" ? 18 : 9}
                floodColor="#000000"
                floodOpacity={style.shadow === "deep" ? 0.45 : 0.2}
              />
            </filter>
          )}

          {ground === "grid" && (
            <pattern
              id={`ground-${uid}`}
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M24 0H0v24"
                fill="none"
                stroke={surface.inkDim}
                strokeOpacity="0.16"
                strokeWidth="1"
              />
            </pattern>
          )}
          {ground === "dots" && (
            <pattern
              id={`ground-${uid}`}
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <circle
                cx="2"
                cy="2"
                r="1.1"
                fill={surface.inkDim}
                fillOpacity="0.34"
              />
            </pattern>
          )}

          <marker
            id={`arrow-${uid}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            {/* Flat arrowheads are solid black in the mockup, and paper's
                `inkDim` is a grey that reads as a printing fault. */}
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              fill={flat ? surface.ink : surface.inkDim}
            />
          </marker>
          <marker
            id={`arrow-skip-${uid}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              fill={flat ? surface.ink : surface.rule}
            />
          </marker>
        </defs>

        {/* Ground is canvas furniture — it orients you while you drag blocks.
            An exported figure sits on a page that has its own ground. */}
        {ground !== "plain" && (
          <rect
            data-export-hide
            width="100%"
            height="100%"
            fill={`url(#ground-${uid})`}
          />
        )}

        {showHeader && !flat && (
          <>
            <text
              x={30}
              y={34}
              fontFamily={FONT_SANS}
              fontSize={21}
              fontWeight={700}
              fill={surface.ink}
            >
              {figure.title}
            </text>
            <text
              x={30}
              y={56}
              fontFamily={FONT_MONO}
              fontSize={13}
              fill={surface.inkDim}
            >
              {figure.meta}
            </text>
          </>
        )}

        <g transform={`translate(0, ${HEADER_H})`}>
          {/* Connectors first so blocks always occlude them */}
          {figure.edges.map((e) => (
            <g key={e.key}>
              <path
                d={e.path}
                fill="none"
                stroke={
                  flat
                    ? surface.ink
                    : e.kind === "skip"
                      ? surface.rule
                      : surface.inkDim
                }
                strokeWidth={e.kind === "skip" ? 1.8 : 2.2}
                strokeDasharray={!flat && e.kind === "skip" ? "6 5" : undefined}
                markerEnd={
                  e.kind === "skip"
                    ? `url(#arrow-skip-${uid})`
                    : `url(#arrow-${uid})`
                }
              />
              {e.label &&
                e.labelAt &&
                (flat ? (
                  /* The tensor shape rides the arrow, set vertically just
                     before the head — italic serif, the paper convention. */
                  <text
                    transform={`translate(${e.labelAt.x}, ${e.labelAt.y}) rotate(-90)`}
                    fontFamily={FONT_SERIF}
                    fontStyle="italic"
                    fontSize={13}
                    fill={surface.ink}
                  >
                    {e.label}
                  </text>
                ) : (
                  <text
                    x={e.labelAt.x}
                    y={e.labelAt.y}
                    textAnchor="middle"
                    fontFamily={FONT_MONO}
                    fontSize={13}
                    fill={surface.inkDim}
                  >
                    {e.label}
                  </text>
                ))}
              {/* ⊕ — the universal residual-add notation */}
              {e.mergeAt && (
                <g>
                  <circle
                    cx={e.mergeAt.x}
                    cy={e.mergeAt.y}
                    r={9}
                    fill={surface.bg === "transparent" ? "#FFFFFF" : surface.bg}
                    stroke={flat ? surface.ink : surface.rule}
                    strokeWidth={1.5}
                  />
                  <path
                    d={`M ${e.mergeAt.x - 4.5} ${e.mergeAt.y} H ${e.mergeAt.x + 4.5} M ${e.mergeAt.x} ${e.mergeAt.y - 4.5} V ${e.mergeAt.y + 4.5}`}
                    stroke={flat ? surface.ink : surface.inkDim}
                    strokeWidth={1.5}
                  />
                </g>
              )}
            </g>
          ))}

          {figure.nodes.map((node) => {
            const c = node.colorOverride
              ? toSwatch(node.colorOverride)
              : swatchFor(palette, node.category);
            const faces = resolveFaces(style, c);
            const selected =
              selectedId != null && node.memberIds.includes(selectedId);
            const tex = textureFor(node.category);
            const patterned =
              tex === "hatch" || tex === "cross" || tex === "lines";
            return (
              <g
                key={node.key}
                onMouseEnter={(e) => onHoverNode?.(e, node)}
                onMouseMove={(e) => onHoverNode?.(e, node)}
                onMouseLeave={onLeaveNode}
                onClick={() => onSelect?.(node.memberIds[0])}
                onPointerDown={(e) => {
                  if (!onNodeDrag) return;
                  e.preventDefault();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  dragRef.current = {
                    id: node.memberIds[0],
                    x: e.clientX,
                    y: e.clientY,
                  };
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d || !onNodeDrag) return;
                  const { dx, dy } = toFigureUnits(
                    e.clientX - d.x,
                    e.clientY - d.y,
                  );
                  if (dx || dy) {
                    onNodeDrag(d.id, dx, dy);
                    dragRef.current = { ...d, x: e.clientX, y: e.clientY };
                  }
                }}
                onPointerUp={() => {
                  dragRef.current = null;
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
                style={{
                  cursor: onNodeDrag
                    ? "grab"
                    : onSelect
                      ? "pointer"
                      : "default",
                  touchAction: onNodeDrag ? "none" : undefined,
                }}
                role="img"
                aria-label={`${node.title}${node.repeat > 1 ? `, repeated ${node.repeat} times` : ""}`}
              >
                {flat ? (
                  /* A flat plate: one rounded rect plus its texture. `rx` is
                     why the layout exposes `rect` — a polygon cannot round
                     its corners, and the mockup's blocks are rounded. */
                  <>
                    <rect
                      x={node.rect.x}
                      y={node.rect.y}
                      width={node.rect.w}
                      height={node.rect.h}
                      rx={9}
                      fill={tex === "grey" ? "#D9D9D9" : "#FFFFFF"}
                      stroke={selected ? "#0EA5E9" : surface.ink}
                      strokeWidth={selected ? 3.5 : style.stroke.width}
                      strokeDasharray={tex === "dashed" ? "5 4" : undefined}
                    />
                    {patterned && (
                      <rect
                        x={node.rect.x}
                        y={node.rect.y}
                        width={node.rect.w}
                        height={node.rect.h}
                        rx={9}
                        fill={`url(#pub-${tex}-${uid})`}
                        stroke="none"
                      />
                    )}
                  </>
                ) : (
                  <>
                    {/* Ghost copies for a repeated stack, far → near */}
                    {node.ghosts.map((g, i) => (
                      <g key={i} opacity={g.opacity * style.ghostBoost}>
                        <polygon points={g.side} fill={c.side} />
                        <polygon points={g.top} fill={c.top} />
                        <polygon points={g.front} fill={c.face} />
                      </g>
                    ))}
                    {/* Faces, painted back to front. `3d` uses flat
                        solids because gradients band once a figure is
                        rasterised at 3× and downsampled for print; the
                        expressive styles opt in to gradients where that does
                        not apply. */}
                    <g
                      filter={
                        style.shadow !== "none"
                          ? `url(#shadow-${uid})`
                          : undefined
                      }
                    >
                      <polygon
                        points={node.faces.side}
                        fill={faces.side.fill}
                        fillOpacity={faces.side.opacity}
                      />
                      <polygon
                        points={node.faces.top}
                        fill={faces.top.fill}
                        fillOpacity={faces.top.opacity}
                      />
                      <polygon
                        points={node.faces.front}
                        fill={
                          style.face.gradient
                            ? `url(#grad-${uid}-${node.category})`
                            : faces.front.fill
                        }
                        fillOpacity={
                          style.face.gradient ? 1 : faces.front.opacity
                        }
                      />
                    </g>
                    {node.category === "dropout" && (
                      <polygon
                        points={node.faces.front}
                        fill={`url(#hatch-${uid})`}
                      />
                    )}
                    {/* Specular sheen — a soft light band across the upper
                        front face. Clipped to the face so it reads as
                        reflection on the material rather than a stripe
                        floating over it. */}
                    {style.face.gloss && (
                      <polygon
                        points={node.faces.front}
                        fill={`url(#gloss-${uid})`}
                        style={{ mixBlendMode: "screen" }}
                      />
                    )}

                    {/* Interior seams — hairline, so they read as folds */}
                    <polygon
                      points={node.faces.top}
                      fill="none"
                      stroke={resolveStroke(style, c)}
                      strokeOpacity={0.4}
                      strokeWidth={1}
                    />
                    <polygon
                      points={node.faces.side}
                      fill="none"
                      stroke={resolveStroke(style, c)}
                      strokeOpacity={0.4}
                      strokeWidth={1}
                    />

                    {/* Keyline drawn once around the silhouette, so corners
                        stay sharp and the two interior seams are not
                        double-stroked into a dark rib. */}
                    <polygon
                      points={node.silhouette}
                      fill="none"
                      stroke={selected ? "#0EA5E9" : resolveStroke(style, c)}
                      strokeWidth={selected ? 3.5 : style.stroke.width}
                      strokeLinejoin="round"
                      filter={
                        style.stroke.glow && !selected
                          ? `url(#glow-${uid})`
                          : undefined
                      }
                    />
                  </>
                )}

                {/* ×N and the tensor shape are 3-D-only furniture: flat hands
                    the repeat count to the brace and the shape to the arrow. */}
                {!flat && node.repeat > 1 && (
                  <text
                    x={node.right + 12}
                    y={node.bottom - 4}
                    fontFamily={FONT_SANS}
                    fontSize={26}
                    fontWeight={700}
                    fill={surface.ink}
                  >
                    ×{node.repeat}
                  </text>
                )}

                {!flat && node.shapeText && (
                  <text
                    x={node.left + 2}
                    y={node.top - 11}
                    fontFamily={FONT_MONO}
                    fontSize={13}
                    fill={surface.inkDim}
                  >
                    {node.shapeText}
                  </text>
                )}

                {flat ? (
                  /* The name lives INSIDE the plate, set vertically. A block
                     is only ~50px wide but 120–300 tall, so the long way is
                     the only axis a full layer name fits along. */
                  <text
                    transform={`translate(${node.rect.x + node.rect.w / 2}, ${node.rect.y + node.rect.h / 2}) rotate(-90)`}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontFamily={FONT_SERIF}
                    fontSize={fitRotated(node.title, node.rect.w, node.rect.h)}
                    fill={surface.ink}
                  >
                    {node.title}
                  </text>
                ) : (
                  <text
                    x={node.centerX}
                    y={node.bottom + 34}
                    textAnchor="middle"
                    fontFamily={FONT_SANS}
                    fontSize={19}
                    fontWeight={600}
                    fill={surface.ink}
                  >
                    {node.title}
                  </text>
                )}
                {node.subtitle && (
                  <text
                    x={node.centerX}
                    y={node.bottom + (flat ? 18 : 56)}
                    textAnchor="middle"
                    fontFamily={flat ? FONT_SERIF : FONT_MONO}
                    fontStyle={flat ? "italic" : undefined}
                    fontSize={flat ? 12 : 14}
                    fill={flat ? surface.ink : surface.inkDim}
                  >
                    {node.subtitle}
                  </text>
                )}
              </g>
            );
          })}

          {/* One brace per folded stack — flat's replacement for the ghost
              copies, and the only thing carrying the repeat count. */}
          {figure.braces.map((b) => (
            <g key={`${b.x1}-${b.y}`}>
              <path
                d={bracePath(b.x1, b.x2, b.y, 7)}
                fill="none"
                stroke={surface.ink}
                strokeWidth={1.4}
              />
              <text
                x={(b.x1 + b.x2) / 2}
                y={b.y + 34}
                textAnchor="middle"
                fontFamily={FONT_SERIF}
                fontSize={14}
                fill={surface.ink}
              >
                {b.label}
              </text>
            </g>
          ))}
        </g>

        {/* Caption. Flat's identifier, in place of the heading it dropped. */}
        {showHeader && flat && (
          <text
            x={figure.width / 2}
            y={totalH - LEGEND_H - 14}
            textAnchor="middle"
            fontFamily={FONT_SERIF}
            fontSize={15}
            fill={surface.ink}
          >
            {`Figure ${figureNumber}: ${figureLabel?.trim() || figure.title}.${
              figure.params ? ` ${figure.params} parameters.` : ""
            }`}
          </text>
        )}

        {/* Legend — only categories actually present */}
        {showLegend && (
          <g data-export-hide transform={`translate(30, ${totalH - 24})`}>
            {figure.categories.map((cat, i) => {
              const c = swatchFor(palette, cat);
              const tex = textureFor(cat);
              return (
                <g key={cat} transform={`translate(${i * 138}, 0)`}>
                  {/* Flat chips repeat the plate exactly — same fill, texture
                      and keyline — so the legend keys off what is drawn rather
                      than off a colour the figure never uses. */}
                  <rect
                    width={128}
                    height={26}
                    y={-18}
                    fill={
                      flat ? (tex === "grey" ? "#D9D9D9" : "#FFFFFF") : c.face
                    }
                    stroke={flat ? surface.ink : c.edge}
                    strokeWidth={1}
                    strokeDasharray={
                      flat && tex === "dashed" ? "5 4" : undefined
                    }
                  />
                  {flat
                    ? (tex === "hatch" ||
                        tex === "cross" ||
                        tex === "lines") && (
                        <rect
                          width={128}
                          height={26}
                          y={-18}
                          fill={`url(#pub-${tex}-${uid})`}
                          stroke="none"
                        />
                      )
                    : cat === "dropout" && (
                        <rect
                          width={128}
                          height={26}
                          y={-18}
                          fill={`url(#hatch-${uid})`}
                          stroke={c.edge}
                          strokeWidth={1}
                        />
                      )}
                  <text
                    x={64}
                    y={0}
                    textAnchor="middle"
                    fontFamily={flat ? FONT_SERIF : FONT_SANS}
                    fontSize={13}
                    fontWeight={flat ? 400 : 500}
                    /* Chip text flips with the fill's luminance — a pastel or
                       monochrome palette would otherwise put white on a
                       near-white chip. */
                    fill={flat ? surface.ink : inkOn(c.face)}
                  >
                    {CATEGORY_LABEL[cat] ?? cat}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>
    );
  },
);
