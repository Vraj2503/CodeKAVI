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
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";
import * as d3 from "d3";
import { catVar, inkDimVar } from "@/lib/viz/tokens";

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
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [selected, setSelected] = useState<Node | null>(null);

    const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(
      null,
    );
    const gRef = useRef<d3.Selection<
      SVGGElement,
      unknown,
      null,
      undefined
    > | null>(null);

    useImperativeHandle(ref, () => containerRef.current!);

    // Track container dimensions for re-rendering on resize / sidebar toggle
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
      let timer: NodeJS.Timeout;
      const observer = new ResizeObserver((entries) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const rect = entries[0]?.contentRect;
          if (rect)
            setContainerSize({ width: rect.width, height: rect.height });
        }, 150);
      });
      observer.observe(el);
      return () => {
        observer.disconnect();
        clearTimeout(timer);
      };
    }, []);

    useEffect(() => {
      if (!svgRef.current || !containerRef.current || nodes.length === 0)
        return;

      const width = containerRef.current.clientWidth || 800;
      const viewportH = containerRef.current.clientHeight || 500;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("width", width).attr("height", viewportH);

      const g = svg.append("g");
      gRef.current = g;
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

        if (edge.animated) {
          const pathNode = path.node();
          const totalLength = pathNode?.getTotalLength() ?? 0;
          if (totalLength > 0) {
            const particle = g
              .append("circle")
              .attr("r", 3)
              .attr("fill", color);
            const loop = () => {
              if (!pathNode!.isConnected) return;
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

      // Zoom + pan
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 3])
        .on("zoom", (event) => g.attr("transform", event.transform));
      svg.call(zoom);
      zoomRef.current = zoom;

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
        zoom.transform,
        d3.zoomIdentity.translate(fitX, fitY).scale(fitScale),
      );

      return () => {
        svg.selectAll("*").remove();
      };
    }, [nodes, edges, containerSize]);

    const handleZoomBy = useCallback((factor: number) => {
      if (!svgRef.current || !zoomRef.current) return;
      d3.select(svgRef.current)
        .transition()
        .duration(200)
        .call(zoomRef.current.scaleBy, factor);
    }, []);

    const handleFitToView = useCallback(() => {
      const svgEl = svgRef.current;
      const gEl = gRef.current?.node();
      if (!svgEl || !gEl || !zoomRef.current) return;
      const bbox = gEl.getBBox();
      if (bbox.width === 0 || bbox.height === 0) return;
      const W = svgEl.clientWidth || 800;
      const H = svgEl.clientHeight || 500;
      const scale = Math.max(
        0.15,
        Math.min(3, Math.min(W / bbox.width, H / bbox.height) * 0.85),
      );
      const tx = W / 2 - scale * (bbox.x + bbox.width / 2);
      const ty = H / 2 - scale * (bbox.y + bbox.height / 2);
      d3.select(svgEl)
        .transition()
        .duration(300)
        .call(
          zoomRef.current.transform,
          d3.zoomIdentity.translate(tx, ty).scale(scale),
        );
    }, []);

    return (
      <div
        ref={containerRef}
        className="w-full h-full overflow-hidden relative"
      >
        <svg ref={svgRef} className="w-full h-full" />

        {/* ── Zoom controls (bottom-right) ── */}
        <div className="absolute bottom-3 right-3 z-10 flex flex-col rounded-lg overflow-hidden border border-border bg-card/90 backdrop-blur-sm shadow-lg">
          <button
            onClick={() => handleZoomBy(1.3)}
            aria-label="Zoom in"
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            +
          </button>
          <button
            onClick={() => handleZoomBy(1 / 1.3)}
            aria-label="Zoom out"
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-t border-border"
          >
            −
          </button>
          <button
            onClick={handleFitToView}
            aria-label="Fit to view"
            className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-t border-border"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
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

        {/* ── Selected node popover (click for source files + description) ── */}
        {selected && (
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
        )}
      </div>
    );
  },
);

/** Turns a colour string into a valid SVG id fragment. */
function cssId(color: string): string {
  return color.replace(/[^a-zA-Z0-9]/g, "");
}
