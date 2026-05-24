"use client";

/**
 * DataFlowGraph — Sankey-inspired left-to-right flow layout.
 *
 * Designed to look like a pipeline/flow diagram:
 * - Pill/capsule-shaped nodes
 * - Entry points are visually prominent (larger, glowing green)
 * - Curved gradient edges with animated dash patterns
 * - Horizontal left-to-right orientation emphasising data flow
 */

import { useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import * as d3 from "d3";

interface Node {
  id: string;
  label: string;
  type: string;
}

interface Edge {
  source: string;
  target: string;
  label?: string;
}

interface DataFlowGraphProps {
  nodes: Node[];
  edges: Edge[];
}

const flowColors: Record<string, string> = {
  entry_point: "#22c55e",
  routes:      "#4ecdc4",
  services:    "#a78bfa",
  models:      "#4ade80",
  database:    "#fbbf24",
  utils:       "#60a5fa",
  config:      "#f97316",
  tests:       "#9ca3af",
  other:       "#8b949e",
};

function getColor(type: string): string {
  return flowColors[type.toLowerCase()] || flowColors.other;
}

function truncate(text: string, max = 16): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export const DataFlowGraph = forwardRef<HTMLDivElement, DataFlowGraphProps>(
  function DataFlowGraph({ nodes, edges }, ref) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => containerRef.current!);

    useEffect(() => {
      if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

      const width = containerRef.current.clientWidth || 800;
      const height = 450;
      const pillW = 130;
      const pillH = 32;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("width", width).attr("height", height);

      const g = svg.append("g");

      // Defs: gradients + animated dash marker + glow filter
      const defs = svg.append("defs");

      // Glow filter for entry points
      const filter = defs.append("filter").attr("id", "flow-glow");
      filter
        .append("feGaussianBlur")
        .attr("stdDeviation", "3")
        .attr("result", "blur");
      filter
        .append("feMerge")
        .selectAll("feMergeNode")
        .data(["blur", "SourceGraphic"])
        .join("feMergeNode")
        .attr("in", (d) => d);

      // Arrow marker
      defs
        .append("marker")
        .attr("id", "flow-arrow")
        .attr("viewBox", "0 -4 8 8")
        .attr("refX", 8)
        .attr("refY", 0)
        .attr("markerWidth", 5)
        .attr("markerHeight", 5)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L8,0L0,4")
        .attr("fill", "#6b7280");

      // ── Assign layers (depth) via BFS from entry points ──
      const adjacency = new Map<string, string[]>();
      edges.forEach((e) => {
        if (!adjacency.has(e.source)) adjacency.set(e.source, []);
        adjacency.get(e.source)!.push(e.target);
      });

      const nodeDepth = new Map<string, number>();
      const entryNodes = nodes.filter((n) => n.type === "entry_point");
      const queue: Array<{ id: string; depth: number }> = [];

      // If no entry points detected, use nodes with no incoming edges
      if (entryNodes.length === 0) {
        const hasIncoming = new Set(edges.map((e) => e.target));
        nodes.forEach((n) => {
          if (!hasIncoming.has(n.id)) queue.push({ id: n.id, depth: 0 });
        });
        // Fallback: just use the first node
        if (queue.length === 0 && nodes.length > 0) {
          queue.push({ id: nodes[0].id, depth: 0 });
        }
      } else {
        entryNodes.forEach((n) => queue.push({ id: n.id, depth: 0 }));
      }

      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        if (nodeDepth.has(id)) continue;
        nodeDepth.set(id, depth);
        (adjacency.get(id) || []).forEach((target) => {
          if (!nodeDepth.has(target)) {
            queue.push({ id: target, depth: depth + 1 });
          }
        });
      }

      // Assign remaining unvisited nodes to depth 0
      nodes.forEach((n) => {
        if (!nodeDepth.has(n.id)) nodeDepth.set(n.id, 0);
      });

      const maxDepth = Math.max(...nodeDepth.values(), 0);

      // ── Position nodes in columns (left-to-right) ──
      const columns = new Map<number, Node[]>();
      nodes.forEach((n) => {
        const d = nodeDepth.get(n.id) || 0;
        if (!columns.has(d)) columns.set(d, []);
        columns.get(d)!.push(n);
      });

      const colWidth = maxDepth > 0 ? (width - 80) / (maxDepth + 1) : width / 2;
      const nodePositions = new Map<string, { x: number; y: number }>();

      for (let d = 0; d <= maxDepth; d++) {
        const col = columns.get(d) || [];
        const colX = 40 + d * colWidth + colWidth / 2;
        const spacing = Math.min(60, (height - 40) / (col.length + 1));
        const startY = (height - col.length * spacing) / 2;

        col.forEach((n, i) => {
          nodePositions.set(n.id, { x: colX, y: startY + i * spacing + spacing / 2 });
        });
      }

      // ── Draw edges — curved horizontal flow ──
      let edgeIdx = 0;
      edges.forEach((edge) => {
        const src = nodePositions.get(edge.source);
        const tgt = nodePositions.get(edge.target);
        if (!src || !tgt) return;

        const srcColor = getColor(
          nodes.find((n) => n.id === edge.source)?.type || "other"
        );
        const tgtColor = getColor(
          nodes.find((n) => n.id === edge.target)?.type || "other"
        );

        // Unique gradient per edge
        const gradId = `flow-grad-${edgeIdx++}`;
        const grad = defs
          .append("linearGradient")
          .attr("id", gradId)
          .attr("x1", "0%")
          .attr("y1", "0%")
          .attr("x2", "100%")
          .attr("y2", "0%");
        grad.append("stop").attr("offset", "0%").attr("stop-color", srcColor).attr("stop-opacity", 0.6);
        grad.append("stop").attr("offset", "100%").attr("stop-color", tgtColor).attr("stop-opacity", 0.6);

        const midX = (src.x + tgt.x) / 2;

        const path = g
          .append("path")
          .attr(
            "d",
            `M${src.x + pillW / 2},${src.y} C${midX},${src.y} ${midX},${tgt.y} ${tgt.x - pillW / 2},${tgt.y}`
          )
          .attr("fill", "none")
          .attr("stroke", `url(#${gradId})`)
          .attr("stroke-width", 2)
          .attr("marker-end", "url(#flow-arrow)");

        // Animated dash for flow effect
        const totalLen = (path.node() as SVGPathElement)?.getTotalLength?.() || 200;
        path
          .attr("stroke-dasharray", `6 4`)
          .attr("stroke-dashoffset", 0);

        // CSS animation for flowing dashes
        path
          .style("animation", `flowDash 1.5s linear infinite`)
          .style("--total-len", `${totalLen}`);
      });

      // Inject CSS keyframes for the dash animation
      if (!document.getElementById("flow-dash-style")) {
        const style = document.createElement("style");
        style.id = "flow-dash-style";
        style.textContent = `
          @keyframes flowDash {
            to { stroke-dashoffset: -20; }
          }
        `;
        document.head.appendChild(style);
      }

      // ── Draw nodes — pill/capsule shapes ──
      nodes.forEach((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return;
        const color = getColor(node.type);
        const isEntry = node.type === "entry_point";

        const nodeGroup = g
          .append("g")
          .attr("transform", `translate(${pos.x},${pos.y})`)
          .style("cursor", "pointer");

        // Pill shape
        nodeGroup
          .append("rect")
          .attr("x", -pillW / 2)
          .attr("y", -pillH / 2)
          .attr("width", pillW)
          .attr("height", pillH)
          .attr("rx", pillH / 2) // Fully rounded ends → pill shape
          .attr("fill", isEntry ? "#052e16" : "#111827")
          .attr("stroke", color)
          .attr("stroke-width", isEntry ? 2 : 1.5)
          .attr("fill-opacity", 0.9)
          .attr("filter", isEntry ? "url(#flow-glow)" : null);

        // Direction indicator dot on left side
        nodeGroup
          .append("circle")
          .attr("cx", -pillW / 2 + 14)
          .attr("cy", 0)
          .attr("r", 4)
          .attr("fill", color)
          .attr("fill-opacity", isEntry ? 1 : 0.6);

        // Label
        nodeGroup
          .append("text")
          .attr("text-anchor", "middle")
          .attr("x", 6) // Slightly right of center to account for dot
          .attr("dy", "0.35em")
          .attr("fill", isEntry ? "#86efac" : "#d1d5db")
          .attr("font-size", 11)
          .attr("font-weight", isEntry ? 600 : 400)
          .text(truncate(node.label));

        // Hover effect
        nodeGroup
          .on("mouseenter", function () {
            d3.select(this)
              .select("rect")
              .transition()
              .duration(150)
              .attr("stroke-width", isEntry ? 3 : 2.5)
              .attr("fill-opacity", 1);
          })
          .on("mouseleave", function () {
            d3.select(this)
              .select("rect")
              .transition()
              .duration(150)
              .attr("stroke-width", isEntry ? 2 : 1.5)
              .attr("fill-opacity", 0.9);
          });
      });

      // Zoom + pan
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        });
      svg.call(zoom);

      return () => {
        svg.selectAll("*").remove();
      };
    }, [nodes, edges]);

    return (
      <div ref={containerRef} className="w-full overflow-hidden">
        <svg ref={svgRef} className="w-full" style={{ minHeight: 450 }} />
      </div>
    );
  }
);
