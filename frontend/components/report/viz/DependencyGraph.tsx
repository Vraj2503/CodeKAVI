"use client";

/**
 * DependencyGraph — Two-stage graph visualization with ElkJS.
 *
 * Views:  Module (directory-level, default) / File (individual files).
 * Layout: Layered (ElkJS DAG, default) / Force (D3 simulation).
 * Click a module node to drill into its constituent files.
 *
 * This preserves the original circular-node + directional-arrow design while
 * adding module-level aggregation and hierarchical layout.
 */

import {
  useRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as d3 from "d3";
// @ts-ignore — bundled version runs synchronously, avoids web-worker issues in Next.js
import ELK from "elkjs/lib/elk.bundled.js";

/* ── Types ────────────────────────────────────────────────── */

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

interface ModuleNode {
  id: string;
  label: string;
  group: string;
  file_count: number;
  importance: number;
  in_weight: number;
  out_weight: number;
  primary_language: string;
  size: number;
}

interface ModuleEdge {
  source: string;
  target: string;
  weight: number;
}

interface ModuleInfo {
  name: string;
  file_count: number;
  files: string[];
  languages: Record<string, number>;
  roles: Record<string, number>;
  importance: number;
  internal_edges: number;
}

export interface DependencyGraphProps {
  nodes: Node[];
  edges: Edge[];
  moduleGraph?: { nodes: ModuleNode[]; edges: ModuleEdge[] };
  modules?: ModuleInfo[];
}

type ViewMode = "module" | "file";
type LayoutMode = "layered" | "force";
type DisplayNode = Node & { _fileCount?: number; _colorIdx?: number };

/* ── Singleton ELK instance ───────────────────────────────── */

const elk = new ELK();

/* ── Color palettes ───────────────────────────────────────── */

const TYPE_COLORS: Record<string, string> = {
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

const MOD_PALETTE = [
  "#58a6ff",
  "#3fb950",
  "#bc8cff",
  "#f0883e",
  "#f778ba",
  "#79c0ff",
  "#56d364",
  "#d2a8ff",
];

/* ── Helpers ──────────────────────────────────────────────── */

function getNodeColor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] || "#8b949e";
}

function modColor(idx: number): string {
  return MOD_PALETTE[idx % MOD_PALETTE.length];
}

function modRadius(fileCount: number): number {
  return Math.min(22 + Math.sqrt(fileCount) * 5, 55);
}

function truncate(text: string, max = 15): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Infer a coarse architectural type from a directory name. */
function inferType(name: string): string {
  const l = name.toLowerCase();
  if (/route|api|endpoint|handler/.test(l)) return "routes";
  if (/model|schema|entity/.test(l)) return "models";
  if (/service|provider/.test(l)) return "services";
  if (/db|database|migration/.test(l)) return "database";
  if (/util|helper|lib|common/.test(l)) return "utils";
  if (/config|setting|env/.test(l)) return "config";
  if (/test|spec/.test(l)) return "tests";
  if (/component|widget|ui|view|page/.test(l)) return "component";
  return "module";
}

/* ── ELK layout helper ───────────────────────────────────── */

async function runElkLayout(
  nodes: { id: string; w: number; h: number }[],
  edges: { source: string; target: string }[],
  canvasW: number,
  canvasH: number
): Promise<Map<string, { x: number; y: number }>> {
  if (nodes.length === 0) return new Map();

  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter(
    (e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target
  );

  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "50",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.edgeRouting": "POLYLINE",
    },
    children: nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })),
    edges: valid.map((e, i) => ({
      id: `e${i}`,
      sources: [e.source],
      targets: [e.target],
    })),
  });

  // Centre the layout in the viewport
  let mnX = Infinity,
    mnY = Infinity,
    mxX = -Infinity,
    mxY = -Infinity;
  for (const c of result.children || []) {
    const cx = (c.x || 0) + (c.width || 0) / 2;
    const cy = (c.y || 0) + (c.height || 0) / 2;
    mnX = Math.min(mnX, cx);
    mnY = Math.min(mnY, cy);
    mxX = Math.max(mxX, cx);
    mxY = Math.max(mxY, cy);
  }
  const gw = mxX - mnX || 1;
  const gh = mxY - mnY || 1;
  const ox = (canvasW - gw) / 2 - mnX;
  const oy = (canvasH - gh) / 2 - mnY;

  const pos = new Map<string, { x: number; y: number }>();
  for (const c of result.children || []) {
    pos.set(c.id, {
      x: (c.x || 0) + (c.width || 0) / 2 + ox,
      y: (c.y || 0) + (c.height || 0) / 2 + oy,
    });
  }
  return pos;
}

