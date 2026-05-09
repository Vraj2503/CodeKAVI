import { useRef, useEffect } from "react";
import * as d3 from "d3";

interface MindmapNode {
  id: string;
  label: string;
  children?: MindmapNode[];
}

interface RadialMindmapProps {
  root: MindmapNode;
}

const depthColors = ["#58a6ff", "#3fb950", "#bc8cff", "#f0883e"];

function getDepthColor(depth: number): string {
  return depthColors[Math.min(depth, depthColors.length - 1)];
}

export function RadialMindmap({ root }: RadialMindmapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || !root) return;

    const containerWidth = containerRef.current.clientWidth || 600;
    const size = Math.min(containerWidth, 600);
    const radius = size / 2 - 80;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", size).attr("height", size);

    const g = svg
      .append("g")
      .attr("transform", `translate(${size / 2},${size / 2})`);

    // Build hierarchy
    const hierarchy = d3.hierarchy(root);
    const treeLayout = d3
      .tree<MindmapNode>()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth);

    const treeData = treeLayout(hierarchy);

    // Radial link generator
    const linkGen = d3
      .linkRadial<d3.HierarchyPointLink<MindmapNode>, d3.HierarchyPointNode<MindmapNode>>()
      .angle((d) => d.x)
      .radius((d) => d.y);

    // Links
    g.append("g")
      .attr("fill", "none")
      .attr("stroke", "#30363d")
      .attr("stroke-width", 1.5)
      .selectAll("path")
      .data(treeData.links())
      .join("path")
      .attr("class", "viz-link")
      .attr("d", linkGen as any);

    // Nodes
    const nodeGroup = g
      .append("g")
      .selectAll("g")
      .data(treeData.descendants())
      .join("g")
      .attr("class", "viz-node")
      .attr(
        "transform",
        (d) => `rotate(${(d.x * 180) / Math.PI - 90}) translate(${d.y},0)`
      );

    nodeGroup
      .append("circle")
      .attr("r", (d) => (d.depth === 0 ? 8 : 5))
      .attr("fill", (d) => getDepthColor(d.depth))
      .attr("stroke", "#30363d")
      .attr("stroke-width", 1);

    // Labels
    nodeGroup
      .append("text")
      .attr("dy", "0.31em")
      .attr("x", (d) => (d.x < Math.PI === !d.children ? 10 : -10))
      .attr("text-anchor", (d) =>
        d.x < Math.PI === !d.children ? "start" : "end"
      )
      .attr("transform", (d) => (d.x >= Math.PI ? "rotate(180)" : null))
      .attr("fill", "#c9d1d9")
      .attr("font-size", 11)
      .text((d) => {
        const label = d.data.label || d.data.id;
        return label.length > 20 ? label.slice(0, 20) + "…" : label;
      });

    // Zoom + pan
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", `translate(${size / 2 + event.transform.x},${size / 2 + event.transform.y}) scale(${event.transform.k})`);
      });
    svg.call(zoom);

    return () => {
      svg.selectAll("*").remove();
    };
  }, [root]);

  return (
    <div ref={containerRef} className="w-full overflow-hidden flex justify-center">
      <svg ref={svgRef} style={{ minHeight: 400 }} />
    </div>
  );
}
