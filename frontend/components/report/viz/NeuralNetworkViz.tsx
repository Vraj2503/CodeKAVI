/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import { motion, AnimatePresence } from "framer-motion";
import { Info, Layers } from "lucide-react";
import { useVizCanvas } from "@/components/viz/useVizCanvas";
import { useReducedMotion } from "@/components/viz/useReducedMotion";
import type { NNModel, NNLayer } from "@/lib/api";
import { catVar, inkVar, inkDimVar } from "@/lib/viz/tokens";

/** Skip connections read as a deliberate exception to the sequential flow. */
const SKIP_COLOR = catVar(3);

// ── Color Palette (PlotNeuralNet-inspired) ──
const CATEGORY_COLORS: Record<string, { base: string; top: string; side: string; text: string }> = {
  convolution:   { base: "#4A90D9", top: "#6BABEF", side: "#3570B0", text: "#fff" },
  pooling:       { base: "#E8734A", top: "#F09B7A", side: "#C05A35", text: "#fff" },
  dense:         { base: "#5CB85C", top: "#7ED47E", side: "#449944", text: "#fff" },
  normalization: { base: "#F5A623", top: "#F8C060", side: "#D08E1C", text: "#fff" },
  activation:    { base: "#9B59B6", top: "#B87AD0", side: "#7D4492", text: "#fff" },
  dropout:       { base: "#95A5A6", top: "#B0BCBD", side: "#778889", text: "#fff" },
  recurrent:     { base: "#1ABC9C", top: "#48D4B8", side: "#149A7E", text: "#fff" },
  attention:     { base: "#E91E63", top: "#F06292", side: "#C2185B", text: "#fff" },
  embedding:     { base: "#3F51B5", top: "#7986CB", side: "#303F9F", text: "#fff" },
  output:        { base: "#C0392B", top: "#E06055", side: "#A02D22", text: "#fff" },
  other:         { base: "#607D8B", top: "#8EAAB5", side: "#4A6470", text: "#fff" },
};

// Oblique projection for PlotNeuralNet style
function isoProject(x: number, y: number, z: number) {
  const angle = Math.PI / 6; // 30 degrees
  const zScale = 0.6;
  return {
    sx: x + z * zScale * Math.cos(angle),
    sy: -y - z * zScale * Math.sin(angle),
  };
}

// Build 3D cuboid polygon points for SVG
function buildCuboidPolygons(
  cx: number,
  cy: number,
  w: number,  // width (x-axis — thickness/channels)
  h: number,  // height (y-axis — spatial H)
  d: number,  // depth (z-axis — spatial W)
) {
  // 8 corners of the cuboid in 3D
  const corners3D = [
    { x: -w / 2, y: -h / 2, z: -d / 2 }, // 0: front-bottom-left
    { x: w / 2,  y: -h / 2, z: -d / 2 }, // 1: front-bottom-right
    { x: w / 2,  y: h / 2,  z: -d / 2 }, // 2: front-top-right
    { x: -w / 2, y: h / 2,  z: -d / 2 }, // 3: front-top-left
    { x: -w / 2, y: -h / 2, z: d / 2 },  // 4: back-bottom-left
    { x: w / 2,  y: -h / 2, z: d / 2 },  // 5: back-bottom-right
    { x: w / 2,  y: h / 2,  z: d / 2 },  // 6: back-top-right
    { x: -w / 2, y: h / 2,  z: d / 2 },  // 7: back-top-left
  ];

  const projected = corners3D.map((c) => {
    const p = isoProject(c.x, c.y, c.z);
    return { x: cx + p.sx, y: cy + p.sy };
  });

  // Front face: 0,1,2,3
  const front = [projected[0], projected[1], projected[2], projected[3]]
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

  // Top face: 3,2,6,7
  const top = [projected[3], projected[2], projected[6], projected[7]]
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

  // Right face: 1,5,6,2
  const right = [projected[1], projected[5], projected[6], projected[2]]
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

  // Center of the entire block on screen for labels
  const labelCenter = {
    x: cx,
    y: cy,
  };

  // Center of the right face (large square face on the right) for arrow origin
  const rightAnchor = {
    x: (projected[1].x + projected[5].x + projected[6].x + projected[2].x) / 4,
    y: (projected[1].y + projected[5].y + projected[6].y + projected[2].y) / 4,
  };

  // Center of the left face (large square face on the left) for arrow destination
  const leftAnchor = {
    x: (projected[0].x + projected[4].x + projected[7].x + projected[3].x) / 4,
    y: (projected[0].y + projected[4].y + projected[7].y + projected[3].y) / 4,
  };

  // Calculate lowest point on screen for placing text below
  const lowestY = Math.max(
    projected[0].y, projected[1].y, projected[4].y, projected[5].y
  );

  return { front, top, right, labelCenter, rightAnchor, leftAnchor, lowestY };
}

