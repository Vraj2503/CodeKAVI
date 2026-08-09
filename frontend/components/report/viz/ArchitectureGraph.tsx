"use client";

/**
 * ArchitectureGraph — Hierarchical layered layout with rounded rectangles.
 *
 * Reads like an architecture blueprint:
 * - Nodes are rounded rectangles grouped into swim-lanes by layer
 * - Curved Bézier edges with directional arrows
 * - Top-to-bottom flow emphasising hierarchy
 *
 * Chrome comes from `VizShell` (T9). It previously had none: no zoom controls,
 * no legend, no tooltip beyond a native `<title>`, and an auto-fit built from
 * guessed layout constants rather than the rendered bounding box.
 */

import {
  useRef,
  useEffect,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as d3 from "d3";
import { catVar, inkDimVar } from "@/lib/viz/tokens";
import {
  VizShell,
  VizLegend,
  VizTooltip,
  type VizLegendItem,
} from "@/components/viz/VizShell";
import { useVizCanvas } from "@/components/viz/useVizCanvas";
import { useVizZoom, ZOOM_MIN, ZOOM_MAX } from "@/components/viz/useVizZoom";
import { useVizNodeNav } from "@/components/viz/useVizNodeNav";
import { useReducedMotion } from "@/components/viz/useReducedMotion";

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

/**
 * Layer → categorical slot. Each layer draws its accent from one palette
 * entry; the fill is that same color at low alpha over the page surface, so
 * lanes read as tinted glass in both themes instead of the fixed dark
 * navy/plum slabs this replaced (which were invisible on a light canvas).
 */
const LAYER_SLOT: Record<string, number> = {
  routes: 5,
  services: 2,
  models: 1,
  database: 3,
  utils: 0,
  config: 3,
  tests: 7,
  frontend: 4,
  module: 2,
};

function getLayerStyle(type: string) {
  const slot = LAYER_SLOT[type?.toLowerCase()];
  const accent = slot == null ? inkDimVar() : catVar(slot);
  const wash = slot == null ? inkDimVar(0.07) : catVar(slot, 0.1);
  return {
    /** Lane background — a low-alpha wash of the accent. */
    laneBg: wash,
    /** Node chip — solid card surface so labels stay legible in both themes. */
    nodeBg: "hsl(var(--card))",
    border: accent,
    text: accent,
  };
}

// Order layers top to bottom for the swim-lane layout
const layerOrder = [
  "routes",
  "services",
  "models",
  "database",
  "utils",
  "config",
  "tests",
  "frontend",
  "module",
  "other",
];

/** Unknown layers sort last rather than to the top. */
function layerRank(layer: string): number {
  const i = layerOrder.indexOf(layer);
  return i === -1 ? 99 : i;
}

function truncate(text: string, max = 18): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const ArchitectureGraph = forwardRef<
  HTMLDivElement,
  ArchitectureGraphProps
>(function ArchitectureGraph({ nodes, edges }, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Stored as an id, not the node: `nodes` can change under us, and looking the
  // node up on each render means a selection whose node has gone simply closes
  // instead of stranding a stale panel.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Read by the d3 handlers, which are bound once and would otherwise close
  // over a stale `selected`. A ref also keeps selection out of the draw
  // effect's deps — clicking a node must not rebuild the whole SVG.
  const selectedIdRef = useRef<string | null>(null);
  const [hover, setHover] = useState<{
    node: Node;
    x: number;
    y: number;
  } | null>(null);

  const canvas = useVizCanvas();
  const reducedMotion = useReducedMotion();
  const zoom = useVizZoom(!reducedMotion);
  // Bridges the effect's `applySelection` out to the keyboard handler, which
  // lives outside the d3 closure. Same trick the mind map uses for its fit.
  const clearSelectionRef = useRef<(() => void) | null>(null);

  const nav = useVizNodeNav({
    // Re-uses the click path rather than duplicating it, so Enter and a mouse
    // click can never drift apart.
    onActivate: (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    onEscape: () => clearSelectionRef.current?.(),
  });

  useImperativeHandle(ref, () => canvas.containerRef.current!);

  /** One key per layer actually present, in lane order, with its node count. */
  const legendItems: VizLegendItem[] = useMemo(() => {
    const counts = new Map<string, number>();
    nodes.forEach((n) => {
      const layer = n.type?.toLowerCase() || "other";
      counts.set(layer, (counts.get(layer) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort(([a], [b]) => layerRank(a) - layerRank(b))
      .map(([layer, count]) => ({
        color: getLayerStyle(layer).border,
        label: `${titleCase(layer)} (${count})`,
      }));
  }, [nodes]);

  useEffect(() => {
    if (!svgRef.current || !canvas.containerRef.current || nodes.length === 0) return;

    const width = canvas.containerRef.current.clientWidth || 800;
    const height = canvas.containerRef.current.clientHeight || 500;
    // T16: `nodeW` was a fixed 140. On a 270px canvas that fits one node per
    // row, so every lane became a tall single column and the auto-fit scaled
    // 11px labels down to roughly 3px. Narrower chips fit two per row and the
    // fit stays legible. Truncation follows the width so labels still fill it.
    const narrow = width < 560;
    const nodeW = narrow ? 104 : 140;
    const labelChars = narrow ? 12 : 18;
    const nodeH = 32;
    const layerPadding = narrow ? 12 : 18;
    const gutter = narrow ? 10 : 16;
    /** Left inset of the swim-lane band. Halved when there is no room to spare. */
    const laneX = narrow ? 10 : 20;
    const hoverMs = reducedMotion ? 0 : 150;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const g = svg.append("g");

    /** Stroke width a node returns to on mouseleave — selection outlives hover. */
    const restingStroke = (id: string): number =>
      selectedIdRef.current === id ? 3 : 1.5;

    /** Repaint every node's resting stroke against the current selection. */
    const applySelection = (id: string | null) => {
      g.selectAll<SVGGElement, unknown>("g.arch-node").each(function () {
        const nodeId = this.getAttribute("data-node-id");
        d3.select(this)
          .select("rect")
          .transition()
          .duration(hoverMs)
          .attr("stroke-width", nodeId === id ? 3 : 1.5);
      });
    };

    // Degree counts, computed once. The aria label needs them per node, and a
    // filter over `edges` inside the node loop would be quadratic.
    const outDeg = new Map<string, number>();
    const inDeg = new Map<string, number>();
    edges.forEach((e) => {
      outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
      inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
    });

    /**
     * What a screen reader hears on a node.
     *
     * The drawn chip shows a name truncated to 12–18 characters and nothing
     * else, so the label has to carry the full name, the lane, and the shape
     * of its connections — otherwise the chart is announced as a list of
     * abbreviations.
     */
    const ariaLabelFor = (node: Node): string => {
      const layer = node.type || "other";
      const out = outDeg.get(node.id) ?? 0;
      const inc = inDeg.get(node.id) ?? 0;
      if (out === 0 && inc === 0) {
        return `${node.label}, ${layer} layer, no connections`;
      }
      return `${node.label}, ${layer} layer, depends on ${out}, used by ${inc}`;
    };

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
      .attr("fill", inkDimVar());

    // Group nodes by layer
    const groups = new Map<string, Node[]>();
    nodes.forEach((n) => {
      const layer = n.type?.toLowerCase() || "other";
      if (!groups.has(layer)) groups.set(layer, []);
      groups.get(layer)!.push(n);
    });

    // Sort groups by layer order
    const sortedLayers = [...groups.keys()].sort(
      (a, b) => layerRank(a) - layerRank(b),
    );

    // Position nodes in swim-lanes
    const nodePositions = new Map<string, { x: number; y: number }>();
    let currentY = 40;

    sortedLayers.forEach((layer) => {
      const layerNodes = groups.get(layer)!;
      const style = getLayerStyle(layer);
      const laneW = width - (narrow ? 20 : 40);
      const nodesPerRow = Math.max(1, Math.floor(laneW / (nodeW + gutter)));
      const rows = Math.ceil(layerNodes.length / nodesPerRow);
      const laneH = rows * (nodeH + 12) + layerPadding * 2 + 24;

      // Swim-lane background
      g.append("rect")
        .attr("x", laneX)
        .attr("y", currentY)
        .attr("width", laneW)
        .attr("height", laneH)
        .attr("rx", 12)
        .attr("fill", style.laneBg)
        .attr("stroke", style.border)
        .attr("stroke-width", 1)
        .attr("stroke-opacity", 0.3);

      // Lane label
      g.append("text")
        .attr("x", laneX + 16)
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
        const totalCols = Math.min(
          layerNodes.length - row * nodesPerRow,
          nodesPerRow,
        );
        const startX = laneX + (laneW - totalCols * (nodeW + gutter)) / 2;
        const x = startX + col * (nodeW + gutter) + nodeW / 2;
        const y = currentY + layerPadding + 28 + row * (nodeH + 12) + nodeH / 2;
        nodePositions.set(node.id, { x, y });
      });

      currentY += laneH + 12;
    });

    // Draw edges — curved Bézier
    edges.forEach((edge) => {
      const src = nodePositions.get(edge.source);
      const tgt = nodePositions.get(edge.target);
      if (!src || !tgt) return;

      const midY = (src.y + tgt.y) / 2;

      g.append("path")
        .attr(
          "d",
          `M${src.x},${src.y + nodeH / 2} C${src.x},${midY} ${tgt.x},${midY} ${tgt.x},${tgt.y - nodeH / 2}`,
        )
        .attr("fill", "none")
        .attr("stroke", inkDimVar())
        .attr("stroke-width", 1.5)
        .attr("stroke-opacity", 0.7)
        .attr("marker-end", "url(#arch-arrow)");
    });

    // Draw node rectangles
    nodes.forEach((node) => {
      const pos = nodePositions.get(node.id);
      if (!pos) return;
      const style = getLayerStyle(node.type);

      const nodeGroup = g
        .append("g")
        // `viz-node` is what the focus-ring rule in globals.css hooks; the
        // nav controller adds `tabindex="-1"` once the nodes exist.
        .attr("class", "arch-node viz-node")
        .attr("data-node-id", node.id)
        .attr("transform", `translate(${pos.x},${pos.y})`)
        // `button`, not `img`: these open a detail panel, and the label has to
        // carry the untruncated name plus the connection counts, because the
        // drawn chip shows neither. Deliberately not an SVG `<title>`, which
        // the browser also renders as a native tooltip that would fight the
        // real one.
        .attr("role", "button")
        .attr("aria-label", ariaLabelFor(node))
        .style("cursor", "pointer");

      // Rounded rectangle
      nodeGroup
        .append("rect")
        .attr("x", -nodeW / 2)
        .attr("y", -nodeH / 2)
        .attr("width", nodeW)
        .attr("height", nodeH)
        .attr("rx", 8)
        .attr("fill", style.nodeBg)
        .attr("stroke", style.border)
        .attr("stroke-width", restingStroke(node.id));

      // Label
      nodeGroup
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .attr("fill", style.text)
        .attr("font-size", 11)
        .attr("font-weight", 500)
        .text(truncate(node.label, labelChars));

      // Click — open the detail panel. Until T7 these nodes carried
      // `cursor: pointer` with no handler behind it, promising an interaction
      // that did not exist. Labels truncate at 18 characters, so the full name
      // and the node's connections are worth surfacing.
      nodeGroup
        .on("click", (event) => {
          event.stopPropagation();
          setSelectedId(node.id);
          selectedIdRef.current = node.id;
          applySelection(node.id);
        })
        .on("mouseenter", function () {
          d3.select(this)
            .select("rect")
            .transition()
            .duration(hoverMs)
            .attr("stroke-width", 2.5);
        })
        .on("mousemove", (event: MouseEvent) => {
          // Container coordinates, never `event.offsetX` — offsetX is relative
          // to whichever SVG child was hovered and differs across browsers.
          const rect = canvas.containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          setHover({
            node,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          });
        })
        .on("mouseleave", function () {
          setHover(null);
          d3.select(this)
            .select("rect")
            .transition()
            .duration(hoverMs)
            .attr("stroke-width", restingStroke(node.id));
        });
    });

    // Clicking the canvas clears the selection, matching DataFlowGraph.
    const clearSelection = () => {
      setSelectedId(null);
      selectedIdRef.current = null;
      applySelection(null);
    };
    svg.on("click", clearSelection);
    clearSelectionRef.current = clearSelection;

    // Hand the drawn nodes to the keyboard controller. Must run after the
    // node loop — it stamps `tabindex` on what it finds.
    nav.register(g.node(), "g.arch-node");

    // The chart owns the behavior (scale extent and transform target are
    // chart-specific); the shell drives it through the controller.
    const zoomBehavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([ZOOM_MIN, ZOOM_MAX])
      .on("zoom", (event) => g.attr("transform", event.transform));
    svg.call(zoomBehavior);
    zoom.register(svgRef.current, zoomBehavior, g.node());

    // Frame the real rendered content (B4). This used to be four guessed
    // constants — `bboxX = 10, bboxW = width - 20` — which assumed the content
    // always spanned the full lane, so a repo with two modules fitted to
    // whitespace. `fitToView` reads `getBBox()` instead.
    zoom.fitToView({ animate: false });

    return () => {
      zoom.register(null, null, null);
      nav.register(null);
      clearSelectionRef.current = null;
      svg.selectAll("*").remove();
    };
  }, [nodes, edges, canvas.size, canvas.containerRef, zoom, nav, reducedMotion]);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <VizShell
      canvas={canvas}
      zoom={zoom}
      nav={nav}
      label="Architecture diagram"
      description={
        `Modules grouped into ${legendItems.length} layered swim-lanes, ` +
        "flowing top to bottom. Color indicates the layer and arrows point " +
        `from a module to what it depends on. ${nodes.length} modules, ` +
        `${edges.length} dependencies.`
      }
      legend={<VizLegend title="Layers" items={legendItems} />}
      overlay={
        <>
          {selected && (
            <NodeDetail
              node={selected}
              nodes={nodes}
              edges={edges}
              onClose={() => {
                setSelectedId(null);
                selectedIdRef.current = null;
              }}
            />
          )}
          {/* Suppressed behind the panel, which occupies the same corner and
              already says everything the tooltip would. */}
          {hover && !selected && (
            <VizTooltip
              x={hover.x}
              y={hover.y}
              containerWidth={canvas.size.width}
              containerHeight={canvas.size.height}
            >
              <div className="break-words font-mono text-[11px] font-medium text-foreground">
                {hover.node.label}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {hover.node.type || "other"}
              </div>
              <div className="mt-1.5 text-muted-foreground">
                {edges.filter((e) => e.source === hover.node.id).length} out ·{" "}
                {edges.filter((e) => e.target === hover.node.id).length} in
              </div>
              <div className="mt-1.5 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
                Click for connections
              </div>
            </VizTooltip>
          )}
        </>
      }
    >
      <svg ref={svgRef} className="w-full h-full" />
    </VizShell>
  );
});

/**
 * What a node click reveals. Node labels truncate at 18 characters and the
 * lane itself only says which layer a node sits in — neither answers "what
 * does this connect to", which is the question an architecture diagram exists
 * to answer.
 */
function NodeDetail({
  node,
  nodes,
  edges,
  onClose,
}: {
  node: Node;
  nodes: Node[];
  edges: Edge[];
  onClose: () => void;
}) {
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const dependsOn = edges.filter((e) => e.source === node.id).map((e) => labelOf(e.target));
  const usedBy = edges.filter((e) => e.target === node.id).map((e) => labelOf(e.source));

  return (
    <div className="glass-panel absolute top-3 left-3 z-20 max-w-xs rounded-lg px-4 py-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-foreground break-words">{node.label}</div>
          <div className="mt-0.5 uppercase tracking-wide text-[10px] text-muted-foreground">
            {node.type || "other"}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground"
        >
          ×
        </button>
      </div>

      <ConnectionList title="Depends on" items={dependsOn} />
      <ConnectionList title="Used by" items={usedBy} />

      {dependsOn.length === 0 && usedBy.length === 0 && (
        // Said plainly: an isolated node is a finding, not an empty panel.
        <p className="mt-2 text-muted-foreground">No connections in this view.</p>
      )}
    </div>
  );
}

function ConnectionList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {title} ({items.length})
      </div>
      <div className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
        {items.map((label) => (
          <div key={label} className="truncate font-mono text-[11px] text-muted-foreground">
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
