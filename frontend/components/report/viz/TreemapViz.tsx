"use client";

/**
 * TreemapViz — directory-nested complexity treemap.
 *
 * Two encodings, which is the whole point:
 *   area  = the size metric (lines of code once T3b lands, bytes before that)
 *   color = complexity
 * A big pale tile is boring-but-long; a small hot tile is the file that bites
 * you. The previous version had one encoding and no key, so it could not
 * express that difference at all.
 *
 * Honesty rule: this component never assumes what it is drawing. It reads
 * `meta.metric_label` for the legend and `complexity_source` per leaf, and says
 * so when values fall back to file size. That is what keeps the name
 * "Complexity Treemap" truthful while the backend metric is still in flight.
 */

import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import * as d3 from "d3";
import {
  seqScale,
  inkOnFill,
  inkDimVar,
  edgeVar,
  useVizThemeVersion,
} from "@/lib/viz/tokens";
import { VizShell, VizTooltip, VizMessage } from "@/components/viz/VizShell";
import { VizBreadcrumb, type VizCrumb } from "@/components/viz/VizBreadcrumb";
import { useVizCanvas } from "@/components/viz/useVizCanvas";
import { useVizZoom, ZOOM_MIN, ZOOM_MAX } from "@/components/viz/useVizZoom";
import { useReducedMotion } from "@/components/viz/useReducedMotion";

/* ── Data contract (see backend/codekavi/routes/visualize.py) ─ */

export interface TreemapLeaf {
  name: string;
  path?: string;
  /** Area metric. Bytes today; lines of code after T3b. */
  value: number;
  /** Color metric. Absent until T3b — falls back to `value`. */
  complexity?: number;
  loc?: number;
  language?: string;
  role?: string;
  /** "cyclomatic" | "size_fallback" — drives the legend's honesty note. */
  complexity_source?: string;
}

export interface TreemapGroup {
  name: string;
  path?: string;
  children: TreemapNode[];
}

export type TreemapNode = TreemapLeaf | TreemapGroup;

export interface TreemapMeta {
  total?: number;
  shown?: number;
  truncated?: boolean;
  metric?: string;
  metric_label?: string;
}

export interface TreemapData extends TreemapGroup {
  meta?: TreemapMeta;
}

const isGroup = (n: TreemapNode): n is TreemapGroup =>
  Array.isArray((n as TreemapGroup).children);

/* ── Layout constants ─────────────────────────────────────── */

/** Height of a directory's header band. Must fit an 11px label. */
const BAND = 20;
const PAD_OUTER = 4;
const PAD_INNER = 2;
/** Below this a tile cannot show a readable label. */
const LABEL_MIN_W = 54;
const LABEL_MIN_H = 24;
const SUBLABEL_MIN_H = 40;

/* ── Component ────────────────────────────────────────────── */

