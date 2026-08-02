"use client";

/**
 * Shared chrome for every visualization.
 *
 * Before this, chrome was whatever each chart happened to implement: the zoom
 * cluster existed on two of five (byte-identical in both), legends on one,
 * tooltips in three incompatible flavours, and nothing was reachable by
 * keyboard or announced to a screen reader. Users learned a control's location
 * on one chart and lost it on the next.
 *
 * The shell owns position and behavior; charts own their SVG. A chart renders:
 *
 *   const canvas = useVizCanvas();
 *   const zoom = useVizZoom();
 *   <VizShell canvas={canvas} zoom={zoom} label="…" description="…"
 *             legend={…} toolbarLeft={…} toolbarRight={…}>
 *     <svg ref={svgRef} className="w-full h-full" />
 *   </VizShell>
 *
 * and calls `zoom.register(svg, behavior, rootG)` inside its draw effect.
 */

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";
import type { VizCanvas } from "./useVizCanvas";
import type { VizZoom } from "./useVizZoom";

/* ── Legend ───────────────────────────────────────────────── */

export interface VizLegendItem {
  /** Any CSS color. Prefer the live `hsl(var(--viz-*))` helpers from lib/viz/tokens. */
  color: string;
  label: string;
  /** `line` for edge/connector kinds, `swatch` (default) for node kinds. */
  shape?: "swatch" | "line";
}

export interface VizLegendProps {
  items?: VizLegendItem[];
  /**
   * Caveat shown under the keys — e.g. "3 files sized by bytes, no parser for
   * .rs". A chart that silently mixes a real metric with a fallback is lying;
   * this is where it stops.
   */
  note?: string;
  title?: string;
}

export function VizLegend({ items, note, title }: VizLegendProps) {
  if (!items?.length && !note) return null;
  return (
    <div className="rounded-lg border border-border bg-card/90 px-3 py-2 shadow-sm backdrop-blur-sm">
      {title && (
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
      )}
      {!!items?.length && (
        <ul className="flex flex-col gap-1">
          {items.map((it) => (
            <li key={it.label} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn("shrink-0", it.shape === "line" ? "h-0.5 w-3.5 rounded-full" : "h-2.5 w-2.5 rounded-sm")}
                style={{ backgroundColor: it.color }}
              />
              {it.label}
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p className="mt-1.5 max-w-[190px] border-t border-border pt-1.5 text-[10px] leading-snug text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}

/* ── Zoom cluster ─────────────────────────────────────────── */

/** 44px per WCAG 2.5.5 target size — the old 32px buttons were unusable on touch. */
const ZOOM_BTN = cn(
  "flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors",
  "hover:bg-accent hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
  "focus-visible:ring-[hsl(var(--viz-highlight))]",
);

function ZoomCluster({ zoom }: { zoom: VizZoom }) {
  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col overflow-hidden rounded-lg border border-border bg-card/90 shadow-lg backdrop-blur-sm">
      <button type="button" onClick={zoom.zoomIn} aria-label="Zoom in" className={ZOOM_BTN}>
        <span aria-hidden="true" className="text-base leading-none">+</span>
      </button>
      <button
        type="button"
        onClick={zoom.zoomOut}
        aria-label="Zoom out"
        className={cn(ZOOM_BTN, "border-t border-border")}
      >
        <span aria-hidden="true" className="text-base leading-none">−</span>
      </button>
      <button
        type="button"
        // Wrapped, not passed by reference: React would hand the click event
        // in as the options argument.
        onClick={() => zoom.fitToView()}
        aria-label="Fit to view"
        className={cn(ZOOM_BTN, "border-t border-border")}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

/* ── Tooltip ──────────────────────────────────────────────── */

export interface VizTooltipProps {
  /** Cursor position in CONTAINER coordinates: clientX - rect.left. */
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  width?: number;
  children: ReactNode;
}

const TOOLTIP_MARGIN = 14;
const TOOLTIP_EST_HEIGHT = 180;

/**
 * Container-relative tooltip that flips near an edge instead of clipping.
 *
 * Position must come from `clientX - containerRect.left`, never `event.offsetX`
 * — offsetX is relative to whichever SVG child was hovered and differs between
 * Chrome and Firefox, which is why the treemap's tooltip used to land on the
 * tile rather than the cursor.
 */
export function VizTooltip({
  x,
  y,
  containerWidth,
  containerHeight,
  width = 240,
  children,
}: VizTooltipProps) {
  let left = x + TOOLTIP_MARGIN;
  let top = y + TOOLTIP_MARGIN;
  if (left + width > containerWidth) left = x - width - TOOLTIP_MARGIN;
  if (top + TOOLTIP_EST_HEIGHT > containerHeight) top = y - TOOLTIP_EST_HEIGHT - TOOLTIP_MARGIN;

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-xl"
      style={{ left: Math.max(8, left), top: Math.max(8, top), width }}
    >
      {children}
    </div>
  );
}

/* ── Empty / error ────────────────────────────────────────── */

export interface VizMessageProps {
  title: string;
  body?: string;
  /** Empty states are features. Give the user somewhere to go. */
  action?: ReactNode;
  tone?: "neutral" | "error";
}

export function VizMessage({ title, body, action, tone = "neutral" }: VizMessageProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-10 text-center">
      <div
        className={cn(
          "mb-5 flex h-16 w-16 items-center justify-center rounded-full",
          tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}
      >
        <AlertCircle size={32} aria-hidden="true" />
      </div>
      <h3 className="mb-2 text-lg font-bold text-foreground">{title}</h3>
      {body && <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/* ── Shell ────────────────────────────────────────────────── */

export interface VizShellProps {
  canvas: VizCanvas;
  zoom: VizZoom;
  /** Short chart name, announced to screen readers. */
  label: string;
  /** What the encoding means — what size and color stand for. */
  description: string;
  legend?: ReactNode;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function VizShell({
  canvas,
  zoom,
  label,
  description,
  legend,
  toolbarLeft,
  toolbarRight,
  overlay,
  children,
  className,
}: VizShellProps) {
  const descId = useId();
  // Destructured, not `canvas.attach` inline: React's compiler lint rejects a
  // member expression in a `ref=` slot on the assumption it is a ref object.
  const { attach } = canvas;

  return (
    <div
      ref={attach}
      className={cn("relative h-full w-full overflow-hidden", className)}
    >
      {/*
        The chart is a group so the zoom shortcuts have somewhere to fire from,
        and so assistive tech announces what this region is before the user
        walks into a wall of unlabeled <rect>s. tabIndex makes +/-/0 reachable
        without a pointer; per-node keyboard traversal lands in T12.
      */}
      <div
        role="group"
        aria-label={label}
        aria-describedby={descId}
        tabIndex={0}
        onKeyDown={zoom.onKeyDown}
        className={cn(
          "h-full w-full",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
          "focus-visible:ring-[hsl(var(--viz-highlight))]",
        )}
      >
        {children}
      </div>

      <p id={descId} className="sr-only">
        {description} Press plus or minus to zoom, zero to fit the chart to the view.
      </p>

      {toolbarLeft && <div className="absolute left-3 top-3 z-10 flex items-center gap-2">{toolbarLeft}</div>}
      {toolbarRight && <div className="absolute right-3 top-3 z-10 flex items-center gap-2">{toolbarRight}</div>}
      {legend && <div className="absolute bottom-3 left-3 z-10">{legend}</div>}

      <ZoomCluster zoom={zoom} />
      {overlay}
    </div>
  );
}
