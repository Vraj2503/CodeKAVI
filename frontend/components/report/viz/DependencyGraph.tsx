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
  forwardRef,
  useImperativeHandle,
} from "react";
import * as d3 from "d3";
// bundled version runs synchronously, avoids web-worker issues in Next.js
import ELK from "elkjs/lib/elk.bundled.js";
import { catVar, typeVar, catInkVar } from "@/lib/viz/tokens";
import {
  VizShell,
  VizLegend,
  VizTooltip,
  type VizLegendItem,
} from "@/components/viz/VizShell";
import { VizBreadcrumb, type VizCrumb } from "@/components/viz/VizBreadcrumb";
import { useVizCanvas } from "@/components/viz/useVizCanvas";
import { useVizZoom, ZOOM_MIN, ZOOM_MAX } from "@/components/viz/useVizZoom";
import { useVizNodeNav } from "@/components/viz/useVizNodeNav";
import { useReducedMotion } from "@/components/viz/useReducedMotion";

/* ── Types ────────────────────────────────────────────────── */

interface Node {
  id: string;
  label: string;
  type: string;
  role_label?: string;
  language?: string;
  importance?: number;
  in_degree?: number;
  out_degree?: number;
  full_path?: string;
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
type LayoutChoice = "auto" | LayoutMode;
type DisplayNode = Node & {
  _fileCount?: number;
  _colorIdx?: number;
  _importance?: number;
  _language?: string;
  _inDeg?: number;
  _outDeg?: number;
};

/* ── Singleton ELK instance ───────────────────────────────── */

const elk = new ELK();

/** Legend copy for semantic node roles. */
const ROLE_LABELS: Record<string, string> = {
  module: "Module",
  file: "File",
  routes: "Routes",
  models: "Models",
  services: "Services",
  database: "Database",
  config: "Config",
  utils: "Utilities",
  tests: "Tests",
  component: "Component",
  class: "Class",
  function: "Function",
  method: "Method",
  external: "External",
  package: "Package",
  other: "Other",
};

/* ── Control styling ──────────────────────────────────────── */

/** Selected segment in a toggle group. `--viz-highlight` is the existing
 *  "this is the active thing in a chart" token, defined for both themes. */
const TOGGLE_ACTIVE =
  "bg-[hsl(var(--viz-highlight)/0.18)] text-[hsl(var(--viz-highlight))]";
const TOGGLE_IDLE = "text-muted-foreground hover:text-foreground";

/* ── Helpers ──────────────────────────────────────────────── */

/** Semantic node color. Themed — see lib/viz/tokens.ts. */
function getNodeColor(type: string): string {
  return typeVar(type);
}

/** Per-module color, cycling the 8-slot categorical palette. */
function modColor(idx: number): string {
  return catVar(idx);
}

function modRadius(fileCount: number): number {
  return Math.min(22 + Math.sqrt(fileCount) * 5, 55);
}

function truncate(text: string, max = 15): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** DFS-based cycle detection — true if the graph has at least one cycle. */
function hasCycle(
  nodeIds: string[],
  edges: { source: string; target: string }[],
): boolean {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) adj.get(e.source)?.push(e.target);

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const state = new Map<string, number>(nodeIds.map((id) => [id, WHITE]));

  function visit(id: string): boolean {
    state.set(id, GRAY);
    for (const next of adj.get(id) || []) {
      const s = state.get(next);
      if (s === GRAY) return true;
      if (s === WHITE && visit(next)) return true;
    }
    state.set(id, BLACK);
    return false;
  }