export const TreemapViz = forwardRef<HTMLDivElement, { data: TreemapData }>(
  function TreemapViz({ data }, ref) {
    const svgRef = useRef<SVGSVGElement>(null);
    const canvas = useVizCanvas();
    const reducedMotion = useReducedMotion();
    const zoom = useVizZoom(!reducedMotion);
    const themeVersion = useVizThemeVersion();

    /** Directory path currently drilled into, as path segments. */
    const [drill, setDrill] = useState<string[]>([]);
    const [tip, setTip] = useState<{ x: number; y: number; leaf: TreemapLeaf } | null>(null);

    useImperativeHandle(ref, () => canvas.containerRef.current!);

    /* ── Resolve the drilled-into subtree ── */

    const { root, crumbs } = useMemo(() => {
      let node: TreemapGroup = data;
      const trail: VizCrumb[] = [{ id: "", label: data.name || "Repository" }];

      for (const seg of drill) {
        const next = isGroup(node)
          ? (node.children.find((c) => isGroup(c) && c.name === seg) as TreemapGroup | undefined)
          : undefined;
        if (!next) break;
        node = next;
        trail.push({ id: trail.length.toString(), label: seg });
      }
      // A single crumb is just the repo name — not a navigation control.
      return { root: node, crumbs: trail.length > 1 ? trail : [] };
    }, [data, drill]);

    /**
     * Color domain across the WHOLE repo, not the drilled subtree.
     *
     * Rescaling per drill would recolor identical files as you navigate, so a
     * file could read "hot" inside a calm directory and "cold" one level up.
     * The legend endpoints stay fixed for the same reason.
     */
    const stats = useMemo(() => {
      const leaves: TreemapLeaf[] = [];
      const walk = (n: TreemapNode) => {
        if (isGroup(n)) n.children.forEach(walk);
        else leaves.push(n);
      };
      walk(data);

      const colorOf = (l: TreemapLeaf) => l.complexity ?? l.value ?? 0;
      const values = leaves.map(colorOf);
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 1;
      const fallbacks = leaves.filter((l) => l.complexity_source === "size_fallback");
      const fallbackLangs = [...new Set(fallbacks.map((l) => l.language).filter(Boolean))];

      return {
        min,
        max,
        colorOf,
        /** True once the backend actually sends complexity (T3b). */
        hasComplexity: leaves.some((l) => l.complexity != null),
        fallbackCount: fallbacks.length,
        fallbackLangs: fallbackLangs as string[],
        // p90 is the "hotspot" threshold used in the tooltip note.
        p90: values.length ? d3.quantile(values.slice().sort(d3.ascending), 0.9) ?? max : max,
      };
    }, [data]);

    /* ── Render ── */

    useEffect(() => {
      const svgEl = svgRef.current;
      const { width, height } = canvas.size;
      if (!svgEl || !canvas.ready || !isGroup(root) || root.children.length === 0) return;

      const svg = d3.select(svgEl);
      svg.selectAll("*").remove();
      svg.attr("width", width).attr("height", height);
      const g = svg.append("g");

      const hierarchy = d3
        .hierarchy<TreemapNode>(root, (n) => (isGroup(n) ? n.children : undefined))
        .sum((n) => (isGroup(n) ? 0 : Math.max(0, n.value || 0)))
        .sort((a, b) => (b.value || 0) - (a.value || 0));

      d3
        .treemap<TreemapNode>()
        .size([width, height])
        .paddingOuter(PAD_OUTER)
        // Reserve the band only on nodes that actually render one.
        .paddingTop((d) => (d.children && d.depth > 0 ? BAND : 0))
        .paddingInner(PAD_INNER)
        .round(true)(hierarchy);

      const color = seqScale([stats.min, stats.max]);
      type Cell = d3.HierarchyRectangularNode<TreemapNode>;
      const w = (d: Cell) => Math.max(0, d.x1 - d.x0);
      const h = (d: Cell) => Math.max(0, d.y1 - d.y0);

      /* ─ Directory groups ─ */
      const groups = hierarchy
        .descendants()
        .filter((d) => d.children && d.depth > 0) as Cell[];

      const groupG = g
        .append("g")
        .selectAll("g")
        .data(groups)
        .join("g")
        .attr("transform", (d) => `translate(${d.x0},${d.y0})`)
        .style("cursor", "pointer")
        .on("click", (_e, d) => {
          // Drill using the node's own ancestry, so it works at any depth.
          const segs = d
            .ancestors()
            .reverse()
            .slice(1)
            .map((a) => a.data.name);
          setDrill((prev) => [...prev, ...segs]);
        });

      groupG
        .append("rect")
        .attr("width", w)
        .attr("height", h)
        .attr("fill", "none")
        .attr("stroke", edgeVar())
        .attr("stroke-width", 1)
        .attr("rx", 3);

      // Header band — this is what makes it a treemap rather than a bar chart
      // in a square: you can see which directory carries the weight.
      groupG
        .append("text")
        .attr("x", 6)
        .attr("y", 13)
        .attr("font-size", 10.5)
        .attr("font-weight", 650)
        .attr("letter-spacing", "0.02em")
        .attr("fill", inkDimVar())
        .attr("pointer-events", "none")
        .text((d) => d.data.name)
        .each(function (d) {
          truncateToWidth(this as SVGTextElement, w(d) - 12);
        });

      /* ─ File tiles ─ */
      const leaves = hierarchy.leaves() as Cell[];

      const cell = g
        .append("g")
        .selectAll("g")
        .data(leaves)
        .join("g")
        .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

      cell
        .append("rect")
        .attr("width", w)
        .attr("height", h)
        .attr("rx", 2)
        .attr("fill", (d) => color(stats.colorOf(d.data as TreemapLeaf)))
        .attr("stroke", edgeVar())
        .attr("stroke-width", 0.5)
        .style("cursor", "pointer")
        .on("mousemove", function (event: MouseEvent, d) {
          const rect = canvas.containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          // Container-relative, never event.offsetX — that is relative to the
          // hovered <rect> and differs across browsers.
          setTip({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            leaf: d.data as TreemapLeaf,
          });
          d3.select(this).attr("stroke", "hsl(var(--viz-highlight))").attr("stroke-width", 2);
        })
        .on("mouseleave", function () {
          setTip(null);
          d3.select(this).attr("stroke", edgeVar()).attr("stroke-width", 0.5);
        });

      const fits = (d: Cell) => w(d) > LABEL_MIN_W && h(d) > LABEL_MIN_H;

      cell
        .filter(fits)
        .append("text")
        .attr("x", 5)
        .attr("y", 14)
        .attr("font-size", 10.5)
        .attr("pointer-events", "none")
        .attr("fill", (d) => inkOnFill(color(stats.colorOf(d.data as TreemapLeaf))))
        .text((d) => d.data.name)
        .each(function (d) {
          truncateToWidth(this as SVGTextElement, w(d) - 10);
        });

      cell
        .filter((d) => fits(d) && h(d) > SUBLABEL_MIN_H)
        .append("text")
        .attr("x", 5)
        .attr("y", 26)
        .attr("font-size", 9.5)
        .attr("fill-opacity", 0.8)
        .attr("pointer-events", "none")
        .attr("fill", (d) => inkOnFill(color(stats.colorOf(d.data as TreemapLeaf))))
        .text((d) => {
          const l = d.data as TreemapLeaf;
          return stats.hasComplexity ? `cx ${l.complexity}` : String(l.value ?? "");
        });

      /* ─ Zoom ─ */
      const behavior = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([ZOOM_MIN, ZOOM_MAX])
        .on("zoom", (ev) => g.attr("transform", ev.transform));
      svg.call(behavior);
      zoom.register(svgEl, behavior, g.node());

      return () => {
        zoom.register(null, null, null);
        svg.selectAll("*").remove();
      };
    }, [root, stats, canvas.size, canvas.ready, canvas.containerRef, zoom, themeVersion]);

    /* ── Empty ── */

    if (!isGroup(root) || root.children.length === 0) {
      return (
        <VizMessage
          title="Nothing to chart here"
          body="This directory has no files with a recorded size. Try a level up."
          action={
            drill.length > 0 ? (
              <button
                onClick={() => setDrill([])}
                className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Back to repository root
              </button>
            ) : undefined
          }
        />
      );
    }

    const metricLabel = data.meta?.metric_label ?? "File size (bytes)";
    const colorLabel = stats.hasComplexity ? "Cyclomatic complexity" : metricLabel;

    return (
      <VizShell
        canvas={canvas}
        zoom={zoom}
        label="Complexity treemap"
        description={
          `Files grouped by directory. Tile area is ${metricLabel.toLowerCase()}; ` +
          `tile color is ${colorLabel.toLowerCase()}, from ${fmt(stats.min)} to ${fmt(stats.max)}.` +
          (data.meta?.truncated
            ? ` Showing the ${data.meta.shown} most important of ${data.meta.total} files.`
            : "")
        }
        // Footer, not an inset legend: a treemap fills its canvas, so a
        // floating key would sit on top of real tiles.
        footer={
          <ColorLegend
            label={colorLabel}
            areaLabel={metricLabel.toLowerCase()}
            min={stats.min}
            max={stats.max}
            note={legendNote(stats, data.meta)}
          />
        }
        // Reserved strip, not an overlay: on a space-filling chart a floating
        // breadcrumb covers the top-left tile's label.
        header={
          crumbs.length > 0 ? (
            <VizBreadcrumb
              segments={crumbs}
              onNavigate={(id) => setDrill((prev) => prev.slice(0, Number(id) || 0))}
            />
          ) : undefined
        }
        overlay={
          tip && (
            <VizTooltip
              x={tip.x}
              y={tip.y}
              containerWidth={canvas.size.width}
              containerHeight={canvas.size.height}
            >
              <div className="truncate font-semibold text-foreground">{tip.leaf.name}</div>
              {tip.leaf.path && (
                <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                  {tip.leaf.path}
                </div>
              )}
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
                {stats.hasComplexity && (
                  <>
                    <dt>Complexity</dt>
                    <dd className="text-right font-semibold text-foreground">
                      {tip.leaf.complexity}
                    </dd>
                  </>
                )}
                {tip.leaf.loc != null && (
                  <>
                    <dt>Lines</dt>
                    <dd className="text-right text-foreground">{tip.leaf.loc}</dd>
                  </>
                )}
                <dt>{stats.hasComplexity ? "Size" : metricLabel}</dt>
                <dd className="text-right text-foreground">{fmt(tip.leaf.value)}</dd>
                {tip.leaf.language && (
                  <>
                    <dt>Language</dt>
                    <dd className="text-right text-foreground">{tip.leaf.language}</dd>
                  </>
                )}
              </dl>
              <p className="mt-2 border-t border-border pt-2 leading-snug text-muted-foreground">
                {hotspotNote(tip.leaf, stats)}
              </p>
            </VizTooltip>
          )
        }
      >
        <svg ref={svgRef} className="h-full w-full" />
      </VizShell>
    );
  },
);