function formatParamCount(count: number): string {
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
  return count.toString();
}

function formatShape(shape: number[] | undefined): string {
  if (!shape || shape.length === 0) return "";
  return shape.join("×");
}

// ── Single Model Renderer ──
interface ModelRendererProps {
  model: NNModel;
  index: number;
}

function ModelRenderer({ model, index }: ModelRendererProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  // T8: this listened to `window` resize, which a sidebar collapse never
  // fires — the container changes, the window does not. `useVizCanvas`
  // observes the container itself, debounced so the collapse animation does
  // not re-lay-out the model on every frame of it.
  const canvas = useVizCanvas();
  const { attach } = canvas;
  const reducedMotion = useReducedMotion();
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    layer: NNLayer | null;
  }>({ visible: false, x: 0, y: 0, layer: null });

  const renderModel = useCallback(() => {
    if (!svgRef.current || !canvas.ready) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const containerWidth = canvas.size.width || 900;
    const containerHeight = Math.max(400, canvas.size.height || 500);

    svg.attr("width", containerWidth).attr("height", containerHeight);

    const g = svg.append("g").attr("class", "nn-viz-root");

    // Layout parameters
    const BLOCK_GAP = 85;
    const START_X = 80;
    const CENTER_Y = containerHeight / 2;
    const SCALE = 1.8;

    const layers = model.layers;
    if (layers.length === 0) return;

    // Compute positions for each layer block
    interface LayerLayout {
      layer: NNLayer;
      cx: number;
      cy: number;
      w: number;
      h: number;
      d: number;
      polys: ReturnType<typeof buildCuboidPolygons>;
    }
    const layouts: LayerLayout[] = [];
    let currentX = START_X;

    for (const layer of layers) {
      const dims = layer.block_dims || { width: 2, height: 20, depth: 20 };
      const w = dims.width * SCALE;
      const h = dims.height * SCALE;
      const d = dims.depth * SCALE;

      const cx = currentX + w / 2 + d * 0.6 * Math.cos(Math.PI / 6);
      const cy = CENTER_Y;

      const polys = buildCuboidPolygons(cx, cy, w, h, d);

      layouts.push({ layer, cx, cy, w, h, d, polys });

      currentX += w + d * 0.6 * Math.cos(Math.PI / 6) + BLOCK_GAP;
    }

    // Total width for viewBox
    const totalWidth = currentX + 80;
    svg.attr("viewBox", `0 0 ${totalWidth} ${containerHeight}`)
       .attr("preserveAspectRatio", "xMidYMid meet");

    // ── Arrow markers ──
    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", `arrowhead-${index}`)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", inkDimVar());

    defs.append("marker")
      .attr("id", `arrowhead-skip-${index}`)
      .attr("viewBox", "0 0 10 10")
      .attr("refX", 9)
      .attr("refY", 5)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M 0 0 L 10 5 L 0 10 z")
      .attr("fill", SKIP_COLOR);

    // ── Draw connections ──
    const connectionGroup = g.append("g").attr("class", "connections");

    // Build layer ID → layout index map
    const idToIndex = new Map<string, number>();
    layouts.forEach((l, i) => idToIndex.set(l.layer.id, i));

    for (const conn of model.connections) {
      const fromIdx = idToIndex.get(conn.from_id);
      const toIdx = idToIndex.get(conn.to_id);

      if (fromIdx !== undefined && toIdx !== undefined) {
        const from = layouts[fromIdx];
        const to = layouts[toIdx];

        if (conn.type === "skip") {
          // Skip connection — curved path above
          const midX = (from.polys.rightAnchor.x + to.polys.leftAnchor.x) / 2;
          const arcY = Math.min(from.polys.rightAnchor.y, to.polys.leftAnchor.y) - 60;

          connectionGroup
            .append("path")
            .attr("d", `M ${from.polys.rightAnchor.x} ${from.polys.rightAnchor.y} Q ${midX} ${arcY} ${to.polys.leftAnchor.x} ${to.polys.leftAnchor.y}`)
            .attr("fill", "none")
            .attr("stroke", SKIP_COLOR)
            .attr("stroke-width", 2)
            .attr("stroke-dasharray", "6,4")
            .attr("opacity", 0.7)
            .attr("marker-end", `url(#arrowhead-skip-${index})`);
        } else {
          // Sequential connection — straight arrow
          connectionGroup
            .append("line")
            .attr("x1", from.polys.rightAnchor.x)
            .attr("y1", from.polys.rightAnchor.y)
            .attr("x2", to.polys.leftAnchor.x)
            .attr("y2", to.polys.leftAnchor.y)
            .attr("stroke", inkDimVar())
            .attr("stroke-width", 1.5)
            .attr("opacity", 0.5)
            .attr("marker-end", `url(#arrowhead-${index})`);

          // Dimension label on arrow
          if (from.layer.output_shape) {
            const midX = (from.polys.rightAnchor.x + to.polys.leftAnchor.x) / 2;
            const midY = (from.polys.rightAnchor.y + to.polys.leftAnchor.y) / 2 - 15;

            connectionGroup
              .append("text")
              .attr("x", midX)
              .attr("y", midY)
              .attr("text-anchor", "middle")
              .attr("font-size", "10px")
              .attr("fill", inkDimVar())
              .attr("font-family", "monospace")
              .text(formatShape(from.layer.output_shape));
          }
        }
      }
    }

    // ── Draw layer blocks ──
    const layerGroup = g.append("g").attr("class", "layers");

    for (let i = 0; i < layouts.length; i++) {
      const { layer, polys } = layouts[i];
      const colors = CATEGORY_COLORS[layer.category] || CATEGORY_COLORS.other;
      const layerClass = `layer-${layer.id.replace(/[^a-zA-Z0-9]/g, "_")}-${i}`;

      const blockG = layerGroup.append("g")
        .attr("class", `layer-block ${layerClass}`)
        .attr("cursor", "pointer")
        .style("opacity", 0);

      // Staggered entrance — T11: under reduced motion the blocks are simply
      // there, rather than cascading in.
      blockG.transition()
        .delay(reducedMotion ? 0 : i * 60)
        .duration(reducedMotion ? 0 : 400)
        .style("opacity", 1);

      // Right side face (large square face — draw first — behind)
      blockG.append("polygon")
        .attr("points", polys.right)
        .attr("fill", colors.base)
        .attr("stroke", "rgba(0,0,0,0.15)")
        .attr("stroke-width", 0.5);

      // Top face
      blockG.append("polygon")
        .attr("points", polys.top)
        .attr("fill", colors.top)
        .attr("stroke", "rgba(0,0,0,0.1)")
        .attr("stroke-width", 0.5);

      // Front face (thin vertical strip)
      const frontFace = blockG.append("polygon")
        .attr("points", polys.front)
        .attr("fill", colors.side)
        .attr("stroke", "rgba(0,0,0,0.2)")
        .attr("stroke-width", 0.5);

      // Layer type label (moved below block)
      blockG.append("text")
        .attr("x", polys.labelCenter.x)
        .attr("y", polys.lowestY + 16)
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("font-weight", "600")
        .attr("fill", inkVar())
        .attr("pointer-events", "none")
        .text(layer.type);

      // Param count below block
      if (layer.param_count && layer.param_count > 0) {
        blockG.append("text")
          .attr("x", polys.labelCenter.x)
          .attr("y", polys.lowestY + 28)
          .attr("text-anchor", "middle")
          .attr("font-size", "10px")
          .attr("fill", inkDimVar())
          .attr("font-family", "monospace")
          .text(formatParamCount(layer.param_count));
      }

      // Hover interaction
      blockG
        .on("mouseenter", (event: MouseEvent) => {
          frontFace.attr("fill", `${colors.side}dd`);
          // Also highlight the right face slightly
          blockG.select("polygon").attr("fill", `${colors.base}dd`);
          const rect = canvas.containerRef.current?.getBoundingClientRect();
          if (rect) {
            setTooltip({
              visible: true,
              x: event.clientX - rect.left + 15,
              y: event.clientY - rect.top - 10,
              layer,
            });
          }
        })
        .on("mouseleave", () => {
          frontFace.attr("fill", colors.side);
          blockG.select("polygon").attr("fill", colors.base);
          setTooltip((prev) => ({ ...prev, visible: false }));
        });
    }

    // ── Zoom + Pan ──
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
      });

    svg.call(zoom);

  }, [model, index, canvas.size, canvas.ready, canvas.containerRef, reducedMotion]);

  useEffect(() => {
    renderModel();
  }, [renderModel]);

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { delay: index * 0.15, duration: 0.5 }
      }
      className="relative w-full"
    >
      {/* Model Header */}
      <div className="flex items-center gap-3 mb-4 px-2">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
          <Layers size={16} className="text-primary" />
        </div>
        <div>
          <h3 className="text-base font-bold text-foreground">{model.name}</h3>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">{model.file}:{model.line}</span>
            <span className="px-1.5 py-0.5 rounded bg-muted text-xs font-medium">{model.framework}</span>
            <span>{model.layers.length} layers</span>
            {model.total_params && (
              <span>{formatParamCount(model.total_params)} params</span>
            )}
          </div>
        </div>
      </div>

      {/* SVG Canvas */}
      <div
        ref={attach}
        className="relative w-full bg-card/50 rounded-2xl border border-border/50 overflow-hidden"
        style={{ height: "420px" }}
      >
        <svg ref={svgRef} className="w-full h-full" />

        {/* Tooltip */}
        <AnimatePresence>
          {tooltip.visible && tooltip.layer && (
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
              transition={reducedMotion ? { duration: 0 } : undefined}
              className="absolute z-50 pointer-events-none"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <div className="bg-popover border border-border rounded-xl shadow-xl p-3 min-w-[200px] max-w-[300px]">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-3 h-3 rounded"
                    style={{ backgroundColor: (CATEGORY_COLORS[tooltip.layer.category] || CATEGORY_COLORS.other).base }}
                  />
                  <span className="text-sm font-bold text-foreground">{tooltip.layer.type}</span>
                  <span className="text-xs text-muted-foreground">({tooltip.layer.category})</span>
                </div>
                <div className="space-y-1 text-xs">
                  {tooltip.layer.param_count != null && tooltip.layer.param_count > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Parameters:</span>
                      <span className="font-mono text-foreground">
                        {formatParamCount(tooltip.layer.param_count)}
                      </span>
                    </div>
                  )}
                  {tooltip.layer.output_shape && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Output:</span>
                      <span className="font-mono text-foreground">
                        {formatShape(tooltip.layer.output_shape)}
                      </span>
                    </div>
                  )}
                  {tooltip.layer.activation && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Activation:</span>
                      <span className="font-mono text-foreground">{tooltip.layer.activation}</span>
                    </div>
                  )}
                  {Object.entries(tooltip.layer.params).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <div className="text-muted-foreground mb-1">Parameters:</div>
                      {Object.entries(tooltip.layer.params).map(([k, v]) => (
                        <div key={k} className="flex justify-between">
                          <span className="text-muted-foreground">{k}:</span>
                          <span className="font-mono text-foreground">{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

// ── Legend ──
function NNLegend() {
  const categories = [
    { key: "convolution", label: "Convolution" },
    { key: "pooling", label: "Pooling" },
    { key: "dense", label: "Dense / FC" },
    { key: "normalization", label: "Normalization" },
    { key: "activation", label: "Activation" },
    { key: "dropout", label: "Dropout" },
    { key: "recurrent", label: "Recurrent" },
    { key: "attention", label: "Attention" },
    { key: "embedding", label: "Embedding" },
  ];

  return (
    <div className="flex flex-wrap gap-3 px-2 py-3">
      {categories.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-1.5">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: CATEGORY_COLORS[key]?.base || "#607D8B" }}
          />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Export ──
interface NeuralNetworkVizProps {
  models?: NNModel[];
  data?: any; // Fallback for VizContainer data passing
}

export function NeuralNetworkViz({ models, data }: NeuralNetworkVizProps) {
  // Support both direct models prop and data.models from viz pipeline
  const resolvedModels = models || data?.models || [];

  if (resolvedModels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] text-center p-8">
        <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
          <Info size={28} className="text-muted-foreground" />
        </div>
        <h3 className="text-lg font-bold text-foreground mb-2">No Neural Networks Detected</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          This repository doesn&apos;t contain recognizable neural network model definitions
          (e.g., PyTorch nn.Module, Keras Sequential, or TensorFlow models).
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      {/* Legend */}
      <NNLegend />

      {/* Models — stacked vertically */}
      {resolvedModels.map((model: NNModel, idx: number) => (
        <ModelRenderer key={`${model.name}-${idx}`} model={model} index={idx} />
      ))}
    </div>
  );
}
