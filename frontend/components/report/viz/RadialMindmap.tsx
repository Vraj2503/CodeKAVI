"use client";

/**
 * RadialMindmap — Interactive collapsible radial tree.
 *
 * Redesigned for interactivity:
 * - Starts with only root + first-level children visible
 * - Click a node to expand/collapse its children with smooth animation
 * - Visual indicators for collapsed nodes (+ badge with child count)
 * - Generous spacing to prevent label overlap
 * - Tooltip on hover with full label and child count
 */

import { useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import * as d3 from "d3";

interface MindmapNode {
  id?: string;
  label?: string;
  name?: string;
  children?: MindmapNode[];
}

interface RadialMindmapProps {
  root: MindmapNode;
}

const depthColors = ["#58a6ff", "#4ecdc4", "#a78bfa", "#f0883e", "#ec4899"];

function getDepthColor(depth: number): string {
  return depthColors[Math.min(depth, depthColors.length - 1)];
}

function getLabel(d: MindmapNode): string {
  return d.label || d.name || d.id || "";
}

type TreeNode = d3.HierarchyPointNode<MindmapNode> & {
  _children?: TreeNode[] | null;
  x0?: number;
  y0?: number;
};

export const RadialMindmap = forwardRef<HTMLDivElement, RadialMindmapProps>(
  function RadialMindmap({ root }, ref) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => containerRef.current!);

    // Memoize the update function so it's stable across renders
    const renderTree = useCallback(() => {
      if (!svgRef.current || !containerRef.current || !root) return;

      const containerWidth = containerRef.current.clientWidth || 700;
      const size = Math.max(containerWidth, 500);

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("width", size).attr("height", size);

      const tooltip = d3.select(tooltipRef.current);

      // Build hierarchy FIRST so we can use its depth for radius
      const hierarchy = d3.hierarchy<MindmapNode>(root) as TreeNode;

      // Scale radius based on hierarchy depth — smaller data = smaller radius
      const treeDepth = hierarchy.height || 1;
      const baseRadius = size / 2 - 120;
      const radius = Math.max(baseRadius, treeDepth * 100);

      // The main group starts centered; zoom will manage transforms
      const g = svg
        .append("g")
        .attr("transform", `translate(${size / 2},${size / 2})`);

      // Collapse all children beyond depth 1 initially (user can expand)
      function collapse(node: TreeNode) {
        if (node.children) {
          if (node.depth >= 1) {
            node._children = node.children as TreeNode[];
            node.children = null as any;
          } else {
            node.children.forEach((child) => collapse(child as TreeNode));
          }
        }
      }
      collapse(hierarchy);

      // Store initial position at center
      hierarchy.x0 = 0;
      hierarchy.y0 = 0;

      // Tree layout — generous separation to avoid overlaps
      const treeLayout = d3
        .tree<MindmapNode>()
        .size([2 * Math.PI, radius])
        .separation((a, b) => (a.parent === b.parent ? 2 : 3) / Math.max(a.depth, 1));

      // Radial link generator
      const linkGen = d3
        .linkRadial<any, any>()
        .angle((d: any) => d.x)
        .radius((d: any) => d.y);

      // ── The core update function ──
      function update(source: TreeNode) {
        const treeData = treeLayout(hierarchy);
        const nodesData = treeData.descendants() as TreeNode[];
        const linksData = treeData.links();

        const duration = 500;

        // ── Links ──
        const linkSel = g
          .selectAll<SVGPathElement, d3.HierarchyPointLink<MindmapNode>>("path.mindmap-link")
          .data(linksData, (d: any) => d.target.data.id || d.target.data.name || d.target.data.label || "");

        // Enter
        const linkEnter = linkSel
          .enter()
          .append("path")
          .attr("class", "mindmap-link")
          .attr("fill", "none")
          .attr("stroke", "#30363d")
          .attr("stroke-width", 1.5)
          .attr("stroke-opacity", 0.6)
          .attr("d", () => {
            const o = { x: source.x0 || 0, y: source.y0 || 0 };
            return linkGen({ source: o, target: o });
          });

        // Update + merge
        linkEnter
          .merge(linkSel)
          .transition()
          .duration(duration)
          .attr("d", (d: any) => linkGen(d))
          .attr("stroke-opacity", 0.6);

        // Exit
        linkSel
          .exit()
          .transition()
          .duration(duration)
          .attr("d", () => {
            const o = { x: source.x || 0, y: source.y || 0 };
            return linkGen({ source: o, target: o });
          })
          .attr("stroke-opacity", 0)
          .remove();

        // ── Nodes ──
        const nodeSel = g
          .selectAll<SVGGElement, TreeNode>("g.mindmap-node")
          .data(nodesData, (d: any) => d.data.id || d.data.name || d.data.label || "");

        // Enter
        const nodeEnter = nodeSel
          .enter()
          .append("g")
          .attr("class", "mindmap-node")
          .attr("transform", () => {
            const angle = ((source.x0 || 0) * 180) / Math.PI - 90;
            return `rotate(${angle}) translate(${source.y0 || 0},0)`;
          })
          .style("cursor", "pointer")
          .style("opacity", 0);

        // Node circle
        nodeEnter
          .append("circle")
          .attr("r", 0)
          .attr("fill", (d) => getDepthColor(d.depth))
          .attr("stroke", "#0d1117")
          .attr("stroke-width", 2);

        // Collapse indicator badge (child count)
        nodeEnter
          .append("circle")
          .attr("class", "collapse-badge")
          .attr("r", 0)
          .attr("cx", 0)
          .attr("cy", -14)
          .attr("fill", "#1f2937")
          .attr("stroke", "#4b5563")
          .attr("stroke-width", 1);

        nodeEnter
          .append("text")
          .attr("class", "collapse-text")
          .attr("x", 0)
          .attr("y", -14)
          .attr("text-anchor", "middle")
          .attr("dy", "0.35em")
          .attr("fill", "#9ca3af")
          .attr("font-size", 8)
          .attr("font-weight", 600)
          .attr("pointer-events", "none");

        // Node label
        nodeEnter
          .append("text")
          .attr("class", "node-label")
          .attr("dy", "0.31em")
          .attr("fill", "#c9d1d9")
          .attr("font-size", 12)
          .attr("pointer-events", "none");

        // Merge enter + update
        const nodeUpdate = nodeEnter.merge(nodeSel);

        // Transition position
        nodeUpdate
          .transition()
          .duration(duration)
          .attr("transform", (d) => {
            const angle = (d.x * 180) / Math.PI - 90;
            return `rotate(${angle}) translate(${d.y},0)`;
          })
          .style("opacity", 1);

        // Update circles
        nodeUpdate
          .select<SVGCircleElement>("circle:first-of-type")
          .transition()
          .duration(duration)
          .attr("r", (d) => {
            if (d.depth === 0) return 10;
            if ((d as TreeNode)._children) return 7;
            return 5;
          })
          .attr("fill", (d) => getDepthColor(d.depth));

        // Update collapse badge
        nodeUpdate.each(function (d) {
          const g = d3.select(this);
          const hasCollapsed = !!(d as TreeNode)._children;
          const collapsedCount = hasCollapsed ? (d as TreeNode)._children!.length : 0;

          g.select(".collapse-badge")
            .transition()
            .duration(duration)
            .attr("r", hasCollapsed ? 7 : 0);

          g.select(".collapse-text")
            .text(hasCollapsed ? `+${collapsedCount}` : "");
        });

        // Update labels
        nodeUpdate.select<SVGTextElement>(".node-label")
          .attr("x", (d) => (d.x < Math.PI === !d.children && !(d as TreeNode)._children ? 14 : -14))
          .attr("text-anchor", (d) =>
            d.x < Math.PI === !d.children && !(d as TreeNode)._children ? "start" : "end"
          )
          .attr("transform", (d) => (d.x >= Math.PI ? "rotate(180)" : null))
          .text((d) => {
            const label = getLabel(d.data);
            return label.length > 22 ? label.slice(0, 22) + "…" : label;
          });

        // Click handler — toggle expand/collapse
        nodeUpdate.on("click", function (event, d) {
          event.stopPropagation();
          const node = d as TreeNode;
          if (node.children) {
            // Collapse
            node._children = node.children as TreeNode[];
            node.children = null as any;
          } else if (node._children) {
            // Expand
            node.children = node._children as any;
            node._children = null;
          }
          update(node);
        });

        // Hover tooltip
        nodeUpdate
          .on("mouseenter", function (event, d) {
            const label = getLabel(d.data);
            const childCount = d.children?.length || (d as TreeNode)._children?.length || 0;
            tooltip
              .style("display", "block")
              .style("left", `${event.offsetX + 15}px`)
              .style("top", `${event.offsetY - 10}px`)
              .html(
                `<strong>${label}</strong>` +
                (childCount > 0 ? `<br/><span style="color:#9ca3af">${childCount} children</span>` : "")
              );
          })
          .on("mousemove", function (event) {
            tooltip
              .style("left", `${event.offsetX + 15}px`)
              .style("top", `${event.offsetY - 10}px`);
          })
          .on("mouseleave", function () {
            tooltip.style("display", "none");
          });

        // Exit
        nodeSel
          .exit()
          .transition()
          .duration(duration)
          .attr("transform", () => {
            const angle = ((source.x || 0) * 180) / Math.PI - 90;
            return `rotate(${angle}) translate(${source.y || 0},0)`;
          })
          .style("opacity", 0)
          .remove();

        // Store positions for next transition
        nodesData.forEach((d) => {
          (d as TreeNode).x0 = d.x;
          (d as TreeNode).y0 = d.y;
        });
      }

      // Initial render
      update(hierarchy);

      // Zoom + pan — use raw d3 transform (initial centering via zoomIdentity)
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on("zoom", (event) => {
          g.attr("transform", event.transform.toString());
        });
      svg.call(zoom);

      // Set initial transform to center the tree, then auto-fit
      const initialTransform = d3.zoomIdentity.translate(size / 2, size / 2);
      svg.call(zoom.transform as any, initialTransform);

      // Auto-fit: compute bounds of visible nodes and zoom to fit them
      setTimeout(() => {
        const allNodes = hierarchy.descendants();
        if (allNodes.length <= 1) return;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        allNodes.forEach((d: any) => {
          if (d.x !== undefined && d.y !== undefined) {
            const angle = d.x - Math.PI / 2;
            const px = d.y * Math.cos(angle);
            const py = d.y * Math.sin(angle);
            minX = Math.min(minX, px);
            maxX = Math.max(maxX, px);
            minY = Math.min(minY, py);
            maxY = Math.max(maxY, py);
          }
        });

        const contentW = maxX - minX || 1;
        const contentH = maxY - minY || 1;
        const padding = 100;
        const scaleX = (size - padding * 2) / contentW;
        const scaleY = (size - padding * 2) / contentH;
        const fitScale = Math.min(scaleX, scaleY, 2.0);

        // Center of content in radial coordinates
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        // Apply fit transform: translate to center the content, then scale
        const fitTransform = d3.zoomIdentity
          .translate(size / 2 - cx * fitScale, size / 2 - cy * fitScale)
          .scale(fitScale);

        svg.transition().duration(600).call(
          zoom.transform as any,
          fitTransform
        );
      }, 150);

      return () => {
        svg.selectAll("*").remove();
      };
    }, [root]);

    useEffect(() => {
      renderTree();
    }, [renderTree]);

    // Re-render on container resize (e.g. sidebar toggle)
    useEffect(() => {
      if (!containerRef.current) return;
      let resizeTimer: NodeJS.Timeout;
      const observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          renderTree();
        }, 200);
      });
      observer.observe(containerRef.current);
      return () => { observer.disconnect(); clearTimeout(resizeTimer); };
    }, [renderTree]);

    return (
      <div ref={containerRef} className="w-full overflow-hidden flex justify-center relative">
        <svg ref={svgRef} style={{ minHeight: 500 }} />
        <div
          ref={tooltipRef}
          style={{ display: "none" }}
          className="absolute z-50 px-3 py-2 text-xs bg-card border border-border/60 rounded-lg shadow-xl pointer-events-none"
        />
      </div>
    );
  }
);
