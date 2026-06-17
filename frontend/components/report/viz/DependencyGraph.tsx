"use client";

/**
 * DependencyGraph — Force-directed graph with circular nodes.
 *
 * This preserves the original ArchitectureGraph design that the user likes.
 * Nodes are circles color-coded by architectural layer, with directional
 * arrows and hover-highlight behaviour.
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

interface DependencyGraphProps {
  nodes: Node[];
  edges: Edge[];
}

const typeColorMap: Record<string, string> = {
  module: "#58a6ff",
  file: "#58a6ff",
  class: "#3fb950",
  component: "#3fb950",
  function: "#bc8cff",
  method: "#bc8cff",
  external: "#f0883e",
  package: "#f0883e",
  routes: "#58a6ff",
  models: "#3fb950",
  services: "#bc8cff",
  database: "#f0883e",
  utils: "#8b949e",
  config: "#f0883e",
  tests: "#8b949e",
  other: "#8b949e",
};

function getNodeColor(type: string): string {
  return typeColorMap[type.toLowerCase()] || "#8b949e";
}

function truncate(text: string, max = 15): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export const DependencyGraph = forwardRef<HTMLDivElement, DependencyGraphProps>(
  function DependencyGraph({ nodes, edges }, ref) {
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
      const height = containerRef.current.clientHeight || 500;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("width", width).attr("height", height);

      const g = svg.append("g");

      // Arrow marker
      svg
        .append("defs")
        .append("marker")
        .attr("id", "dep-arrowhead")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 28)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", "#30363d");

      type SimNode = d3.SimulationNodeDatum & Node;
      type SimEdge = d3.SimulationLinkDatum<SimNode> & { label?: string };

      const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
      const simEdges: SimEdge[] = edges.map((e) => ({
        source: e.source,
        target: e.target,
        label: e.label,
      }));

      const simulation = d3
        .forceSimulation<SimNode>(simNodes)
        .force(
          "link",
          d3
            .forceLink<SimNode, SimEdge>(simEdges)
            .id((d) => d.id)
            .distance(140)
        )
        .force("charge", d3.forceManyBody().strength(-400))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collide", d3.forceCollide(30));

      const link = g
        .append("g")
        .selectAll("line")
        .data(simEdges)
        .join("line")
        .attr("stroke", "#30363d")
        .attr("stroke-width", 1.5)
        .attr("marker-end", "url(#dep-arrowhead)");

      const edgeLabel = g
        .append("g")
        .selectAll("text")
        .data(simEdges.filter((e) => e.label))
        .join("text")
        .attr("font-size", 10)
        .attr("fill", "#8b949e")
        .attr("text-anchor", "middle")
        .text((d) => d.label || "");

      const node = g
        .append("g")
        .selectAll<SVGGElement, SimNode>("g")
        .data(simNodes)
        .join("g")
        .call(
          d3
            .drag<SVGGElement, SimNode>()
            .on("start", (event, d) => {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x;
              d.fy = d.y;
            })
            .on("drag", (event, d) => {
              d.fx = event.x;
              d.fy = event.y;
            })
            .on("end", (event, d) => {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null;
              d.fy = null;
            })
        );

      node
        .append("circle")
        .attr("r", 20)
        .attr("fill", (d) => getNodeColor(d.type))
        .attr("stroke", "#30363d")
        .attr("stroke-width", 2);

      node
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", 32)
        .attr("font-size", 11)
        .attr("fill", "#e6edf3")
        .text((d) => truncate(d.label));

      node
        .on("mouseenter", function (_event, d) {
          d3.select(this).select("circle").attr("stroke", "#58a6ff").attr("stroke-width", 3);
          const connected = new Set<string>();
          connected.add(d.id);
          simEdges.forEach((e) => {
            const src = typeof e.source === "object" ? (e.source as SimNode).id : String(e.source);
            const tgt = typeof e.target === "object" ? (e.target as SimNode).id : String(e.target);
            if (src === d.id) connected.add(tgt);
            if (tgt === d.id) connected.add(src);
          });
          node.style("opacity", (n) => (connected.has(n.id) ? 1 : 0.3));
          link.style("opacity", (l) => {
            const src = typeof l.source === "object" ? (l.source as SimNode).id : String(l.source);
            const tgt = typeof l.target === "object" ? (l.target as SimNode).id : String(l.target);
            return connected.has(src) && connected.has(tgt) ? 1 : 0.15;
          });
        })
        .on("mouseleave", function () {
          node.style("opacity", 1);
          link.style("opacity", 1);
          d3.select(this).select("circle").attr("stroke", "#30363d").attr("stroke-width", 2);
        });

      simulation.on("tick", () => {
        link
          .attr("x1", (d) => (d.source as SimNode).x!)
          .attr("y1", (d) => (d.source as SimNode).y!)
          .attr("x2", (d) => (d.target as SimNode).x!)
          .attr("y2", (d) => (d.target as SimNode).y!);

        edgeLabel
          .attr("x", (d) => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
          .attr("y", (d) => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2);

        node.attr("transform", (d) => `translate(${d.x},${d.y})`);
      });

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on("zoom", (event) => {
          g.attr("transform", event.transform);
        });
      svg.call(zoom);

      return () => {
        simulation.stop();
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