  for (const id of nodeIds) {
    if (state.get(id) === WHITE && visit(id)) return true;
  }
  return false;
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
  canvasH: number,
): Promise<Map<string, { x: number; y: number }>> {
  if (nodes.length === 0) return new Map();

  const ids = new Set(nodes.map((n) => n.id));
  const valid = edges.filter(
    (e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target,
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
    const canvas = useVizCanvas();
    const reducedMotion = useReducedMotion();
    const zoom = useVizZoom(!reducedMotion);
    // Enter drills into a module exactly as a click does, so the two paths
    // cannot drift. Escape backs out to the module overview.
    const nav = useVizNodeNav({
      onActivate: (el) =>
        el.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      onEscape: () => setExpanded(null),
    });
    const containerRef = canvas.containerRef;
    const containerSize = canvas.size;

    const hasMods = !!moduleGraph?.nodes?.length;
    const [view, setView] = useState<ViewMode>(hasMods ? "module" : "file");
    const [layoutOverride, setLayoutOverride] = useState<LayoutChoice>("auto");
    const [expanded, setExpanded] = useState<string | null>(null);
    const [tooltip, setTooltip] = useState<{
      x: number;
      y: number;
      node: DisplayNode;
    } | null>(null);

    useImperativeHandle(ref, () => containerRef.current!);

    // Sync default view mode when module data becomes available
    useEffect(() => {
      if (hasMods) setView("module");
    }, [hasMods]);

    // Reset expansion when the user switches view modes
    useEffect(() => {
      setExpanded(null);
    }, [view]);

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
            _importance: m.importance,
            _language: m.primary_language,
            _inDeg: m.in_weight,
            _outDeg: m.out_weight,
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
            (e) => fileSet.has(e.source) && fileSet.has(e.target),
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

    // Auto-detect layout: DAGs get the hierarchical ELK layout, cyclic
    // graphs fall back to force simulation which handles cycles naturally.
    const isCyclic = useMemo(
      () =>
        hasCycle(
          dispNodes.map((n) => n.id),
          dispEdges,
        ),
      [dispNodes, dispEdges],
    );
    const effectiveLayout: LayoutMode =
      layoutOverride === "auto"
        ? isCyclic
          ? "force"
          : "layered"
        : layoutOverride;

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
          .attr("fill", "hsl(var(--border))");
      }

      // Zoom & pan — behavior stays local, the shell drives it via the controller
      const zoomBehavior = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([ZOOM_MIN, ZOOM_MAX])
        .on("zoom", (ev) => g.attr("transform", ev.transform));
      svg.call(zoomBehavior);
      zoom.register(svgRef.current, zoomBehavior, g.node());

      // D3 simulation types
      type SN = d3.SimulationNodeDatum & DisplayNode;
      type SE = d3.SimulationLinkDatum<SN> & { label?: string };

      const sNodes: SN[] = dispNodes.map((n) => ({ ...n }));
      const sEdges: SE[] = dispEdges.map((e) => ({
        source: e.source,
        target: e.target,
        label: e.label,
      }));

      /**
       * Frame the graph once layout has settled.
       *
       * ELK centres the graph but never scales it, so any graph taller than the
       * viewport rendered clipped at both ends until the user found the "Fit to
       * view" button. DataFlowGraph and ArchitectureGraph both already framed
       * themselves after layout; this one did not.
       *
       * Not animated: on first paint a tween from the identity transform reads
       * as an unrequested zoom rather than a chart appearing.
       */
      const frame = () => {
        if (!cancelled) zoom.fitToView({ animate: false });
      };

      /** Colour a node based on view mode. */
      function colour(d: DisplayNode): string {
        if (isModView && d._colorIdx != null) return modColor(d._colorIdx);
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
          .attr("stroke", "hsl(var(--border))")
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
          .attr("fill", "hsl(var(--muted-foreground))")
          .attr("text-anchor", "middle")
          .text((d) => d.label || "");

        /* ─ Node groups ─ */
        const node = g
          .append("g")
          .selectAll<SVGGElement, SN>("g")
          .data(sNodes)
          .join("g")
          // T12: drill-down was mouse-only, so the single most useful thing
          // this chart does was unreachable without a pointer. `viz-node`
          // carries the focus ring; `useVizNodeNav` adds `tabindex="-1"`.
          .attr("class", "dep-node viz-node")
          .attr("role", isModView && modules?.length ? "button" : "img")
          .attr("aria-label", (d) => {
            const kind = isModView ? "module" : "file";
            const degree = sEdges.filter((e) => {
              const s = typeof e.source === "object" ? (e.source as SN).id : String(e.source);
              const t = typeof e.target === "object" ? (e.target as SN).id : String(e.target);
              return s === d.id || t === d.id;
            }).length;
            // The drawn label truncates at 15–20 characters and the node's
            // degree is encoded only as circle radius — neither survives a
            // screen reader without being said out loud.
            return `${d.label}, ${kind}, ${degree} connection${degree === 1 ? "" : "s"}`;
          })
          .style("cursor", isModView ? "pointer" : "default");

        // Circles
        node
          .append("circle")
          .attr("r", (d) => radiusOf(d.id))
          .attr("fill", (d) => colour(d))
          .attr("fill-opacity", isModView ? 0.85 : 1)
          .attr("stroke", "hsl(var(--border))")
          .attr("stroke-width", 2);

        // Module badges — file count inside the circle
        if (isModView) {
          node
            .append("text")
            .attr("text-anchor", "middle")
            .attr("dy", 1)
            .attr("font-size", (d) => Math.max(10, radiusOf(d.id) * 0.4))
            .attr("font-weight", "bold")
            .attr("fill", catInkVar())
            .text((d) => (d._fileCount != null ? String(d._fileCount) : ""));
          node
            .append("text")
            .attr("text-anchor", "middle")
            .attr("dy", (d) => radiusOf(d.id) * 0.35 + 5)
            // was 8px at 70% opacity — below the legibility floor and under
            // 4.5:1 on the lighter palette slots
            .attr("font-size", 10)
            .attr("fill", catInkVar(0.85))
            .text((d) => (d._fileCount ? "files" : ""));
        }

        // Labels below nodes
        node
          .append("text")
          .attr("text-anchor", "middle")
          .attr("dy", (d) => radiusOf(d.id) + 16)
          .attr("font-size", isModView ? 12 : 11)
          .attr("font-weight", isModView ? "600" : "400")
          .attr("fill", "hsl(var(--foreground))")
          .text((d) => truncate(d.label, isModView ? 20 : 15));

        // Click → expand module
        if (isModView && modules?.length) {
          node.on("click", (_ev, d) => setExpanded(d.id));
        }

        // Hand the drawn nodes to the keyboard controller. Runs on every
        // `draw()` — including the force path, which redraws after layout —
        // because d3 replaced the elements each time.
        nav.register(g.node(), "g.dep-node");

        // Hover-highlight connected nodes & edges, plus a following tooltip
        function pointerPos(ev: MouseEvent) {
          const rect = containerRef.current!.getBoundingClientRect();
          return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
        }

        node
          .on("mouseenter", function (ev, d) {
            d3.select(this)
              .select("circle")
              .attr("stroke", "hsl(var(--viz-highlight))")
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
            setTooltip({ ...pointerPos(ev), node: d });
          })
          .on("mousemove", function (ev, d) {
            setTooltip({ ...pointerPos(ev), node: d });
          })
          .on("mouseleave", function () {
            node.style("opacity", 1);
            link.style("opacity", 1);
            d3.select(this)
              .select("circle")
              .attr("stroke", "hsl(var(--border))")
              .attr("stroke-width", 2);
            setTooltip(null);
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
            .attr("x", (d) => ((d.source as SN).x! + (d.target as SN).x!) / 2)
            .attr("y", (d) => ((d.source as SN).y! + (d.target as SN).y!) / 2);

          // Drag in ELK mode repositions the node and updates connected edges
          node.call(
            d3.drag<SVGGElement, SN>().on("drag", function (ev, d) {
              d.x = ev.x;
              d.y = ev.y;
              d3.select(this).attr("transform", `translate(${d.x},${d.y})`);
              link
                .attr("x1", (l) => (l.source as SN).x!)
                .attr("y1", (l) => (l.source as SN).y!)
                .attr("x2", (l) => (l.target as SN).x!)
                .attr("y2", (l) => (l.target as SN).y!);
              eLabel
                .attr(
                  "x",
                  (l) => ((l.source as SN).x! + (l.target as SN).x!) / 2,
                )
                .attr(
                  "y",
                  (l) => ((l.source as SN).y! + (l.target as SN).y!) / 2,
                );
            }),
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
                .distance(isModView ? 180 : 140),
            )
            .force(
              "charge",
              d3.forceManyBody().strength(isModView ? -600 : -400),
            )
            .force("center", d3.forceCenter(W / 2, H / 2))
            .force(
              "collide",
              d3.forceCollide<SN>((d) => radiusOf(d.id) + 10),
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
              }),
          );

          sim.on("tick", () => {
            link
              .attr("x1", (d) => (d.source as SN).x!)
              .attr("y1", (d) => (d.source as SN).y!)
              .attr("x2", (d) => (d.target as SN).x!)
              .attr("y2", (d) => (d.target as SN).y!);
            eLabel
              .attr("x", (d) => ((d.source as SN).x! + (d.target as SN).x!) / 2)
              .attr(
                "y",
                (d) => ((d.source as SN).y! + (d.target as SN).y!) / 2,
              );
            node.attr("transform", (d) => `translate(${d.x},${d.y})`);
          });

          // Force layout keeps moving for hundreds of ticks; framing now would
          // fit the initial random scatter. Wait for the simulation to cool.
          sim.on("end", frame);
        }
      }

      /* ─ Kick off the chosen layout ─ */

      if (effectiveLayout === "layered") {
        const elkNodes = sNodes.map((n) => ({
          id: n.id,
          w: radiusOf(n.id) * 2,
          h: radiusOf(n.id) * 2,
        }));
        runElkLayout(elkNodes, dispEdges, W, H)
          .then((positions) => {
            if (cancelled) return;
            draw(positions);
            // ELK positions are final on return, so frame straight away.
            // The force path instead frames from inside draw(), on sim end.
            frame();
          })
          .catch(() => {
            // Fallback to force layout if ELK fails — draw() wires its own
            // framing to the simulation's end event.
            if (!cancelled) draw();
          });
      } else {
        draw();
      }

      return () => {
        cancelled = true;
        if (sim) sim.stop();
        zoom.register(null, null, null);
        nav.register(null);
        svg.selectAll("*").remove();
      };
    }, [
      dispNodes,
      dispEdges,
      radiusOf,
      view,
      effectiveLayout,
      expanded,
      containerSize,
      containerRef,
      modules,
      zoom,
      nav,
    ]);

    /**
     * Breadcrumb path. Two levels today (all modules → one module), but it
     * goes through the shared N-segment component so the treemap's deeper
     * nesting uses the same control rather than a second bespoke one.
     */
    const crumbs = useMemo<VizCrumb[]>(() => {
      if (!expanded) return [];
      return [
        { id: null, label: view === "module" ? "All modules" : "All files" },
        { id: expanded, label: expanded },
      ];
    }, [expanded, view]);

    const isModuleView = view === "module" && !expanded;

    /**
     * The graph encodes meaning in color and never said what it meant. In
     * module view the palette is arbitrary per-module identity, so the key
     * names the modules; in file view it is semantic role, so it names roles.
     * Capped because a key longer than the chart is not a key.
     */
    const legendItems = useMemo<VizLegendItem[]>(() => {
      if (isModuleView) {
        return (moduleGraph?.nodes ?? [])
          .slice(0, 8)
          .map((m, i) => ({ color: catVar(i), label: m.label }));
      }
      const seen = new Set(dispNodes.map((n) => n.type?.toLowerCase()).filter(Boolean));
      return [...seen]
        .slice(0, 8)
        .map((t) => ({ color: typeVar(t), label: ROLE_LABELS[t!] ?? t! }));
    }, [isModuleView, moduleGraph, dispNodes]);

    /* ── JSX ────────────────────────────────────────────────── */

    return (
      <VizShell
        canvas={canvas}
        zoom={zoom}
        nav={nav}
        label={isModuleView ? "Module dependency graph" : "File dependency graph"}
        description={
          `${dispNodes.length} nodes and ${dispEdges.length} directed dependencies, ` +
          `laid out with the ${effectiveLayout} algorithm. ` +
          (isModuleView
            ? "Circle size is the number of files in the module; color distinguishes modules."
            : "Color indicates the file's architectural role.")
        }
        legend={<VizLegend title={isModuleView ? "Modules" : "Role"} items={legendItems} />}
        toolbarLeft={
          crumbs.length > 0 ? (
            <div className="rounded-lg border border-border bg-card/90 px-2.5 py-1.5 shadow-lg backdrop-blur-sm">
              <VizBreadcrumb segments={crumbs} onNavigate={(id) => setExpanded(id)} />
            </div>
          ) : undefined
        }
        toolbarRight={
          <>
          {/* View mode: Module / File */}
          {hasMods && (
            <div className="flex rounded-lg overflow-hidden border border-border bg-card/90 backdrop-blur-sm shadow-lg">
              <button
                onClick={() => setView("module")}
                aria-pressed={view === "module"}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  view === "module"
                    ? TOGGLE_ACTIVE
                    : TOGGLE_IDLE
                }`}
              >
                Module
              </button>
              <button
                onClick={() => setView("file")}
                aria-pressed={view === "file"}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                  view === "file"
                    ? TOGGLE_ACTIVE
                    : TOGGLE_IDLE
                }`}
              >
                File
              </button>
            </div>
          )}

          {/* Layout mode: Layered (ELK) / Force (D3) */}
          <div className="flex rounded-lg overflow-hidden border border-border bg-card/90 backdrop-blur-sm shadow-lg">
            <button
              onClick={() => setLayoutOverride("layered")}
              aria-pressed={effectiveLayout === "layered"}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                effectiveLayout === "layered"
                  ? TOGGLE_ACTIVE
                  : TOGGLE_IDLE
              }`}
            >
              Layered
            </button>
            <button
              onClick={() => setLayoutOverride("force")}
              aria-pressed={effectiveLayout === "force"}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${
                effectiveLayout === "force"
                  ? TOGGLE_ACTIVE
                  : TOGGLE_IDLE
              }`}
            >
              Force
            </button>
          </div>
          </>
        }
        overlay={
          /* ── Hover tooltip ── */
          tooltip &&
          (() => {
            const d = tooltip.node;
            const isMod = d._fileCount != null;
            const importance = d.importance ?? d._importance;
            const language = d.language ?? d._language;
            const inDeg = d.in_degree ?? d._inDeg;
            const outDeg = d.out_degree ?? d._outDeg;
            const path = d.full_path || (!isMod ? d.id : undefined);

            return (
              <VizTooltip
                x={tooltip.x}
                y={tooltip.y}
                containerWidth={containerSize.width}
                containerHeight={containerSize.height}
              >
                <div className="font-semibold text-foreground truncate">
                  {d.label}
                </div>
                {path && (
                  <div className="text-muted-foreground truncate mt-0.5">
                    {path}
                  </div>
                )}
                <div className="mt-1.5 space-y-0.5 text-muted-foreground">
                  {isMod ? (
                    <div>
                      Files:{" "}
                      <span className="text-foreground">{d._fileCount}</span>
                    </div>
                  ) : (
                    d.role_label && (
                      <div>
                        Role:{" "}
                        <span className="text-foreground">{d.role_label}</span>
                      </div>
                    )
                  )}
                  {language && (
                    <div>
                      Language:{" "}
                      <span className="text-foreground">{language}</span>
                    </div>
                  )}
                  {importance != null && (
                    <div>
                      Importance:{" "}
                      <span className="text-foreground">
                        {importance.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {(inDeg != null || outDeg != null) && (
                    <div>
                      In / Out:{" "}
                      <span className="text-foreground">
                        {inDeg ?? 0} / {outDeg ?? 0}
                      </span>
                    </div>
                  )}
                </div>
              </VizTooltip>
            );
          })()
        }
      >
        <svg ref={svgRef} className="w-full h-full" />
      </VizShell>
    );
  },
);
