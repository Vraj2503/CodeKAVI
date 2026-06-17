/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

/**
 * RadialMindmap — Horizontal tree mind map (left-to-right).
 *
 * Redesigned to match a classic mind map layout:
 * - Root node on the left, branches flow to the right
 * - Rounded rectangle nodes with depth-based coloring
 * - Smooth curved Bézier connectors
 * - Small chevron indicators on expandable nodes
 * - Click to expand/collapse subtrees
 * - Auto-fit to fill the viewport
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

// Depth-based color palette — muted, professional
const depthStyles = [
  { bg: "#1e293b", border: "#64748b", text: "#e2e8f0" },   // root — slate
  { bg: "#1a2332", border: "#4ecdc4", text: "#a8e6cf" },   // depth 1 — teal
  { bg: "#1f1a2e", border: "#a78bfa", text: "#c4b5fd" },   // depth 2 — purple
  { bg: "#1a2a1e", border: "#4ade80", text: "#86efac" },   // depth 3 — green
  { bg: "#2a1f1a", border: "#f0883e", text: "#fdba74" },   // depth 4 — orange
  { bg: "#2a1a2a", border: "#ec4899", text: "#f9a8d4" },   // depth 5 — pink
];

function getStyle(depth: number) {
  return depthStyles[Math.min(depth, depthStyles.length - 1)];
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

    const renderTree = useCallback(() => {
      if (!svgRef.current || !containerRef.current || !root) return;

      const width = containerRef.current.clientWidth || 900;
      const height = containerRef.current.clientHeight || 500;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("width", width).attr("height", height);

      const tooltip = d3.select(tooltipRef.current);

      // Build hierarchy
      const hierarchy = d3.hierarchy<MindmapNode>(root) as TreeNode;
      const treeDepth = hierarchy.height || 1;

      // Node sizing
      const nodeH = 30;
      const nodeVGap = 8;
      const rowH = nodeH + nodeVGap;

      // Calculate horizontal spacing based on tree depth and width
      const marginLeft = 40;
      const marginRight = 80;
      const availableWidth = width - marginLeft - marginRight;
      const colSpacing = Math.max(180, availableWidth / Math.max(treeDepth, 1));

      const g = svg.append("g");

      // Separate groups for links and nodes to control z-index (nodes on top)
      let linksG = g.select<SVGGElement>("g.links-group");
      if (linksG.empty()) {
        linksG = g.append("g").attr("class", "links-group");
      }
      let nodesG = g.select<SVGGElement>("g.nodes-group");
      if (nodesG.empty()) {
        nodesG = g.append("g").attr("class", "nodes-group");
      }

      // Collapse all children beyond depth 1 initially
      function collapse(node: TreeNode) {
        if (node.children) {
          if (node.depth >= 1) {
            node._children = node.children as TreeNode[];
            node.children = undefined;
          } else {
            node.children.forEach((child) => collapse(child as TreeNode));
          }
        }
      }
      collapse(hierarchy);

      // Store initial position
      hierarchy.x0 = height / 2;
      hierarchy.y0 = 0;

      // Tree layout — horizontal (swap x/y: d3 tree uses x=vertical, y=horizontal)
      const treeLayout = d3
        .tree<MindmapNode>()
        .nodeSize([rowH, colSpacing])
        .separation((a, b) => (a.parent === b.parent ? 1 : 1.3));

      // Horizontal link generator — smooth cubic Bézier flowing left-to-right
      function linkPath(d: unknown): string {
        const sy = (d as any).source.x;
        const sx = (d as any).source.y;
        const ty = (d as any).target.x;
        const tx = (d as any).target.y;
        // cubic Bézier with control points at midpoint X
        const midX = (sx + tx) / 2;
        return `M${sx},${sy} C${midX},${sy} ${midX},${ty} ${tx},${ty}`;
      }

      // Measure text width helper
      function measureText(text: string, fontSize: number): number {
        return text.length * fontSize * 0.55 + 24; // approximate
      }

      // ── Core update function ──
      function update(source: TreeNode) {
        const treeData = treeLayout(hierarchy);
        const nodesData = treeData.descendants() as TreeNode[];
        const linksData = treeData.links();

        const duration = 400;

        // Assign y (horizontal position) based on depth for consistent spacing
        nodesData.forEach((d) => {
          d.y = d.depth * colSpacing;
        });

        // ── Links ──
        const linkSel = linksG
          .selectAll<SVGPathElement, d3.HierarchyPointLink<MindmapNode>>("path.mm-link")
          .data(linksData, (d: any) =>
            d.target.data.id || d.target.data.name || d.target.data.label || ""
          );

        const linkEnter = linkSel
          .enter()
          .append("path")
          .attr("class", "mm-link")
          .attr("fill", "none")
          .attr("stroke", "#30363d")
          .attr("stroke-width", 1.5)
          .attr("stroke-opacity", 0.5)
          .attr("d", () => {
            const o = { x: source.x0 || 0, y: source.y0 || 0 };
            return linkPath({ source: o, target: o });
          });

        linkEnter
          .merge(linkSel)
          .transition()
          .duration(duration)
          .attr("d", (d: any) => linkPath(d))
          .attr("stroke-opacity", 0.5);

        linkSel
          .exit()
          .transition()
          .duration(duration)
          .attr("d", () => {
            const o = { x: source.x || 0, y: source.y || 0 };
            return linkPath({ source: o, target: o });
          })
          .attr("stroke-opacity", 0)
          .remove();

        // ── Nodes ──
        const nodeSel = nodesG
          .selectAll<SVGGElement, TreeNode>("g.mm-node")
          .data(nodesData, (d: any) =>
            d.data.id || d.data.name || d.data.label || ""
          );

        const nodeEnter = nodeSel
          .enter()
          .append("g")
          .attr("class", "mm-node")
          .attr("transform", () =>
            `translate(${source.y0 || 0},${source.x0 || 0})`
          )
          .style("cursor", "pointer")
          .style("opacity", 0);

        // Rounded rectangle background
        nodeEnter
          .append("rect")
          .attr("class", "node-rect")
          .attr("height", nodeH)
          .attr("rx", 8)
          .attr("ry", 8)
          .attr("y", -nodeH / 2);

        // Label text
        nodeEnter
          .append("text")
          .attr("class", "node-label")
          .attr("dy", "0.35em")
          .attr("font-size", 12)
          .attr("pointer-events", "none");

        // Chevron indicator for expandable nodes (▸)
        nodeEnter
          .append("text")
          .attr("class", "node-chevron")
          .attr("dy", "0.35em")
          .attr("font-size", 10)
          .attr("fill", "#6b7280")
          .attr("pointer-events", "none");

        // Merge
        const nodeUpdate = nodeEnter.merge(nodeSel);

        // Transition to new position (d.y = horizontal, d.x = vertical)
        nodeUpdate
          .transition()
          .duration(duration)
          .attr("transform", (d) => `translate(${d.y},${d.x})`)
          .style("opacity", 1);

        // Update rectangles
        nodeUpdate.each(function (d) {
          const style = getStyle(d.depth);
          const label = getLabel(d.data);
          const truncLabel = label.length > 28 ? label.slice(0, 28) + "…" : label;
          const textW = measureText(truncLabel, 12);
          const rectW = Math.max(textW, 60);
          const hasChildren = !!(d.children || (d as TreeNode)._children);

          const sel = d3.select(this);

          // Rectangle
          sel
            .select<SVGRectElement>(".node-rect")
            .attr("width", rectW)
            .attr("x", -10)
            .attr("fill", style.bg)
            .attr("stroke", style.border)
            .attr("stroke-width", d.depth === 0 ? 2 : 1.5)
            .attr("fill-opacity", 0.9);

          // Label
          sel
            .select<SVGTextElement>(".node-label")
            .attr("x", rectW / 2 - 10 + (hasChildren ? -6 : 0))
            .attr("text-anchor", "middle")
            .attr("fill", style.text)
            .attr("font-weight", d.depth === 0 ? 600 : 400)
            .text(truncLabel);

          // Chevron (▸ if collapsed, ▾ if expanded, nothing if leaf)
          sel
            .select<SVGTextElement>(".node-chevron")
            .attr("x", rectW - 16)
            .attr("text-anchor", "middle")
            .text(() => {
              if (!hasChildren) return "";
              return (d as TreeNode)._children ? "▸" : "▾";
            })
            .attr("fill", style.border);
        });

        // Click handler — toggle expand/collapse
        nodeUpdate.on("click", function (event, d) {
          event.stopPropagation();
          const node = d as TreeNode;
          if (node.children) {
            node._children = node.children as TreeNode[];
            node.children = undefined;
          } else if (node._children) {
            node.children = node._children as TreeNode[];
            node._children = undefined;
          }
          update(node);
        });

        // Hover
        nodeUpdate
          .on("mouseenter", function (event, d) {
            const label = getLabel(d.data);
            const childCount =
              d.children?.length || (d as TreeNode)._children?.length || 0;
            d3.select(this)
              .select(".node-rect")
              .transition()
              .duration(100)
              .attr("stroke-width", 2.5)
              .attr("fill-opacity", 1);
            tooltip
              .style("display", "block")
              .style("left", `${event.offsetX + 15}px`)
              .style("top", `${event.offsetY - 10}px`)
              .html(
                `<strong>${label}</strong>` +
                  (childCount > 0
                    ? `<br/><span style="color:#9ca3af">${childCount} children</span>`
                    : "")
              );
          })
          .on("mousemove", function (event) {
            tooltip
              .style("left", `${event.offsetX + 15}px`)
              .style("top", `${event.offsetY - 10}px`);
          })
          .on("mouseleave", function (d) {
            const depth = (d as any).depth ?? 0;
            d3.select(this)
              .select(".node-rect")
              .transition()
              .duration(100)
              .attr("stroke-width", depth === 0 ? 2 : 1.5)
              .attr("fill-opacity", 0.9);
            tooltip.style("display", "none");
          });

        // Exit
        nodeSel
          .exit()
          .transition()
          .duration(duration)
          .attr("transform", () =>
            `translate(${source.y || 0},${source.x || 0})`
          )
          .style("opacity", 0)
          .remove();

        // Store positions for next transition
        nodesData.forEach((d) => {
          (d as TreeNode).x0 = d.x;
          (d as TreeNode).y0 = d.y;
        });

        // Auto-fit to viewport after a short delay to allow transition to start
        setTimeout(() => {
          fitToScreen(hierarchy);
        }, 50);
      }

      // Zoom + pan
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 3])
        .on("zoom", (event) => {
          g.attr("transform", event.transform.toString());
        });
      svg.call(zoom);

      // Function to auto-fit the mind map to the container
      function fitToScreen(rootNode: TreeNode) {
        const allNodes = rootNode.descendants();
        if (allNodes.length <= 1) {
          // Single node — just center it
          svg.transition().duration(500).call(
            zoom.transform as any,
            d3.zoomIdentity.translate(width / 2, height / 2)
          );
          return;
        }

        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        allNodes.forEach((d: any) => {
          // d.y = horizontal pos, d.x = vertical pos (d3 tree convention)
          const label = getLabel(d.data);
          const nodeW = measureText(
            label.length > 28 ? label.slice(0, 28) + "…" : label,
            12
          );
          minX = Math.min(minX, d.y - 10);
          maxX = Math.max(maxX, d.y + nodeW + 10);
          minY = Math.min(minY, d.x - nodeH / 2);
          maxY = Math.max(maxY, d.x + nodeH / 2);
        });

        const contentW = maxX - minX || 1;
        const contentH = maxY - minY || 1;
        const padX = 60;
        const padY = 60;
        const scaleX = (width - padX * 2) / contentW;
        const scaleY = (height - padY * 2) / contentH;
        const fitScale = Math.min(scaleX, scaleY, 1.5);

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        const fitTransform = d3.zoomIdentity
          .translate(width / 2 - cx * fitScale, height / 2 - cy * fitScale)
          .scale(fitScale);

        svg
          .transition()
          .duration(500)
          .call(zoom.transform as any, fitTransform);
      }

      // Initial render
      update(hierarchy);

      return () => {
        svg.selectAll("*").remove();
      };
    }, [root]);

    useEffect(() => {
      renderTree();
    }, [renderTree]);



    return (
      <div ref={containerRef} className="w-full h-full overflow-hidden relative">
        <svg ref={svgRef} className="w-full h-full" />
        <div
          ref={tooltipRef}
          style={{ display: "none" }}
          className="absolute z-50 px-3 py-2 text-xs bg-card border border-border/60 rounded-lg shadow-xl pointer-events-none"
        />
      </div>
    );
  }
);
