/* eslint-disable @typescript-eslint/no-explicit-any */
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

import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
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
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    useImperativeHandle(ref, () => containerRef.current!);

    // Track container dimensions for re-rendering on resize / sidebar toggle
    useEffect(() => {
      if (!containerRef.current) return;
      setContainerSize({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
      let resizeTimer: NodeJS.Timeout;
      const observer = new ResizeObserver((entries) => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const rect = entries[0]?.contentRect;
          if (rect) setContainerSize({ width: rect.width, height: rect.height });
        }, 150);
      });
      observer.observe(containerRef.current);
      return () => { observer.disconnect(); clearTimeout(resizeTimer); };
    }, []);

    useEffect(() => {
      if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

      const width = containerRef.current.clientWidth || 800;
      const viewportH = containerRef.current.clientHeight || 500;
      const pillW = 120;
      const pillH = 32;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("width", width).attr("height", viewportH);

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

      // ── Assign layers (depth) via BFS from entry/root nodes ──
      const adjacency = new Map<string, string[]>();
      const reverseAdj = new Map<string, string[]>();
      edges.forEach((e) => {
        if (!adjacency.has(e.source)) adjacency.set(e.source, []);
        adjacency.get(e.source)!.push(e.target);
        if (!reverseAdj.has(e.target)) reverseAdj.set(e.target, []);
        reverseAdj.get(e.target)!.push(e.source);
      });

      const nodeDepth = new Map<string, number>();
      const entryNodes = nodes.filter((n) => n.type === "entry_point");
      const queue: Array<{ id: string; depth: number }> = [];

      // Find root nodes: entry_points first, then nodes with no incoming edges
      if (entryNodes.length > 0) {
        entryNodes.forEach((n) => queue.push({ id: n.id, depth: 0 }));
      } else {
        const hasIncoming = new Set(edges.map((e) => e.target));
        nodes.forEach((n) => {
          if (!hasIncoming.has(n.id)) queue.push({ id: n.id, depth: 0 });
        });
        // Fallback: use the first node
        if (queue.length === 0 && nodes.length > 0) {
          queue.push({ id: nodes[0].id, depth: 0 });
        }
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

      // Assign remaining unvisited nodes
      nodes.forEach((n) => {
        if (!nodeDepth.has(n.id)) nodeDepth.set(n.id, 0);
      });

      let maxDepth = Math.max(...nodeDepth.values(), 0);

      // ── CRITICAL FIX: If all nodes ended up at depth 0, distribute them
      //    into synthetic columns so the graph actually flows left-to-right ──
      if (maxDepth === 0 && nodes.length > 1) {
        const visited = new Set<string>();
        const roots = nodes.filter((n) => !(reverseAdj.get(n.id)?.length));
        const synthQueue: Array<{ id: string; depth: number }> = [];

        if (roots.length > 0) {
          roots.forEach((n) => synthQueue.push({ id: n.id, depth: 0 }));
        } else {
          synthQueue.push({ id: nodes[0].id, depth: 0 });
        }

        nodeDepth.clear();
        while (synthQueue.length > 0) {
          const { id, depth } = synthQueue.shift()!;
          if (visited.has(id)) continue;
          visited.add(id);
          nodeDepth.set(id, depth);
          (adjacency.get(id) || []).forEach((target) => {
            if (!visited.has(target)) {
              synthQueue.push({ id: target, depth: depth + 1 });
            }
          });
        }
        nodes.forEach((n) => {
          if (!nodeDepth.has(n.id)) nodeDepth.set(n.id, 0);
        });
        maxDepth = Math.max(...nodeDepth.values(), 0);

        if (maxDepth === 0 && nodes.length > 1) {
          const cols = Math.min(nodes.length, 4);
          nodes.forEach((n, i) => {
            nodeDepth.set(n.id, i % cols);
          });
          maxDepth = cols - 1;
        }
      }

      // ── Position nodes in columns (left-to-right) ──
      const columns = new Map<number, Node[]>();
      nodes.forEach((n) => {
        const d = nodeDepth.get(n.id) || 0;
        if (!columns.has(d)) columns.set(d, []);
        columns.get(d)!.push(n);
      });

      // Find the tallest column to compute needed dimensions
      const maxColSize = Math.max(...[...columns.values()].map((c) => c.length), 1);
      const nodeSpacingY = pillH + 24; // vertical gap between pills in same column
      const colSpacingX = pillW + 40;  // horizontal gap between columns (pill width + breathing room)
      const marginX = 40;
      const marginY = 40;

      // Content dimensions — expand beyond viewport if needed, auto-fit will scale down
      const contentW = Math.max(width, (maxDepth + 1) * colSpacingX + marginX * 2);
      const contentH = Math.max(viewportH, maxColSize * nodeSpacingY + marginY * 2);
      const nodePositions = new Map<string, { x: number; y: number }>();

      for (let d = 0; d <= maxDepth; d++) {
        const col = columns.get(d) || [];
        const colX = marginX + d * colSpacingX + colSpacingX / 2;
        const totalColH = (col.length - 1) * nodeSpacingY;
        const startY = (contentH - totalColH) / 2;

        col.forEach((n, i) => {
          nodePositions.set(n.id, { x: colX, y: startY + i * nodeSpacingY });
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
        grad.append("stop").attr("offset", "0%").attr("stop-color", srcColor).attr("stop-opacity", 0.8);
        grad.append("stop").attr("offset", "100%").attr("stop-color", tgtColor).attr("stop-opacity", 0.8);

        const midX = (src.x + tgt.x) / 2;

        const path = g
          .append("path")
          .attr(
            "d",
            `M${src.x + pillW / 2},${src.y} C${midX},${src.y} ${midX},${tgt.y} ${tgt.x - pillW / 2},${tgt.y}`
          )
          .attr("fill", "none")
          .attr("stroke", `url(#${gradId})`)
          .attr("stroke-width", 2.5)
          .attr("marker-end", "url(#flow-arrow)");

        // Animated dash for flow effect
        path
          .attr("stroke-dasharray", `6 4`)
          .attr("stroke-dashoffset", 0);

        // CSS animation for flowing dashes
        path
          .style("animation", `flowDash 1.5s linear infinite`);
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
        .scaleExtent([0.15, 3])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        });
      svg.call(zoom);

      // Auto-fit: always scale and center content into the viewport
      const padX = 20;
      const padY = 20;
      const fitScaleX = (width - padX * 2) / contentW;
      const fitScaleY = (viewportH - padY * 2) / contentH;
      const fitScale = Math.min(fitScaleX, fitScaleY, 1);
      const fitX = (width - contentW * fitScale) / 2;
      const fitY = (viewportH - contentH * fitScale) / 2;
      svg.call(
        zoom.transform as any,
        d3.zoomIdentity.translate(fitX, fitY).scale(fitScale)
      );

      return () => {
        svg.selectAll("*").remove();
      };
    }, [nodes, edges, containerSize]);

    return (
      <div ref={containerRef} className="w-full h-full overflow-hidden">
        <svg ref={svgRef} className="w-full h-full" />
      </div>
    );
  }
);