/* ── Legend ───────────────────────────────────────────────── */

function ColorLegend({
  label,
  areaLabel,
  min,
  max,
  note,
}: {
  label: string;
  areaLabel: string;
  min: number;
  max: number;
  note?: string;
}) {
  // Horizontal: it lives in the footer strip, where vertical space is the
  // scarce axis and horizontal space is free.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wider text-[10px]">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="tabular-nums">{fmt(min)}</span>
        <span
          className="h-2 w-[140px] rounded-sm"
          style={{
            background:
              "linear-gradient(90deg, hsl(var(--viz-seq-from)), hsl(var(--viz-seq-to)))",
          }}
        />
        <span className="tabular-nums">{fmt(max)}</span>
      </span>
      <span className="text-[10.5px]">Tile area = {areaLabel}</span>
      {note && <span className="text-[10.5px] opacity-80">{note}</span>}
    </div>
  );
}

/* ── Copy helpers ─────────────────────────────────────────── */

type Stats = {
  min: number;
  max: number;
  p90: number;
  hasComplexity: boolean;
  fallbackCount: number;
  fallbackLangs: string[];
  colorOf: (l: TreemapLeaf) => number;
};

/**
 * The legend's honesty line. Surfaces two things a reader cannot otherwise
 * know: that some tiles are sized by a fallback metric, and that the chart is
 * not showing the whole repository.
 */
