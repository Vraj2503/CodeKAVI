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
      else if (ref) (ref as React.MutableRefObject<SVGSVGElement | null>).current = el;
    };
    const figure = useMemo(
      () => buildFigure(model, { offsets, colors }),
      [model, offsets, colors],
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

    const HEADER_H = showHeader ? 72 : 24;
    const LEGEND_H = showLegend && figure.categories.length ? 58 : 16;
    const totalH = figure.height + HEADER_H + LEGEND_H;
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

          {/* Per-category gradients. Declared only when the style asks for
              them, so `publication` exports with no gradient stops at all. */}
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
                  <stop offset="0%" stopColor={c.top} stopOpacity={f.front.opacity} />
                  <stop offset="55%" stopColor={f.front.fill} stopOpacity={f.front.opacity} />
                  <stop offset="100%" stopColor={c.side} stopOpacity={f.front.opacity} />
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
            <filter id={`glow-${uid}`} x="-60%" y="-60%" width="220%" height="220%">
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
            <filter id={`shadow-${uid}`} x="-40%" y="-40%" width="200%" height="200%">
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
            <pattern id={`ground-${uid}`} width="24" height="24" patternUnits="userSpaceOnUse">
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
            <pattern id={`ground-${uid}`} width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.1" fill={surface.inkDim} fillOpacity="0.34" />
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
            <path d="M 0 0 L 10 5 L 0 10 z" fill={surface.inkDim} />
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
            <path d="M 0 0 L 10 5 L 0 10 z" fill={surface.rule} />
          </marker>
        </defs>

        {ground !== "plain" && (
          <rect width="100%" height="100%" fill={`url(#ground-${uid})`} />
        )}

        {showHeader && (
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
                stroke={e.kind === "skip" ? surface.rule : surface.inkDim}
                strokeWidth={e.kind === "skip" ? 1.8 : 2.2}
                strokeDasharray={e.kind === "skip" ? "6 5" : undefined}
                markerEnd={
                  e.kind === "skip"
                    ? `url(#arrow-skip-${uid})`
                    : `url(#arrow-${uid})`
                }
              />
              {e.label && e.labelAt && (
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
              )}
              {/* ⊕ — the universal residual-add notation */}
              {e.mergeAt && (
                <g>
                  <circle
                    cx={e.mergeAt.x}
                    cy={e.mergeAt.y}
                    r={9}
                    fill={surface.bg === "transparent" ? "#FFFFFF" : surface.bg}
                    stroke={surface.rule}
                    strokeWidth={1.5}
                  />
                  <path
                    d={`M ${e.mergeAt.x - 4.5} ${e.mergeAt.y} H ${e.mergeAt.x + 4.5} M ${e.mergeAt.x} ${e.mergeAt.y - 4.5} V ${e.mergeAt.y + 4.5}`}
                    stroke={surface.inkDim}
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
            const selected = selectedId != null && node.memberIds.includes(selectedId);
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
                  cursor: onNodeDrag ? "grab" : onSelect ? "pointer" : "default",
                  touchAction: onNodeDrag ? "none" : undefined,
                }}
                role="img"
                aria-label={`${node.title}${node.repeat > 1 ? `, repeated ${node.repeat} times` : ""}`}
              >
                {/* Ghost copies for a repeated stack, far → near */}
                {node.ghosts.map((g, i) => (
                  <g key={i} opacity={g.opacity * style.ghostBoost}>
                    <polygon points={g.side} fill={c.side} />
                    <polygon points={g.top} fill={c.top} />
                    <polygon points={g.front} fill={c.face} />
                  </g>
                ))}

                {/* Faces, painted back to front. `publication` uses flat
                    solids because gradients band once a figure is rasterised
                    at 3× and downsampled for print; the expressive styles opt
                    in to gradients where that does not apply. */}
                <g filter={style.shadow !== "none" ? `url(#shadow-${uid})` : undefined}>
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
                    fillOpacity={style.face.gradient ? 1 : faces.front.opacity}
                  />
                </g>
                {node.category === "dropout" && (
                  <polygon points={node.faces.front} fill={`url(#hatch-${uid})`} />
                )}
                {/* Specular sheen — a soft light band across the upper front
                    face. Clipped to the face so it reads as reflection on the
                    material rather than a stripe floating over it. */}
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

                {/* Keyline drawn once around the silhouette, so corners stay
                    sharp and the two interior seams are not double-stroked
                    into a dark rib. */}
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

                {node.repeat > 1 && (
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

                {node.shapeText && (
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
                {node.subtitle && (
                  <text
                    x={node.centerX}
                    y={node.bottom + 56}
                    textAnchor="middle"
                    fontFamily={FONT_MONO}
                    fontSize={14}
                    fill={surface.inkDim}
                  >
                    {node.subtitle}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Legend — only categories actually present */}
        {showLegend && (
          <g transform={`translate(30, ${totalH - 24})`}>
            {figure.categories.map((cat, i) => {
              const c = swatchFor(palette, cat);
              return (
                <g key={cat} transform={`translate(${i * 138}, 0)`}>
                  <rect
                    width={128}
                    height={26}
                    y={-18}
                    fill={c.face}
                    stroke={c.edge}
                    strokeWidth={1}
                  />
                  {cat === "dropout" && (
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
                    fontFamily={FONT_SANS}
                    fontSize={13}
                    fontWeight={500}
                    /* Chip text flips with the fill's luminance — a pastel or
                       monochrome palette would otherwise put white on a
                       near-white chip. */
                    fill={inkOn(c.face)}
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
