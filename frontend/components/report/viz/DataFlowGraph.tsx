"use client";

/**
 * DataFlowGraph — semantic data flow diagram.
 *
 * Renders conceptual stages (not files) as shaped nodes (rounded rect /
 * cylinder / parallelogram / hexagon per backend `shape`), connected by
 * curved, colour-coded edges ordered left-to-right by backend `tier`.
 */

import {
  useRef,
  useEffect,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as d3 from "d3";
import { catVar, inkDimVar } from "@/lib/viz/tokens";
import { VizShell, VizLegend, type VizLegendItem } from "@/components/viz/VizShell";
import { useVizCanvas } from "@/components/viz/useVizCanvas";
import { useVizZoom, ZOOM_MIN, ZOOM_MAX } from "@/components/viz/useVizZoom";
import { useReducedMotion } from "@/components/viz/useReducedMotion";

interface Node {
  id: string;
  label: string;
  type: string; // "process" | "data_store" | "io" | "transform"
  shape?: string; // "rounded_rect" | "cylinder" | "parallelogram" | "hexagon"
  description?: string;
  source_files?: string[];
  tier?: number;
}

interface Edge {
  source: string;
  target: string;
  label?: string;
  data_type?: string; // "http" | "db" | "file" | "event" | "internal"
  animated?: boolean;
}

interface DataFlowGraphProps {
  nodes: Node[];
  edges: Edge[];
}

// Semantic stage kinds → categorical slots (lib/viz/tokens.ts)
const TYPE_COLORS: Record<string, string> = {
  io: catVar(1),
  process: catVar(5),
  transform: catVar(2),
  data_store: catVar(3),
};

// Edge kinds keep distinct hues so a flow's transport is readable at a glance
const EDGE_COLORS: Record<string, string> = {
  http: catVar(0),
  db: catVar(3),
  file: catVar(1),
  event: catVar(2),
};

// Legend copy — utility language, not the raw wire values
const TYPE_LABELS: Record<string, string> = {
  io: "Entry / exit",
  process: "Process",
  transform: "Transform",
  data_store: "Data store",
};

const EDGE_LABELS: Record<string, string> = {
  http: "HTTP",
  db: "Database",
  file: "File",
  event: "Event",
};

const NODE_W = 150;
const NODE_H = 46;

function getColor(type: string): string {
  return TYPE_COLORS[type] || inkDimVar();
}

function getEdgeColor(dataType?: string): string {
  return dataType && EDGE_COLORS[dataType]
    ? EDGE_COLORS[dataType]
    : "hsl(var(--border))";
}

function truncate(text: string, max = 20): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Appends the SVG shape for a node's `shape` kind, centred at the origin. */
function appendShape(
  group: d3.Selection<SVGGElement, unknown, null, undefined>,
  shape: string,
  fill: string,
  stroke: string,
  strokeWidth: number,
) {
  const w = NODE_W;
  const h = NODE_H;
  switch (shape) {
    case "cylinder": {
      const rx = w / 2;
      const ry = h * 0.18;
      const top = -h / 2 + ry;
      const bottom = h / 2 - ry;
      group
        .append("path")
        .attr(
          "d",
          `M${-rx},${top} L${-rx},${bottom} A${rx},${ry} 0 0 0 ${rx},${bottom} L${rx},${top}`,
        )
        .attr("fill", fill)
        .attr("stroke", stroke)
        .attr("stroke-width", strokeWidth);
      group
        .append("ellipse")
        .attr("cy", top)
        .attr("rx", rx)
        .attr("ry", ry)
        .attr("fill", fill)
        .attr("stroke", stroke)
        .attr("stroke-width", strokeWidth);
      break;
    }
    case "parallelogram": {
      const skew = w * 0.18;
      group
        .append("polygon")
        .attr(
          "points",
          `${-w / 2 + skew},${-h / 2} ${w / 2},${-h / 2} ${w / 2 - skew},${h / 2} ${-w / 2},${h / 2}`,
        )
        .attr("fill", fill)
        .attr("stroke", stroke)
        .attr("stroke-width", strokeWidth);
      break;
    }
    case "hexagon": {
      const cut = w * 0.18;
      group
        .append("polygon")
        .attr(
          "points",
          `${-w / 2 + cut},${-h / 2} ${w / 2 - cut},${-h / 2} ${w / 2},0 ${w / 2 - cut},${h / 2} ${-w / 2 + cut},${h / 2} ${-w / 2},0`,
        )
        .attr("fill", fill)
        .attr("stroke", stroke)
        .attr("stroke-width", strokeWidth);
      break;
    }
    default: // rounded_rect
      group
        .append("rect")
        .attr("x", -w / 2)
        .attr("y", -h / 2)
        .attr("width", w)
        .attr("height", h)
        .attr("rx", 10)
        .attr("fill", fill)
        .attr("stroke", stroke)
        .attr("stroke-width", strokeWidth);
  }
}

export const DataFlowGraph = forwardRef<HTMLDivElement, DataFlowGraphProps>(
  function DataFlowGraph({ nodes, edges }, ref) {
    const svgRef = useRef<SVGSVGElement>(null);
    const [selected, setSelected] = useState<Node | null>(null);

    const canvas = useVizCanvas();
    const reducedMotion = useReducedMotion();
    const zoom = useVizZoom(!reducedMotion);
    const containerRef = canvas.containerRef;
    const containerSize = canvas.size;

    useImperativeHandle(ref, () => containerRef.current!);

    const maxTier = useMemo(
      () => Math.max(0, ...nodes.map((n) => n.tier ?? 0)),
      [nodes],
    );

    /** Only key the kinds actually present — a legend for absent things is noise. */
    const legendItems = useMemo<VizLegendItem[]>(() => {
      const items: VizLegendItem[] = [];
      const seenTypes = new Set(nodes.map((n) => n.type));
      for (const [type, label] of Object.entries(TYPE_LABELS)) {
        if (seenTypes.has(type)) {
          items.push({ color: getColor(type), label });
        }
      }
      const seenEdges = new Set(
        edges.map((e) => e.data_type).filter((d): d is string => !!d && d in EDGE_COLORS),
      );
      for (const dataType of seenEdges) {
        items.push({
          color: EDGE_COLORS[dataType],
          label: EDGE_LABELS[dataType] ?? dataType,
          shape: "line",
        });
      }
      return items;
    }, [nodes, edges]);

    useEffect(() => {
      if (!svgRef.current || !containerRef.current || nodes.length === 0)
        return;

      const width = containerRef.current.clientWidth || 800;
      const viewportH = containerRef.current.clientHeight || 500;

      // Flipped by cleanup so the particle loop below cannot outlive this draw.
      let cancelled = false;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("width", width).attr("height", viewportH);

      const g = svg.append("g");
      const defs = svg.append("defs");

      // Clear selection when clicking empty canvas
      svg.on("click", () => setSelected(null));

      // Arrow markers — one per edge colour actually in use
      const edgeColors = new Set(edges.map((e) => getEdgeColor(e.data_type)));
      edgeColors.forEach((color) => {
        defs
          .append("marker")
          .attr("id", `flow-arrow-${cssId(color)}`)
          .attr("viewBox", "0 -4 8 8")
          .attr("refX", NODE_W / 2 + 8)
          .attr("refY", 0)
          .attr("markerWidth", 5)
          .attr("markerHeight", 5)
          .attr("orient", "auto")
          .append("path")
          .attr("d", "M0,-4L8,0L0,4")
          .attr("fill", color);
      });

      // ── Position nodes into columns by backend-provided tier ──
      const columns = new Map<number, Node[]>();
      nodes.forEach((n) => {
        const t = n.tier ?? 0;
        if (!columns.has(t)) columns.set(t, []);
        columns.get(t)!.push(n);
      });
      const maxTier = Math.max(...columns.keys(), 0);
      const maxColSize = Math.max(
        ...[...columns.values()].map((c) => c.length),
        1,
      );

      const colSpacingX = NODE_W + 60;
      const nodeSpacingY = NODE_H + 28;
      const marginX = 50;
      const marginY = 40;
      const contentW = Math.max(
        width,
        (maxTier + 1) * colSpacingX + marginX * 2,
      );
      const contentH = Math.max(
        viewportH,
        maxColSize * nodeSpacingY + marginY * 2,
      );

      const positions = new Map<string, { x: number; y: number }>();
      for (let t = 0; t <= maxTier; t++) {
        const col = columns.get(t) || [];
        const colX = marginX + t * colSpacingX + colSpacingX / 2;
        const totalColH = (col.length - 1) * nodeSpacingY;
        const startY = (contentH - totalColH) / 2;
        col.forEach((n, i) =>
          positions.set(n.id, { x: colX, y: startY + i * nodeSpacingY }),
        );
      }

      // ── Edges — curved left-to-right flow ──
      edges.forEach((edge) => {
        const src = positions.get(edge.source);
        const tgt = positions.get(edge.target);
        if (!src || !tgt) return;

        const color = getEdgeColor(edge.data_type);
        const midX = (src.x + tgt.x) / 2;
        const path = g
          .append("path")
          .attr(
            "d",
            `M${src.x + NODE_W / 2},${src.y} C${midX},${src.y} ${midX},${tgt.y} ${tgt.x - NODE_W / 2},${tgt.y}`,
          )
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 2)
          .attr("stroke-opacity", 0.8)
          .attr("marker-end", `url(#flow-arrow-${cssId(color)})`);

        // Flow particles are decorative. Under reduced motion they are skipped
        // outright — this loop re-arms itself forever, so it is both a
        // vestibular trigger and a CPU/battery drain that never stops.
        if (edge.animated && !reducedMotion) {
          const pathNode = path.node();
          const totalLength = pathNode?.getTotalLength() ?? 0;
          if (totalLength > 0) {
            const particle = g
              .append("circle")
              .attr("r", 3)
              .attr("fill", color);
            const loop = () => {
              // `cancelled` is flipped by this effect's cleanup. isConnected
              // alone was not enough: on a re-render the old node can still be
              // attached for a tick, orphaning a second loop that never stops.
              if (cancelled || !pathNode!.isConnected) return;
              particle
                .transition()
                .duration(1500)
                .ease(d3.easeLinear)
                .attrTween("transform", () => (t: number) => {
                  const p = pathNode!.getPointAtLength(t * totalLength);
                  return `translate(${p.x},${p.y})`;
                })
                .on("end", loop);
            };
            loop();
          }
        }

        if (edge.label) {
          const labelY = (src.y + tgt.y) / 2 - 6;
          const text = g
            .append("text")
            .attr("x", midX)
            .attr("y", labelY)
            .attr("text-anchor", "middle")
            .attr("font-size", 11)
            .attr("fill", "hsl(var(--muted-foreground))")
            .text(edge.label);
          const bbox = (text.node() as SVGTextElement).getBBox();
          g.insert("rect", () => text.node())
            .attr("x", bbox.x - 4)
            .attr("y", bbox.y - 2)
            .attr("width", bbox.width + 8)
            .attr("height", bbox.height + 4)
            .attr("rx", 6)
            .attr("fill", "hsl(var(--card))")
            .attr("fill-opacity", 0.85);
        }
      });

      // ── Nodes ──
      nodes.forEach((node) => {
        const pos = positions.get(node.id);
        if (!pos) return;
        const color = getColor(node.type);

        const nodeGroup = g
          .append("g")
          .attr("transform", `translate(${pos.x},${pos.y})`)
          .style("cursor", "pointer");

        appendShape(
          nodeGroup,
          node.shape || "rounded_rect",
          "hsl(var(--card))",
          color,
          2,
        );

        nodeGroup
          .append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .attr("fill", "hsl(var(--foreground))")
          .attr("font-size", 11)
          .attr("font-weight", 500)
          .text(truncate(node.label));

        nodeGroup
          .on("click", (event) => {
            event.stopPropagation();
            setSelected(node);
          })
          .on("mouseenter", function () {
            d3.select(this)
              .selectAll("rect,path,polygon,ellipse")
              .attr("stroke-width", 3);
          })
          .on("mouseleave", function () {
            d3.select(this)
              .selectAll("rect,path,polygon,ellipse")
              .attr("stroke-width", 2);
          });
      });

      // Zoom + pan — behavior stays local (the scale extent and transform
      // target are chart-specific); the shell drives it through the controller.
      const zoomBehavior = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([ZOOM_MIN, ZOOM_MAX])
        .on("zoom", (event) => g.attr("transform", event.transform));
      svg.call(zoomBehavior);
      zoom.register(svgRef.current, zoomBehavior, g.node());

      // Auto-fit on first render
      const padX = 20;
      const padY = 20;
      const fitScale = Math.min(
        (width - padX * 2) / contentW,
        (viewportH - padY * 2) / contentH,
        1,
      );
      const fitX = (width - contentW * fitScale) / 2;
      const fitY = (viewportH - contentH * fitScale) / 2;
      svg.call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(fitX, fitY).scale(fitScale),
      );

      return () => {
        cancelled = true;
        zoom.register(null, null, null);
        svg.selectAll("*").remove();
      };
    }, [nodes, edges, containerSize, containerRef, zoom, reducedMotion]);

    return (
      <VizShell
        canvas={canvas}
        zoom={zoom}
        label="Data flow diagram"
        description={
          `Conceptual stages flowing left to right across ${maxTier + 1} tiers. ` +
          "Node shape indicates the kind of stage and edge color the transport. " +
          `${nodes.length} stages, ${edges.length} connections.`
        }
        legend={<VizLegend title="Flow" items={legendItems} />}
        overlay={
          selected && (
            <div className="glass-panel absolute top-3 left-3 z-20 rounded-lg px-4 py-3 text-xs max-w-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="font-semibold text-foreground">
                  {selected.label}
                </div>
                <button
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  className="text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </div>
              {selected.description && (
                <p className="text-muted-foreground mt-1.5 leading-relaxed">
                  {selected.description}
                </p>
              )}
              {!!selected.source_files?.length && (
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                  {selected.source_files.map((f) => (
                    <div
                      key={f}
                      className="text-muted-foreground truncate font-mono text-[11px]"
                    >
                      {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        }
      >
        <svg ref={svgRef} className="w-full h-full" />
      </VizShell>
    );
  },
);

/** Turns a colour string into a valid SVG id fragment. */
function cssId(color: string): string {
  return color.replace(/[^a-zA-Z0-9]/g, "");
}