function legendNote(stats: Stats, meta?: TreemapMeta): string | undefined {
  const parts: string[] = [];

  if (!stats.hasComplexity) {
    parts.push("Color is file size, not complexity yet.");
  } else if (stats.fallbackCount > 0) {
    const langs = stats.fallbackLangs.length
      ? ` — no parser for ${stats.fallbackLangs.join(", ")}`
      : "";
    parts.push(`${stats.fallbackCount} file${stats.fallbackCount === 1 ? "" : "s"} sized by bytes${langs}.`);
  }

  if (meta?.truncated && meta.shown != null && meta.total != null) {
    parts.push(`Showing ${meta.shown} of ${meta.total} files.`);
  }

  return parts.length ? parts.join(" ") : undefined;
}

/**
 * One factual line about why a tile matters. Derived from the data only —
 * a number without interpretation ("cx 84") tells a reader nothing, and an
 * invented narrative would tell them something false.
 */
function hotspotNote(leaf: TreemapLeaf, stats: Stats): string {
  const v = stats.colorOf(leaf);
  const metric = stats.hasComplexity ? "complexity" : "size";

  if (stats.max === stats.min) return `Only one distinct ${metric} value in this repository.`;
  if (v >= stats.max) return `Highest ${metric} in the repository.`;
  if (v >= stats.p90) return `Top 10% by ${metric} — a likely maintenance hotspot.`;

  if (stats.hasComplexity && leaf.loc != null && leaf.loc > 0) {
    const density = v / leaf.loc;
    if (leaf.loc > 300 && density < 0.05) {
      return "Long but simple — lots of lines, little branching.";
    }
    if (leaf.loc < 120 && density > 0.2) {
      return "Small but dense — heavy branching packed into few lines.";
    }
  }

  const pct = Math.round(((v - stats.min) / (stats.max - stats.min)) * 100);
  return `Around the ${pct}th percentile for ${metric} here.`;
}

/** Compact number formatting so legend endpoints never overflow the swatch. */
function fmt(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/** Trim an SVG text node until it fits, appending an ellipsis. */
function truncateToWidth(node: SVGTextElement, maxWidth: number) {
  if (maxWidth <= 0) {
    node.textContent = "";
    return;
  }
  const original = node.textContent ?? "";
  if (node.getComputedTextLength() <= maxWidth) return;
  let text = original;
  while (text.length > 1 && node.getComputedTextLength() > maxWidth) {
    text = text.slice(0, -1);
    node.textContent = text + "…";
  }
}
