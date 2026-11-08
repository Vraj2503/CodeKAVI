/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

/**
 * RadialMindmap — Horizontal tree mind map (left-to-right).
 *
 * Visual hierarchy (NotebookLM-style):
 *   depth 0  Root pill   — 44 px tall, bold, accent glow, thicker border
 *   depth 1  Branch card — 34 px tall, colored left stripe, semi-bold
 *   depth 2+ Leaf card   — 28 px tall, muted, monospace label
 *
 * Toolbar: zoom-out / fit / zoom-in pill cluster (pointer-events-auto so the
 * canvas stays draggable through the transparent gaps).
 *
 * Tooltip: branch nodes show child count; leaf nodes show the full file path
 * when the `path` field is present on the datum.
 */

import { useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import * as d3 from "d3";
import { catVar, inkDimVar } from "@/lib/viz/tokens";
import { useVizCanvas } from "@/components/viz/useVizCanvas";
import { useReducedMotion } from "@/components/viz/useReducedMotion";

interface MindmapNode {
  id?: string;
  label?: string;
  name?: string;
  /** Full relative path — present on file leaves from both static and LLM builders. */
  path?: string;
  children?: MindmapNode[];
}

interface RadialMindmapProps {
  root: MindmapNode;
}

// ── Depth → visual tier mapping ──────────────────────────────────────────────

/**
 * Depth → categorical colour slot.
 * Depth 0 = root (slot 7 — brand accent)
 * Depth 1 = branch (slots 5, 2, 1, 3 — cycle)
 * Depth 2+ = leaf (dimmer, no stripe)
 */
const BRANCH_SLOTS = [5, 2, 1, 3, 4, 6]; // cycles for depth-1+ branches

interface NodeStyle {
  bg: string;
  border: string;
  text: string;
  height: number;
  rx: number;
  fontWeight: number;
  fontSize: number;
  /** If set, draw a left-border stripe of this colour. */
  stripe?: string;
}

function getStyle(depth: number, branchIndex: number): NodeStyle {
  if (depth === 0) {
    const accent = catVar(7);
    return {
      bg: "hsl(var(--card))",
      border: accent,
      text: accent,
      height: 44,
      rx: 12,
      fontWeight: 700,
      fontSize: 13,
    };
  }
  if (depth === 1) {
    const slot = BRANCH_SLOTS[branchIndex % BRANCH_SLOTS.length];
    const accent = catVar(slot);
    return {
      bg: "hsl(var(--card))",
      border: accent,
      text: accent,
      height: 34,
      rx: 9,
      fontWeight: 600,
      fontSize: 12,
      stripe: accent,
    };
  }
  // depth 2+: leaf
  return {
    bg: "hsl(var(--card))",
    border: inkDimVar(),
    text: inkDimVar(),
    height: 28,
    rx: 6,
    fontWeight: 400,
    fontSize: 11,
  };
}

function getLabel(d: MindmapNode): string {
  return d.label || d.name || d.id || "";
}

type TreeNode = d3.HierarchyPointNode<MindmapNode> & {
  _children?: TreeNode[] | null;
  x0?: number;
  y0?: number;
  _uid?: number;
  /** Inherited branch slot index (set on depth-1 nodes; leaves copy from parent). */
  _branchIdx?: number;
};

/**
 * Give every node a stable integer join key.
 * Must run before `collapse()` — once children move to `_children`, `each`
 * no longer walks them.
 */
function assignJoinKeys(root: TreeNode) {
  let uid = 0;
  root.each((node) => {
    (node as TreeNode)._uid = ++uid;
  });
}

/**
 * Walk the tree and stamp each node with its branch index so leaf styles can
 * inherit the right colour slot without recalculating parent lineage.
 */
function assignBranchIndices(root: TreeNode) {
  root.each((node) => {
    const n = node as TreeNode;
    if (n.depth === 0) {
      n._branchIdx = 0;
    } else if (n.depth === 1) {
      // Position among siblings at depth 1
      const parent = n.parent as TreeNode | null;
      const siblings = (parent?.children ?? parent?._children ?? []) as TreeNode[];
      n._branchIdx = siblings.indexOf(n);
    } else {
      n._branchIdx = (n.parent as TreeNode)?._branchIdx ?? 0;
    }
  });
}

export const RadialMindmap = forwardRef<HTMLDivElement, RadialMindmapProps>(
  function RadialMindmap({ root }, ref) {
    const svgRef = useRef<SVGSVGElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const fitRef = useRef<(() => void) | null>(null);
    const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

    const canvas = useVizCanvas();
    const { attach } = canvas;
    const reducedMotion = useReducedMotion();

    const treeRef = useRef<{ source: MindmapNode; tree: TreeNode } | null>(null);

    useImperativeHandle(ref, () => canvas.containerRef.current!);

    const renderTree = useCallback(() => {
      if (!svgRef.current || !canvas.ready || !root) return;

      const { width, height } = canvas.size;

      const hoverMs = reducedMotion ? 0 : 100;
      const fitMs   = reducedMotion ? 0 : 500;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("width", width).attr("height", height);

      const tooltip = d3.select(tooltipRef.current);

      // ── Initial collapse: show depth-1 branches, collapse deeper ────────────
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

      // Build / reuse hierarchy
      let hierarchy: TreeNode;
      if (treeRef.current?.source === root) {
        hierarchy = treeRef.current.tree;
      } else {
        hierarchy = d3.hierarchy<MindmapNode>(root) as TreeNode;
        assignJoinKeys(hierarchy);
        assignBranchIndices(hierarchy);
        collapse(hierarchy);
        treeRef.current = { source: root, tree: hierarchy };
      }

      const treeDepth = hierarchy.height || 1;

      // ── Layout constants ─────────────────────────────────────────────────────
      const marginLeft  = 40;
      const marginRight = 90;
      const availableW  = width - marginLeft - marginRight;
      const colSpacing  = Math.max(200, availableW / Math.max(treeDepth, 1));

      // Tallest node height = 44 (root); vertical gap scales with it
      const rowH = 44 + 10;

      const g = svg.append("g");
      let linksG = g.select<SVGGElement>("g.links-group");
      if (linksG.empty()) linksG = g.append("g").attr("class", "links-group");
      let nodesG = g.select<SVGGElement>("g.nodes-group");
      if (nodesG.empty()) nodesG = g.append("g").attr("class", "nodes-group");

      hierarchy.x0 = height / 2;
      hierarchy.y0 = 0;

      const treeLayout = d3
        .tree<MindmapNode>()
        .nodeSize([rowH, colSpacing])
        .separation((a, b) => (a.parent === b.parent ? 1 : 1.4));

      // Smooth cubic Bézier link (horizontal left-to-right)
      function linkPath(d: unknown): string {
        const sy = (d as any).source.x;
        const sx = (d as any).source.y;
        const ty = (d as any).target.x;
        const tx = (d as any).target.y;
        const midX = (sx + tx) / 2;
        return `M${sx},${sy} C${midX},${sy} ${midX},${ty} ${tx},${ty}`;
      }

      function measureText(text: string, fontSize: number): number {
        return text.length * fontSize * 0.56 + 24;
      }

      // ── Core update ──────────────────────────────────────────────────────────
      let hasFitted = false;

      function update(source: TreeNode) {
        const treeData  = treeLayout(hierarchy);
        const nodesData = treeData.descendants() as TreeNode[];
        const linksData = treeData.links();
        const duration  = reducedMotion ? 0 : 380;

        nodesData.forEach((d) => {
          d.y = d.depth * colSpacing;
        });

        // ── Links ──────────────────────────────────────────────────────────────
        const linkSel = linksG
          .selectAll<SVGPathElement, d3.HierarchyPointLink<MindmapNode>>("path.mm-link")
          .data(linksData, (d: any) => d.target._uid);

        const linkEnter = linkSel
          .enter()
          .append("path")
          .attr("class", "mm-link")
          .attr("fill", "none")
          .attr("stroke-linecap", "round")
          .attr("d", () => {
            const o = { x: source.x0 || 0, y: source.y0 || 0 };
            return linkPath({ source: o, target: o });
          })
          .attr("opacity", 0);

        linkEnter
          .merge(linkSel)
          .each(function (d: any) {
            const depth = d.source.depth ?? 0;
            d3.select(this)
              .attr("stroke", inkDimVar())
              .attr("stroke-width", depth === 0 ? 2 : 1.5)
              .attr("stroke-opacity", depth === 0 ? 0.45 : 0.3);
          })
          .transition()
          .duration(duration)
          .attr("d", (d: any) => linkPath(d))
          .attr("opacity", 1);

        linkSel
          .exit()
          .transition()
          .duration(duration)
          .attr("d", () => {
            const o = { x: source.x || 0, y: source.y || 0 };
            return linkPath({ source: o, target: o });
          })
          .attr("opacity", 0)
          .remove();

        // ── Nodes ──────────────────────────────────────────────────────────────
        const nodeSel = nodesG
          .selectAll<SVGGElement, TreeNode>("g.mm-node")
          .data(nodesData, (d: any) => d._uid);

        const nodeEnter = nodeSel
          .enter()
          .append("g")
          .attr("class", "mm-node")
          .attr("transform", () => `translate(${source.y0 || 0},${source.x0 || 0})`)
          .style("cursor", "pointer")
          .style("opacity", 0);

        // Stripe rect (depth-1 left colour strip)
        nodeEnter.append("rect").attr("class", "node-stripe");

        // Main card background
        nodeEnter.append("rect").attr("class", "node-rect");

        // Label
        nodeEnter
          .append("text")
          .attr("class", "node-label")
          .attr("dy", "0.35em")
          .attr("pointer-events", "none");

        // Chevron indicator
        nodeEnter
          .append("text")
          .attr("class", "node-chevron")
          .attr("dy", "0.35em")
          .attr("pointer-events", "none");

        const nodeUpdate = nodeEnter.merge(nodeSel);

        nodeUpdate
          .transition()
          .duration(duration)
          .attr("transform", (d) => `translate(${d.y},${d.x})`)
          .style("opacity", 1);

        // Per-node attribute updates
        nodeUpdate.each(function (d) {
          const branchIdx = (d as TreeNode)._branchIdx ?? 0;
          const style      = getStyle(d.depth, branchIdx);
          const label      = getLabel(d.data);
          const maxChars   = d.depth === 0 ? 32 : d.depth === 1 ? 28 : 26;
          const truncLabel = label.length > maxChars ? label.slice(0, maxChars) + "…" : label;
          const textW      = measureText(truncLabel, style.fontSize);
          const rectW      = d.depth === 0 ? Math.max(textW + 24, 80) : Math.max(textW, 60);
          const hasChildren = !!(d.children || (d as TreeNode)._children);
          const stripeW    = style.stripe ? 4 : 0;

          const sel = d3.select(this);

          // Stripe (depth-1 only)
          sel
            .select<SVGRectElement>(".node-stripe")
            .attr("x", -10)
            .attr("y", -style.height / 2)
            .attr("width", stripeW)
            .attr("height", style.height)
            .attr("rx", style.rx)
            .attr("fill", style.stripe ?? "none")
            .attr("opacity", style.stripe ? 1 : 0);

          // Card background
          sel
            .select<SVGRectElement>(".node-rect")
            .attr("width", rectW)
            .attr("height", style.height)
            .attr("x", -10)
            .attr("y", -style.height / 2)
            .attr("rx", style.rx)
            .attr("ry", style.rx)
            .attr("fill", style.bg)
            .attr("stroke", style.border)
            .attr("stroke-width", d.depth === 0 ? 2 : 1.5)
            // Subtle glow on root
            .style("filter", d.depth === 0 ? `drop-shadow(0 0 6px ${style.border}44)` : "none");

          // Label
          sel
            .select<SVGTextElement>(".node-label")
            .attr("x", stripeW + rectW / 2 - 10 + (hasChildren && d.depth > 0 ? -6 : 0))
            .attr("text-anchor", "middle")
            .attr("fill", style.text)
            .attr("font-size", style.fontSize)
            .attr("font-weight", style.fontWeight)
            // Leaves use monospace to make path segments readable
            .attr("font-family", d.depth >= 2 ? "ui-monospace, monospace" : "inherit")
            .text(truncLabel);

          // Chevron
          sel
            .select<SVGTextElement>(".node-chevron")
            .attr("x", rectW - 16)
            .attr("font-size", 9)
            .attr("fill", style.border)
            .attr("text-anchor", "middle")
            .text(() => {
              if (!hasChildren) return "";
              return (d as TreeNode)._children ? "▸" : "▾";
            });
        });

        // Click: expand / collapse
        nodeUpdate.on("click", function (event, d) {
          event.stopPropagation();
          const node = d as TreeNode;
          const canToggle = !!(node.children || node._children);
          if (!canToggle) return;

          if (node.children) {
            node._children = node.children as TreeNode[];
            node.children = undefined;
          } else if (node._children) {
            node.children = node._children as TreeNode[];
            node._children = undefined;
            // Re-stamp branch indices for newly visible descendants
            assignBranchIndices(hierarchy);
          }
          update(node);
          // Reframe the visible tree after the layout transition: expansion
          // gives the new branches room, and collapsing brings the remaining
          // map back into focus.
          fitToScreen(hierarchy);
        });

        // Tooltip positioning
        function place(event: MouseEvent) {
          const rect = canvas.containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          tooltip
            .style("left", `${event.clientX - rect.left + 16}px`)
            .style("top", `${event.clientY - rect.top - 12}px`);
        }

        nodeUpdate
          .on("mouseenter", function (event: MouseEvent, d) {
            const label = getLabel(d.data);
            const path  = (d.data as MindmapNode).path;
            const childCount =
              d.children?.length || (d as TreeNode)._children?.length || 0;

            d3.select(this)
              .select(".node-rect")
              .transition()
              .duration(hoverMs)
              .attr("stroke-width", 2.5)
              .style("filter", `drop-shadow(0 2px 8px ${getStyle(d.depth, (d as TreeNode)._branchIdx ?? 0).border}55)`);

            // Build tooltip content using DOM text nodes — no innerHTML with path data.
            const tipEl = tooltipRef.current;
            if (!tipEl) return;
            tipEl.style.display = "block";
            // Clear previous content
            while (tipEl.firstChild) tipEl.removeChild(tipEl.firstChild);

            const strong = document.createElement("strong");
            strong.textContent = label;
            tipEl.appendChild(strong);

            if (d.depth >= 2 && path) {
              tipEl.appendChild(document.createElement("br"));
              const span = document.createElement("span");
              span.className = "tip-path";
              span.textContent = path;
              tipEl.appendChild(span);
            } else if (childCount > 0) {
              tipEl.appendChild(document.createElement("br"));
              const span = document.createElement("span");
              span.className = "tip-dim";
              span.textContent = `${childCount} item${childCount > 1 ? "s" : ""}`;
              tipEl.appendChild(span);
            }

            place(event);
          })
          .on("mousemove", function (event: MouseEvent) { place(event); })
          .on("mouseleave", function (_event, d) {
            d3.select(this)
              .select(".node-rect")
              .transition()
              .duration(hoverMs)
              .attr("stroke-width", d.depth === 0 ? 2 : 1.5)
              .style("filter", d.depth === 0
                ? `drop-shadow(0 0 6px ${getStyle(0, 0).border}44)`
                : "none");
            if (tooltipRef.current) tooltipRef.current.style.display = "none";
          });

        // Exit
        nodeSel
          .exit()
          .transition()
          .duration(duration)
          .attr("transform", () => `translate(${source.y || 0},${source.x || 0})`)
          .style("opacity", 0)
          .remove();

        // Store positions
        nodesData.forEach((d) => {
          (d as TreeNode).x0 = d.x;
          (d as TreeNode).y0 = d.y;
        });

        // Fit once on first render
        if (!hasFitted) {
          hasFitted = true;
          setTimeout(() => fitToScreen(hierarchy), 50);
        }
      }

      // ── Zoom + pan ───────────────────────────────────────────────────────────
      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.15, 3])
        .on("zoom", (event) => {
          g.attr("transform", event.transform.toString());
        });
      svg.call(zoom);
      zoomRef.current = zoom;

      // ── Fit to screen ────────────────────────────────────────────────────────
      function fitToScreen(rootNode: TreeNode) {
        const allNodes = rootNode.descendants();
        if (allNodes.length <= 1) {
          svg.transition().duration(fitMs).call(
            zoom.transform as any,
            d3.zoomIdentity.translate(width / 2, height / 2),
          );
          return;
        }
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        allNodes.forEach((d: any) => {
          const nodeH = getStyle(d.depth, d._branchIdx ?? 0).height;
          const label = getLabel(d.data);
          const maxChars = d.depth === 0 ? 32 : 28;
          const trunc = label.length > maxChars ? label.slice(0, maxChars) + "…" : label;
          const nodeW = measureText(trunc, getStyle(d.depth, d._branchIdx ?? 0).fontSize) + (d.depth > 0 ? 4 : 24);
          minX = Math.min(minX, d.y - 10);
          maxX = Math.max(maxX, d.y + nodeW + 10);
          minY = Math.min(minY, d.x - nodeH / 2);
          maxY = Math.max(maxY, d.x + nodeH / 2);
        });
        const contentW = maxX - minX || 1;
        const contentH = maxY - minY || 1;
        const pad = 60;
        const fitScale = Math.min((width - pad * 2) / contentW, (height - pad * 2) / contentH, 1.5);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        svg.transition().duration(fitMs).call(
          zoom.transform as any,
          d3.zoomIdentity
            .translate(width / 2 - cx * fitScale, height / 2 - cy * fitScale)
            .scale(fitScale),
        );
      }

      fitRef.current = () => fitToScreen(hierarchy);

      update(hierarchy);

      return () => { svg.selectAll("*").remove(); };
    }, [root, canvas.size, canvas.ready, canvas.containerRef, reducedMotion]);

    useEffect(() => { renderTree(); }, [renderTree]);

    // Zoom-in / zoom-out helpers
    const handleZoomIn = () => {
      if (!svgRef.current || !zoomRef.current) return;
      const ms = reducedMotion ? 0 : 250;
      d3.select(svgRef.current)
        .transition()
        .duration(ms)
        .call(zoomRef.current.scaleBy as any, 1.35);
    };
    const handleZoomOut = () => {
      if (!svgRef.current || !zoomRef.current) return;
      const ms = reducedMotion ? 0 : 250;
      d3.select(svgRef.current)
        .transition()
        .duration(ms)
        .call(zoomRef.current.scaleBy as any, 1 / 1.35);
    };

    const btnCls =
      "flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/90 text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--viz-highlight))]";

    return (
      <div ref={attach} className="w-full h-full overflow-hidden relative">
        <svg ref={svgRef} className="w-full h-full" />

        {/* ── Toolbar — pointer-events-none wrapper keeps canvas draggable ── */}
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex flex-col gap-1">
          <button
            type="button"
            onClick={handleZoomIn}
            aria-label="Zoom in"
            className={`pointer-events-auto ${btnCls}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 4v8M4 8h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => fitRef.current?.()}
            aria-label="Fit to view"
            className={`pointer-events-auto ${btnCls}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <button
            type="button"
            onClick={handleZoomOut}
            aria-label="Zoom out"
            className={`pointer-events-auto ${btnCls}`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 8h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ── Tooltip — rendered via DOM text nodes (no innerHTML) ── */}
        <div
          ref={tooltipRef}
          style={{ display: "none" }}
          className="absolute z-50 px-3 py-2 text-xs bg-card border border-border/60 rounded-lg shadow-xl pointer-events-none max-w-xs"
        >
          {/* Content injected imperatively in the D3 hover handler */}
        </div>

        <style>{`
          .tip-path {
            color: hsl(var(--muted-foreground));
            font-family: ui-monospace, monospace;
            word-break: break-all;
          }
          .tip-dim {
            color: hsl(var(--muted-foreground));
          }
        `}</style>
      </div>
    );
  },
);