/* ── Component ────────────────────────────────────────────── */

export const DependencyGraph = forwardRef<HTMLDivElement, DependencyGraphProps>(
  function DependencyGraph({ nodes, edges, moduleGraph, modules }, ref) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    const hasMods = !!(moduleGraph?.nodes?.length);
    const [view, setView] = useState<ViewMode>(hasMods ? "module" : "file");
    const [layout, setLayout] = useState<LayoutMode>("layered");
    const [expanded, setExpanded] = useState<string | null>(null);

    useImperativeHandle(ref, () => containerRef.current!);

    // Sync default view mode when module data becomes available
    useEffect(() => {
      if (hasMods) setView("module");
    }, [hasMods]);

    // Reset expansion when the user switches view modes
    useEffect(() => {
      setExpanded(null);
    }, [view]);

    // Track container dimensions for re-rendering on resize / sidebar toggle
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      setContainerSize({ width: el.clientWidth, height: el.clientHeight });
      let timer: NodeJS.Timeout;
      const obs = new ResizeObserver((entries) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const r = entries[0]?.contentRect;
          if (r) setContainerSize({ width: r.width, height: r.height });
        }, 150);
      });
      obs.observe(el);
      return () => {
        obs.disconnect();
        clearTimeout(timer);
      };
    }, []);

    /* ── Derive active nodes / edges / radius from view state ── */

    const { dispNodes, dispEdges, radiusOf } = useMemo(() => {
      const rm = new Map<string, number>();

      // ── Module view (not expanded) ──
      if (view === "module" && !expanded && moduleGraph?.nodes?.length) {
        const dn: DisplayNode[] = moduleGraph.nodes.map((m, i) => {
          rm.set(m.id, modRadius(m.file_count));
          return {
            id: m.id,
            label: m.label,
            type: inferType(m.label),
            _fileCount: m.file_count,
            _colorIdx: i,
          };
        });
        const de: Edge[] = moduleGraph.edges.map((me) => ({
          source: me.source,
          target: me.target,
          label: me.weight > 1 ? String(me.weight) : undefined,
        }));
        return {
          dispNodes: dn,
          dispEdges: de,
          radiusOf: (id: string) => rm.get(id) || 22,
        };
      }

      // ── Module view — expanded (files within one module) ──
      if (view === "module" && expanded && modules) {
        const mod = modules.find((m) => m.name === expanded);
        if (mod) {
          const fileSet = new Set(mod.files);
          const dn: DisplayNode[] = [];
          const seen = new Set<string>();
          for (const n of nodes) {
            if (fileSet.has(n.id)) {
              dn.push({ ...n });
              seen.add(n.id);
            }
          }
          // Create nodes for files that don't appear in file-level data
          for (const f of mod.files) {
            if (!seen.has(f)) {
              dn.push({
                id: f,
                label: f.split("/").pop() || f,
                type: "file",
              });
            }
          }
          dn.forEach((n) => rm.set(n.id, 20));
          const de = edges.filter(
            (e) => fileSet.has(e.source) && fileSet.has(e.target)
          );
          return {
            dispNodes: dn,
            dispEdges: de,
            radiusOf: (id: string) => rm.get(id) || 20,
          };
        }
      }

      // ── File view (default fallback) ──
      nodes.forEach((n) => rm.set(n.id, 20));
      return {
        dispNodes: nodes as DisplayNode[],
        dispEdges: edges,
        radiusOf: (id: string) => rm.get(id) || 20,
      };
    }, [view, expanded, nodes, edges, moduleGraph, modules]);

    /* ── Main D3 render effect ─────────────────────────────── */

    useEffect(() => {
      if (!svgRef.current || !containerRef.current || dispNodes.length === 0)
        return;

      let cancelled = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let sim: d3.Simulation<any, any> | null = null;

      const W = containerRef.current.clientWidth || 800;
      const H = containerRef.current.clientHeight || 500;
      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove();
      svg.attr("width", W).attr("height", H);
      const g = svg.append("g");
      const defs = svg.append("defs");

      const isModView = view === "module" && !expanded;

      // Arrowhead markers — one per unique target radius so arrows
      // stop at the circle boundary regardless of node size.
      const uniqueRadii = new Set(dispNodes.map((n) => radiusOf(n.id)));
      for (const r of uniqueRadii) {
        defs
          .append("marker")
          .attr("id", `arr-${r}`)
          .attr("viewBox", "0 -5 10 10")
          .attr("refX", r + 8)
          .attr("refY", 0)
          .attr("markerWidth", 6)
          .attr("markerHeight", 6)
          .attr("orient", "auto")
          .append("path")
          .attr("d", "M0,-5L10,0L0,5")
          .attr("fill", "#30363d");
      }

      // Zoom & pan
      svg.call(
        d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.3, 3])
          .on("zoom", (ev) => g.attr("transform", ev.transform))
      );

      // D3 simulation types
      type SN = d3.SimulationNodeDatum & DisplayNode;
      type SE = d3.SimulationLinkDatum<SN> & { label?: string };

      const sNodes: SN[] = dispNodes.map((n) => ({ ...n }));
      const sEdges: SE[] = dispEdges.map((e) => ({
        source: e.source,
        target: e.target,
        label: e.label,
      }));

      /** Colour a node based on view mode. */
      function colour(d: DisplayNode): string {
        if (isModView && d._colorIdx != null)
          return modColor(d._colorIdx);
        return getNodeColor(d.type);
      }

      /**
       * Build the full SVG graph.
       * @param pos  Pre-computed positions (ELK). Omit for D3 force.
       */
      function draw(pos?: Map<string, { x: number; y: number }>) {
        const nodeById = new Map(sNodes.map((n) => [n.id, n]));

        // For ELK mode, apply positions & resolve edge references manually
        // (force mode resolves edges via d3.forceLink)
        if (pos) {
          sNodes.forEach((n) => {
            const p = pos.get(n.id);
            if (p) {
              n.x = p.x;
              n.y = p.y;
            }
          });
          sEdges.forEach((e) => {
            if (typeof e.source === "string") {
              const s = nodeById.get(e.source);
              if (s) (e as unknown as { source: SN }).source = s;
            }
            if (typeof e.target === "string") {
              const t = nodeById.get(e.target);
              if (t) (e as unknown as { target: SN }).target = t;
            }
          });
        }

        /* ─ Links ─ */
        const link = g
          .append("g")
          .selectAll("line")
          .data(sEdges)
          .join("line")
          .attr("stroke", "#30363d")
          .attr("stroke-width", 1.5)
          .attr("marker-end", (d) => {
            const tid =
              typeof d.target === "object"
                ? (d.target as SN).id
                : String(d.target);
            return `url(#arr-${radiusOf(tid)})`;
          });

        /* ─ Edge labels (e.g. weight) ─ */
        const eLabel = g
          .append("g")
          .selectAll("text")
          .data(sEdges.filter((e) => e.label))
          .join("text")
          .attr("font-size", 10)
          .attr("fill", "#8b949e")
          .attr("text-anchor", "middle")
          .text((d) => d.label || "");

        /* ─ Node groups ─ */
        const node = g
          .append("g")
          .selectAll<SVGGElement, SN>("g")
          .data(sNodes)
          .join("g")
          .style("cursor", isModView ? "pointer" : "default");

        // Circles
        node
          .append("circle")
          .attr("r", (d) => radiusOf(d.id))
          .attr("fill", (d) => colour(d))
          .attr("fill-opacity", isModView ? 0.85 : 1)
          .attr("stroke", "#30363d")
          .attr("stroke-width", 2);

        // Module badges — file count inside the circle
        if (isModView) {
          node
            .append("text")
            .attr("text-anchor", "middle")
            .attr("dy", 1)
            .attr("font-size", (d) => Math.max(10, radiusOf(d.id) * 0.4))
            .attr("font-weight", "bold")
            .attr("fill", "#fff")
            .text((d) =>
              d._fileCount != null ? String(d._fileCount) : ""
            );
          node
            .append("text")
            .attr("text-anchor", "middle")
            .attr("dy", (d) => radiusOf(d.id) * 0.35 + 5)
            .attr("font-size", 8)
            .attr("fill", "rgba(255,255,255,0.7)")
            .text((d) => (d._fileCount ? "files" : ""));
        }

        // Labels below nodes
        node
          .append("text")
          .attr("text-anchor", "middle")
          .attr("dy", (d) => radiusOf(d.id) + 16)
          .attr("font-size", isModView ? 12 : 11)
          .attr("font-weight", isModView ? "600" : "400")
          .attr("fill", "#e6edf3")
          .text((d) => truncate(d.label, isModView ? 20 : 15));

        // Click → expand module
        if (isModView && modules?.length) {
          node.on("click", (_ev, d) => setExpanded(d.id));
        }

        // Hover-highlight connected nodes & edges
        node
          .on("mouseenter", function (_ev, d) {
            d3.select(this)
              .select("circle")
              .attr("stroke", "#58a6ff")
              .attr("stroke-width", 3);
            const linked = new Set<string>([d.id]);
            sEdges.forEach((e) => {
              const s =
                typeof e.source === "object"
                  ? (e.source as SN).id
                  : String(e.source);
              const t =
                typeof e.target === "object"
                  ? (e.target as SN).id
                  : String(e.target);
              if (s === d.id) linked.add(t);
              if (t === d.id) linked.add(s);
            });
            node.style("opacity", (n) => (linked.has(n.id) ? 1 : 0.3));
            link.style("opacity", (l) => {
              const s =
                typeof l.source === "object"
                  ? (l.source as SN).id
                  : String(l.source);
              const t =
                typeof l.target === "object"
                  ? (l.target as SN).id
                  : String(l.target);
              return linked.has(s) && linked.has(t) ? 1 : 0.15;
            });
          })
          .on("mouseleave", function () {
            node.style("opacity", 1);
            link.style("opacity", 1);
            d3.select(this)
              .select("circle")
              .attr("stroke", "#30363d")
              .attr("stroke-width", 2);
          });

        /* ─ Positioning ─ */

        if (pos) {
          // ── ELK: static placement with drag-to-reposition ──
          node.attr("transform", (d) => `translate(${d.x},${d.y})`);
          link
            .attr("x1", (d) => (d.source as SN).x!)
            .attr("y1", (d) => (d.source as SN).y!)
            .attr("x2", (d) => (d.target as SN).x!)
            .attr("y2", (d) => (d.target as SN).y!);
          eLabel
            .attr(
              "x",
              (d) =>
                ((d.source as SN).x! + (d.target as SN).x!) / 2
            )
            .attr(
              "y",
              (d) =>
                ((d.source as SN).y! + (d.target as SN).y!) / 2
            );

          // Drag in ELK mode repositions the node and updates connected edges
          node.call(
            d3
              .drag<SVGGElement, SN>()
              .on("drag", function (ev, d) {
                d.x = ev.x;
                d.y = ev.y;
                d3.select(this).attr(
                  "transform",
                  `translate(${d.x},${d.y})`
                );
                link
                  .attr("x1", (l) => (l.source as SN).x!)
                  .attr("y1", (l) => (l.source as SN).y!)
                  .attr("x2", (l) => (l.target as SN).x!)
                  .attr("y2", (l) => (l.target as SN).y!);
                eLabel
                  .attr(
                    "x",
                    (l) =>
                      ((l.source as SN).x! + (l.target as SN).x!) / 2
                  )
                  .attr(
                    "y",
                    (l) =>
                      ((l.source as SN).y! + (l.target as SN).y!) / 2
                  );
              })
          );
        } else {
          // ── Force simulation ──
          sim = d3
            .forceSimulation<SN>(sNodes)
            .force(
              "link",
              d3
                .forceLink<SN, SE>(sEdges)
                .id((d) => d.id)
                .distance(isModView ? 180 : 140)
            )
            .force(
              "charge",
              d3.forceManyBody().strength(isModView ? -600 : -400)
            )
            .force("center", d3.forceCenter(W / 2, H / 2))
            .force(
              "collide",
              d3.forceCollide<SN>((d) => radiusOf(d.id) + 10)
            );

          node.call(
            d3
              .drag<SVGGElement, SN>()
              .on("start", (ev, d) => {
                if (!ev.active) sim!.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
              })
              .on("drag", (ev, d) => {
                d.fx = ev.x;
                d.fy = ev.y;
              })
              .on("end", (ev, d) => {
                if (!ev.active) sim!.alphaTarget(0);
                d.fx = null;
                d.fy = null;
              })
          );

          sim.on("tick", () => {
            link
              .attr("x1", (d) => (d.source as SN).x!)
              .attr("y1", (d) => (d.source as SN).y!)
              .attr("x2", (d) => (d.target as SN).x!)
              .attr("y2", (d) => (d.target as SN).y!);
            eLabel
              .attr(
                "x",
                (d) =>
                  ((d.source as SN).x! + (d.target as SN).x!) / 2
              )
              .attr(
                "y",
                (d) =>
                  ((d.source as SN).y! + (d.target as SN).y!) / 2
              );
            node.attr("transform", (d) => `translate(${d.x},${d.y})`);
          });
        }
      }

      /* ─ Kick off the chosen layout ─ */

      if (layout === "layered") {
        const elkNodes = sNodes.map((n) => ({
          id: n.id,
          w: radiusOf(n.id) * 2,
          h: radiusOf(n.id) * 2,
        }));
        runElkLayout(elkNodes, dispEdges, W, H)
          .then((positions) => {
            if (!cancelled) draw(positions);
          })
          .catch(() => {
            // Fallback to force layout if ELK fails
            if (!cancelled) draw();
          });
      } else {
        draw();
      }

      return () => {
        cancelled = true;
        if (sim) sim.stop();
        svg.selectAll("*").remove();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dispNodes, dispEdges, radiusOf, view, layout, expanded, containerSize, modules]);

    const handleBack = useCallback(() => setExpanded(null), []);

    /* ── JSX ────────────────────────────────────────────────── */

    return (
      <div ref={containerRef} className="w-full h-full overflow-hidden relative">
        {/* ── Toggle controls (top-right) ── */}
        <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
          {/* View mode: Module / File */}
          {hasMods && (
            <div className="flex rounded-lg overflow-hidden border border-[#30363d] bg-[#0d1117]/90 backdrop-blur-sm shadow-lg">
              <button
                onClick={() => setView("module")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === "module"
                    ? "bg-[#58a6ff]/20 text-[#58a6ff]"
                    : "text-[#8b949e] hover:text-[#e6edf3]"
                }`}
              >
                Module
              </button>
              <button
                onClick={() => setView("file")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-[#30363d] ${
                  view === "file"
                    ? "bg-[#58a6ff]/20 text-[#58a6ff]"
                    : "text-[#8b949e] hover:text-[#e6edf3]"
                }`}
              >
                File
              </button>
            </div>
          )}

          {/* Layout mode: Layered (ELK) / Force (D3) */}
          <div className="flex rounded-lg overflow-hidden border border-[#30363d] bg-[#0d1117]/90 backdrop-blur-sm shadow-lg">
            <button
              onClick={() => setLayout("layered")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                layout === "layered"
                  ? "bg-[#3fb950]/20 text-[#3fb950]"
                  : "text-[#8b949e] hover:text-[#e6edf3]"
              }`}
            >
              Layered
            </button>
            <button
              onClick={() => setLayout("force")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-[#30363d] ${
                layout === "force"
                  ? "bg-[#3fb950]/20 text-[#3fb950]"
                  : "text-[#8b949e] hover:text-[#e6edf3]"
              }`}
            >
              Force
            </button>
          </div>
        </div>

        {/* ── Back button (shown when drilled into a module) ── */}
        {expanded && (
          <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#30363d] bg-[#0d1117]/90 backdrop-blur-sm shadow-lg text-[#e6edf3] hover:bg-[#161b22] transition-colors"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z"
                />
              </svg>
              Back to modules
            </button>
            <span className="text-xs text-[#8b949e] bg-[#0d1117]/70 backdrop-blur-sm px-2 py-1 rounded border border-[#30363d]">
              {expanded}
            </span>
          </div>
        )}

        <svg ref={svgRef} className="w-full h-full" />
      </div>
    );
  }
);
