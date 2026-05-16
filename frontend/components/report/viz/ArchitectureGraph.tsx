"use client";

import { useRef, useEffect } from "react";
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
  title?: string;
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
};

function getNodeColor(type: string): string {
  return typeColorMap[type.toLowerCase()] || "#8b949e";
}

function truncate(text: string, max = 15): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export function ArchitectureGraph({ nodes, edges }: ArchitectureGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || nodes.length === 0) return;

    const width = containerRef.current.clientWidth || 800;
    const height = 400;

    // Clear previous render
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    svg.attr("width", width).attr("height", height);

    // Root group for zoom/pan
    const g = svg.append("g");

    // Arrow marker
    svg
      .append("defs")
      .append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 28)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#30363d");

    // Build simulation data — deep copy nodes/edges so D3 can mutate them
    type SimNode = d3.SimulationNodeDatum & Node;
    type SimEdge = d3.SimulationLinkDatum<SimNode> & { label?: string };

    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const simEdges: SimEdge[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      label: e.label,
    }));

    // Simulation
    const simulation = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimEdge>(simEdges)
          .id((d) => d.id)
          .distance(120)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(width / 2, height / 2));

    // Edge lines
    const link = g
      .append("g")
      .selectAll("line")
      .data(simEdges)
      .join("line")
      .attr("class", "viz-link")
      .attr("stroke", "#30363d")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)");

    // Edge labels
    const edgeLabel = g
      .append("g")
      .selectAll("text")
      .data(simEdges.filter((e) => e.label))
      .join("text")
      .attr("font-size", 10)
      .attr("fill", "#8b949e")
      .attr("text-anchor", "middle")
      .text((d) => d.label || "");

    // Node groups
    const node = g
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(simNodes)
      .join("g")
      .attr("class", "viz-node")
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

    // Node circles
    node
      .append("circle")
      .attr("r", 20)
      .attr("fill", (d) => getNodeColor(d.type))
      .attr("stroke", "#30363d")
      .attr("stroke-width", 2);

    // Node labels
    node
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", 32)
      .attr("font-size", 11)
      .attr("fill", "#e6edf3")
      .text((d) => truncate(d.label));

    // Hover interactions
    node
      .on("mouseenter", function (_event, d) {
        // Highlight hovered node
        d3.select(this).select("circle").attr("stroke", "#58a6ff").attr("stroke-width", 3);

        // Get connected node IDs
        const connected = new Set<string>();
        connected.add(d.id);
        simEdges.forEach((e) => {
          const src = typeof e.source === "object" ? (e.source as SimNode).id : String(e.source);
          const tgt = typeof e.target === "object" ? (e.target as SimNode).id : String(e.target);
          if (src === d.id) connected.add(tgt);
          if (tgt === d.id) connected.add(src);
        });

        // Dim non-connected nodes
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

    // Tick
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

    // Zoom + pan
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    svg.call(zoom);

    // Cleanup
    return () => {
      simulation.stop();
      svg.selectAll("*").remove();
    };
  }, [nodes, edges]);

  return (
    <div ref={containerRef} className="w-full overflow-hidden">
      <svg ref={svgRef} className="w-full" style={{ minHeight: 400 }} />
    </div>
  );
}
