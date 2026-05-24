"use client";

/**
 * ArchitectureGraph — Hierarchical layered layout with rounded rectangles.
 *
 * Redesigned to look like an architecture blueprint:
 * - Nodes are rounded rectangles grouped into swim-lanes by layer
 * - Curved Bézier edges with directional arrows
 * - Pastel color palette distinct from the dependency graph
 * - Top-to-bottom flow emphasising hierarchy
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

interface ArchitectureGraphProps {
  nodes: Node[];
  edges: Edge[];
}

// Pastel palette — visually distinct from the dependency graph neons
const layerColors: Record<string, { bg: string; border: string; text: string }> = {
  routes:   { bg: "#1a3a4a", border: "#4ecdc4", text: "#a8e6cf" },
  services: { bg: "#2d1b4e", border: "#a78bfa", text: "#c4b5fd" },
  models:   { bg: "#1a3320", border: "#4ade80", text: "#86efac" },
  database: { bg: "#3b2a1a", border: "#fbbf24", text: "#fde68a" },
  utils:    { bg: "#1e2a3a", border: "#60a5fa", text: "#93c5fd" },
  config:   { bg: "#3a2a1e", border: "#f97316", text: "#fdba74" },
  tests:    { bg: "#2a2a2a", border: "#9ca3af", text: "#d1d5db" },
  module:   { bg: "#1e2640", border: "#818cf8", text: "#a5b4fc" },
  other:    { bg: "#1c1c2e", border: "#8b949e", text: "#c9d1d9" },
};

function getLayerStyle(type: string) {
  return layerColors[type.toLowerCase()] || layerColors.other;
}

// Order layers top to bottom for the swim-lane layout
const layerOrder = ["routes", "services", "models", "database", "utils", "config", "tests", "module", "other"];

function truncate(text: string, max = 18): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export const ArchitectureGraph = forwardRef<HTMLDivElement, ArchitectureGraphProps>(
  function ArchitectureGraph({ nodes, edges }, ref) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => containerRef.current!);

    useEffect(() => {
      if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

      const width = containerRef.current.clientWidth || 800;
      const height = 500;
      const nodeW = 140;
      const nodeH = 36;
      const layerPadding = 24;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("width", width).attr("height", height);

      const g = svg.append("g");

      // Arrow marker — styled differently from dependency graph
      const defs = svg.append("defs");
      defs
        .append("marker")
        .attr("id", "arch-arrow")
        .attr("viewBox", "0 -4 8 8")
        .attr("refX", 8)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L8,0L0,4")
        .attr("fill", "#4b5563");

      // Group nodes by layer
      const groups = new Map<string, Node[]>();
      nodes.forEach((n) => {
        const layer = n.type?.toLowerCase() || "other";
        if (!groups.has(layer)) groups.set(layer, []);
        groups.get(layer)!.push(n);
      });

      // Sort groups by layer order
      const sortedLayers = [...groups.keys()].sort(
        (a, b) => (layerOrder.indexOf(a) === -1 ? 99 : layerOrder.indexOf(a)) -
                   (layerOrder.indexOf(b) === -1 ? 99 : layerOrder.indexOf(b))
      );

      // Position nodes in swim-lanes
      const nodePositions = new Map<string, { x: number; y: number }>();
      let currentY = 40;

      sortedLayers.forEach((layer) => {
        const layerNodes = groups.get(layer)!;
        const style = getLayerStyle(layer);
        const laneW = width - 40;
        const nodesPerRow = Math.max(1, Math.floor(laneW / (nodeW + 16)));
        const rows = Math.ceil(layerNodes.length / nodesPerRow);
        const laneH = rows * (nodeH + 12) + layerPadding * 2 + 24;

        // Swim-lane background
        g.append("rect")
          .attr("x", 20)
          .attr("y", currentY)
          .attr("width", laneW)
          .attr("height", laneH)
          .attr("rx", 12)
          .attr("fill", style.bg)
          .attr("stroke", style.border)
          .attr("stroke-width", 1)
          .attr("stroke-opacity", 0.25)
          .attr("fill-opacity", 0.4);

        // Lane label
        g.append("text")
          .attr("x", 36)
          .attr("y", currentY + 20)
          .attr("fill", style.border)
          .attr("font-size", 11)
          .attr("font-weight", 600)
          .attr("letter-spacing", "0.05em")
          .text(layer.toUpperCase());

        // Position each node inside the lane
        layerNodes.forEach((node, i) => {
          const row = Math.floor(i / nodesPerRow);
          const col = i % nodesPerRow;
          const totalCols = Math.min(layerNodes.length - row * nodesPerRow, nodesPerRow);
          const startX = 20 + (laneW - totalCols * (nodeW + 16)) / 2;
          const x = startX + col * (nodeW + 16) + nodeW / 2;
          const y = currentY + layerPadding + 28 + row * (nodeH + 12) + nodeH / 2;
          nodePositions.set(node.id, { x, y });
        });

        currentY += laneH + 12;
      });

      // Adjust SVG height
      svg.attr("height", Math.max(height, currentY + 20));

      // Draw edges — curved Bézier
      edges.forEach((edge) => {
        const src = nodePositions.get(edge.source);
        const tgt = nodePositions.get(edge.target);
        if (!src || !tgt) return;

        const midY = (src.y + tgt.y) / 2;

        g.append("path")
          .attr("d", `M${src.x},${src.y + nodeH / 2} C${src.x},${midY} ${tgt.x},${midY} ${tgt.x},${tgt.y - nodeH / 2}`)
          .attr("fill", "none")
          .attr("stroke", "#4b5563")
          .attr("stroke-width", 1.5)
          .attr("stroke-opacity", 0.6)
          .attr("marker-end", "url(#arch-arrow)");
      });

      // Draw node rectangles
      nodes.forEach((node) => {
        const pos = nodePositions.get(node.id);
        if (!pos) return;
        const style = getLayerStyle(node.type);

        const nodeGroup = g.append("g")
          .attr("transform", `translate(${pos.x},${pos.y})`)
          .style("cursor", "pointer");

        // Rounded rectangle
        nodeGroup
          .append("rect")
          .attr("x", -nodeW / 2)
          .attr("y", -nodeH / 2)
          .attr("width", nodeW)
          .attr("height", nodeH)
          .attr("rx", 8)
          .attr("fill", style.bg)
          .attr("stroke", style.border)
          .attr("stroke-width", 1.5)
          .attr("fill-opacity", 0.9);

        // Label
        nodeGroup
          .append("text")
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .attr("fill", style.text)
          .attr("font-size", 11)
          .attr("font-weight", 500)
          .text(truncate(node.label));

        // Hover effect
        nodeGroup
          .on("mouseenter", function () {
            d3.select(this).select("rect")
              .transition().duration(150)
              .attr("stroke-width", 2.5)
              .attr("fill-opacity", 1);
          })
          .on("mouseleave", function () {
            d3.select(this).select("rect")
              .transition().duration(150)
              .attr("stroke-width", 1.5)
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
        <svg ref={svgRef} className="w-full" style={{ minHeight: 500 }} />
      </div>
    );
  }
);
