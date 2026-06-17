/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useEffect, useState } from "react";
import * as d3 from "d3";

interface TreemapNode {
  name: string;
  value?: number;
  children?: TreemapNode[];
}

interface TreemapVizProps {
  data: TreemapNode;
}

export function TreemapViz({ data }: TreemapVizProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

  // Measure container on mount + track resizes
  useEffect(() => {
    if (!containerRef.current) return;
    setDimensions({
      width: containerRef.current.clientWidth || 800,
      height: containerRef.current.clientHeight || 500,
    });
    let timer: NodeJS.Timeout;
    const observer = new ResizeObserver((entries) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const rect = entries[0]?.contentRect;
        if (rect) setDimensions({ width: rect.width, height: rect.height });
      }, 100);
    });
    observer.observe(containerRef.current);
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!svgRef.current || !data) return;

    const { width, height } = dimensions;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    // Build hierarchy
    const hierarchy = d3
      .hierarchy(data)
      .sum((d) => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    // Treemap layout
    d3.treemap<TreemapNode>()
      .size([width, height])
      .padding(2)
      .round(true)(hierarchy);

    const leaves = hierarchy.leaves();
    const maxValue = d3.max(leaves, (d) => d.value) || 1;

    // Color scale: dark → orange for high complexity
    const colorScale = d3
      .scaleSequential()
      .domain([0, maxValue])
      .interpolator(d3.interpolateRgb("#161b22", "#f0883e"));

    const tooltip = d3.select(tooltipRef.current);

    // Cells
    const cell = svg
      .selectAll("g")
      .data(leaves)
      .join("g")
      .attr("class", "viz-node")
      .attr(
        "transform",
        (d: any) => `translate(${d.x0},${d.y0})`
      );

    // Rect
    cell
      .append("rect")
      .attr("width", (d: any) => Math.max(0, d.x1 - d.x0))
      .attr("height", (d: any) => Math.max(0, d.y1 - d.y0))
      .attr("fill", (d: any) => colorScale(d.value || 0))
      .attr("stroke", "#30363d")
      .attr("stroke-width", 1)
      .attr("rx", 2)
      .on("mouseenter", function (event, d: any) {
        d3.select(this).style("filter", "brightness(1.3)");
        tooltip
          .style("display", "block")
          .style("left", `${event.offsetX + 10}px`)
          .style("top", `${event.offsetY - 30}px`)
          .html(
            `<strong>${d.data.name}</strong><br/>Value: ${d.value}`
          );
      })
      .on("mousemove", function (event) {
        tooltip
          .style("left", `${event.offsetX + 10}px`)
          .style("top", `${event.offsetY - 30}px`);
      })
      .on("mouseleave", function () {
        d3.select(this).style("filter", null);
        tooltip.style("display", "none");
      });

    // Name labels (only if cell is large enough)
    cell
      .filter((d: any) => (d.x1 - d.x0) > 40 && (d.y1 - d.y0) > 20)
      .append("text")
      .attr("x", 4)
      .attr("y", 14)
      .attr("fill", "#e6edf3")
      .attr("font-size", 11)
      .attr("pointer-events", "none")
      .each(function (d: any) {
        const cellWidth = d.x1 - d.x0 - 8;
        const text = d3.select(this);
        text.text(d.data.name);
        // Truncate if too wide
        while (
          (this as SVGTextElement).getComputedTextLength() > cellWidth &&
          text.text().length > 1
        ) {
          text.text(text.text().slice(0, -2) + "…");
        }
      });

    // Value labels
    cell
      .filter((d: any) => (d.x1 - d.x0) > 40 && (d.y1 - d.y0) > 34)
      .append("text")
      .attr("x", 4)
      .attr("y", 26)
      .attr("fill", "#8b949e")
      .attr("font-size", 10)
      .attr("pointer-events", "none")
      .text((d: any) => String(d.value || ""));

    return () => {
      svg.selectAll("*").remove();
    };
  }, [data, dimensions]);

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden relative">
      <svg ref={svgRef} className="w-full h-full" />
      <div
        ref={tooltipRef}
        className="viz-tooltip"
        style={{ display: "none" }}
      />
    </div>
  );
}
