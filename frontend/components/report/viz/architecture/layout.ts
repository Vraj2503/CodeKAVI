import type { ElkNode } from "elkjs/lib/elk-api";
import { Node as RFNode, Edge as RFEdge } from "@xyflow/react";
import { ArchitectureGraphData, ArchitectureEdgeSection } from "./types";

/**
 * Configure ELK for the architecture v2 orthogonal layered layout.
 *
 * `nodeHeights` optionally maps capability node ids to their real rendered
 * height (measured from the DOM). ELK routes edges around the boxes it is
 * given, so underestimated heights make channels and anchor points land
 * behind the actual cards — edges appear to dive under nodes and labels
 * pile up. Measured heights keep the routed geometry honest.
 */
export async function layoutArchitectureGraph(
  data: ArchitectureGraphData,
  nodeHeights?: Record<string, number>
): Promise<{ nodes: RFNode[]; edges: RFEdge[] }> {
  // Lazy load ELK so it respects Next.js chunking
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();

  // Top-to-bottom flow: groups stack vertically and cards flow downward. The
  // 320px-wide cards make left-to-right layouts enormously wide, while
  // vertical stacking matches the entry → capabilities → state/external
  // reading order and leaves room for edge labels between rows.
  const direction = "DOWN";

  const rootConfig = {
    "elk.algorithm": "layered",
    "elk.direction": direction,
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    // Sibling spacing within a layer (horizontal gap between cards).
    "elk.spacing.nodeNode": "100",
    // Between-layer spacing (vertical gap between card rows) — generous so
    // edge labels have clear space between the rows.
    "elk.layered.spacing.nodeNodeBetweenLayers": "220",
    "elk.layered.spacing.edgeNodeBetweenLayers": "60",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "40",
    "elk.layered.spacing.edgeLabelBetweenLayers": "40",
    "elk.layered.spacing.labelLabel": "30",
    // Keep parallel edges distinct so their labels can be placed apart.
    "elk.layered.mergeEdges": "false",
    // Keep groups visually distinct
    "elk.padding": "[top=40,left=40,bottom=40,right=40]",
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  };

  // Build the hierarchical elk tree
  const elkNodes: ElkNode[] = [];
  
  // Track mapping for building RF nodes later
  const rfNodes: RFNode[] = [];
  const rfEdges: RFEdge[] = [];

  // Sort groups by explicit order if present
  const sortedGroups = [...data.groups].sort((a, b) => a.order - b.order);

  // Heights actually handed to ELK, kept so label-collision rectangles match
  // the laid-out geometry instead of a stale estimate.
  const layoutHeightById = new Map<string, number>();

  for (const group of sortedGroups) {
    const groupMembers = data.nodes.filter((n) => n.group_id === group.id);
    if (groupMembers.length === 0) continue;

    // Create the group box
    const parentNode: ElkNode = {
      id: group.id,
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": direction,
        "elk.padding": "[top=60,left=30,bottom=30,right=30]",
      },
      children: groupMembers.map((n) => {
        // Prefer the real rendered height; fall back to the estimate.
        const height = nodeHeights?.[n.id] ?? 120 + n.technologies.length * 25;
        layoutHeightById.set(n.id, height);
        return {
          id: n.id,
          width: 320, // Standard card width
          height,
          layoutOptions: {
            "elk.portConstraints": "FIXED_SIDE",
          },
        };
      }),
    };
    elkNodes.push(parentNode);

    // Create group RFNode
    rfNodes.push({
      id: group.id,
      type: "architectureGroup",
      data: { label: group.label },
      position: { x: 0, y: 0 }, // Will be set by ELK
      style: {
        width: 0,
        height: 0,
        zIndex: -1,
      },
    });

    // Create child RFNodes
    groupMembers.forEach((n) => {
      rfNodes.push({
        id: n.id,
        type: "architectureNode",
        parentId: group.id,
        data: n,
        position: { x: 0, y: 0 }, // Will be set by ELK
        extent: "parent",
      });
    });
  }

  // ── Edge validation pass ─────────────────────────────────────────────
  // Build a set of only the *leaf* node IDs (the nodes ELK will actually
  // position). Group nodes are in rfNodes too but data.edges never
  // reference them — comparing against group IDs would let through edges
  // whose real endpoint was pruned/collapsed, causing floating arrows.
  const leafNodeIds = new Set(
    rfNodes.filter((n) => n.type === "architectureNode").map((n) => n.id)
  );

  const validEdges: typeof data.edges = [];
  for (const e of data.edges) {
    const srcOk = leafNodeIds.has(e.source);
    const tgtOk = leafNodeIds.has(e.target);
    if (srcOk && tgtOk) {
      validEdges.push(e);
    } else {
      console.warn(
        `[ArchitectureGraph] Dropped dangling edge: id=${e.id} ` +
        `source=${e.source}(${srcOk ? "ok" : "MISSING"}) ` +
        `target=${e.target}(${tgtOk ? "ok" : "MISSING"}) ` +
        `label="${e.label}"`
      );
    }
  }

  const elkEdges = validEdges.map((e) => ({
    id: e.id,
    sources: [e.source],
    targets: [e.target],
  }));

  validEdges.forEach((e) => {
    rfEdges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      type: "architectureEdge",
      data: e,
      animated: e.kind === "event" || e.kind === "queue",
    });
  });

  const graph: ElkNode = {
    id: "root",
    layoutOptions: rootConfig,
    children: elkNodes,
    edges: elkEdges,
  };

  try {
    const layouted = await elk.layout(graph);

    // Root sits at the origin, so the top-level groups' coordinates are already
    // absolute canvas coordinates. Record them so intra-group edge sections —
    // which ELK reports in the shared parent group's local space — can be
    // shifted into that same absolute space React Flow renders everything in.
    const groupOffsets = new Map<string, { x: number; y: number }>();

    // Apply layout positions to RFNodes
    layouted.children?.forEach((groupNode) => {
      groupOffsets.set(groupNode.id, { x: groupNode.x || 0, y: groupNode.y || 0 });
      const gNode = rfNodes.find((n) => n.id === groupNode.id);
      if (gNode) {
        gNode.position = { x: groupNode.x || 0, y: groupNode.y || 0 };
        gNode.style = { ...gNode.style, width: groupNode.width, height: groupNode.height };
      }

      groupNode.children?.forEach((childNode) => {
        const cNode = rfNodes.find((n) => n.id === childNode.id);
        if (cNode) {
          cNode.position = { x: childNode.x || 0, y: childNode.y || 0 };
        }
      });
    });

    // Collect every laid-out edge, including ones ELK nests inside a group
    // rather than listing on the root.
    const edgeLayouts: NonNullable<ElkNode["edges"]> = [];
    const collectEdgeLayouts = (node: ElkNode) => {
      if (node.edges) edgeLayouts.push(...node.edges);
      node.children?.forEach(collectEdgeLayouts);
    };
    collectEdgeLayouts(layouted);

    const parentOf = new Map<string, string>();
    rfNodes.forEach((n) => {
      if (n.parentId) parentOf.set(String(n.id), String(n.parentId));
    });

    // ELK reports edge sections in the coordinate space of the endpoints'
    // lowest common ancestor: absolute (root) space for cross-group edges,
    // group-local space when both endpoints share a group. React Flow draws
    // all edges in absolute space, so translate same-group edges by the
    // group's absolute offset — copying them verbatim is what makes them
    // float detached from their cards.
    const toAbsolute = (
      sections: ArchitectureEdgeSection[],
      offset: { x: number; y: number } | undefined
    ): ArchitectureEdgeSection[] =>
      offset
        ? sections.map((s) => ({
            startPoint: { x: s.startPoint.x + offset.x, y: s.startPoint.y + offset.y },
            endPoint: { x: s.endPoint.x + offset.x, y: s.endPoint.y + offset.y },
            bendPoints: s.bendPoints?.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })),
          }))
        : sections;

    // Absolute-space rectangles of every capability card, used to keep edge
    // labels off the nodes. Group boxes are excluded — labels legitimately
    // ride edges inside a group. Child positions are parent-relative, so add
    // the group's absolute offset (groupOffsets is filled by the loop above).
    // Heights come from the same map ELK laid out with — reading a fallback
    // estimate here left a band of unguarded card pixels that labels clipped.
    const nodeRects: { x: number; y: number; width: number; height: number }[] = [];
    rfNodes.forEach((n) => {
      if (n.type === "architectureGroup") return;
      const width = Number((n.style as { width?: number } | undefined)?.width ?? 320);
      const height = layoutHeightById.get(String(n.id)) ?? 120;
      const parentOffset = n.parentId ? groupOffsets.get(String(n.parentId)) : undefined;
      nodeRects.push({
        x: (parentOffset?.x ?? 0) + Number(n.position?.x ?? 0),
        y: (parentOffset?.y ?? 0) + Number(n.position?.y ?? 0),
        width,
        height,
      });
    });

    // Segment enumeration shared by label scoring: horizontal runs and
    // vertical runs, per section. Both are ON the routed path, which is the
    // hard requirement for a label anchor — anything else floats.
    type Segment = { cx: number; cy: number; length: number; vertical?: boolean };
    const pathSegments = (sections: ArchitectureEdgeSection[]): { h: Segment[]; v: Segment[] } => {
      const h: Segment[] = [];
      const v: Segment[] = [];
      for (const section of sections) {
        const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
        for (let i = 1; i < points.length; i++) {
          const from = points[i - 1];
          const to = points[i];
          if (from.y === to.y) {
            h.push({ cx: (from.x + to.x) / 2, cy: from.y, length: Math.abs(to.x - from.x) });
          } else if (from.x === to.x) {
            v.push({
              cx: from.x,
              cy: (from.y + to.y) / 2,
              length: Math.abs(to.y - from.y),
              vertical: true,
            });
          }
        }
      }
      return { h, v };
    };

    // A label occupies a real box once rendered (bg-background pill), so test
    // whole rectangles, not just centers: pills clipped at card borders and
    // stacked on each other while only the center point was checked.
    // Width is estimated from the text: the pill truncates at 180px, the 10px
    // font averages ~5.6px/char, plus ~18px of padding and border. A single
    // fixed budget under-counted long labels like "Reads and writes data" and
    // let their real pills clip cards the test thought were clear.
    const LABEL_H = 22; // pill height: ~10px text + padding + border
    const labelWidth = (text: string) =>
      Math.min(180, Math.ceil(text.length * 5.6) + 18);

    const overlapsCard = (x: number, y: number, w: number) =>
      nodeRects.some(
        (r) =>
          x + w / 2 > r.x - 6 &&
          x - w / 2 < r.x + r.width + 6 &&
          y + LABEL_H / 2 > r.y - 6 &&
          y - LABEL_H / 2 < r.y + r.height + 6
      );

    // Pills of labels already placed this layout pass, so sibling edges
    // sharing a routing channel don't stack their labels.
    const placedLabelRects: { x: number; y: number; width: number; height: number }[] = [];

    edgeLayouts.forEach((edgeLayout) => {
      const rfEdge = rfEdges.find((e) => e.id === edgeLayout.id);
      if (!rfEdge || !edgeLayout.sections) return;
      const sourceParent = parentOf.get(String(rfEdge.source));
      const targetParent = parentOf.get(String(rfEdge.target));
      const offset =
        sourceParent && sourceParent === targetParent ? groupOffsets.get(sourceParent) : undefined;
      const sections = toAbsolute(edgeLayout.sections, offset);

      // Choose a label anchor whose rendered pill clears every card AND the
      // labels already placed. Candidates must lie ON the routed path — both
      // horizontal and vertical segment centers qualify (the pill sits on the
      // line, opaque background covering it). Horizontal segments are preferred
      // via scoring; vertical channel runs are the escape hatch when every
      // horizontal spot is blocked by a card or another label, which is what
      // previously forced the collision-blind last resort.
      const first = sections[0];
      const last = sections[sections.length - 1];
      const { h: horizontals, v: verticals } = pathSegments(sections);
      const candidates: Segment[] = [...horizontals, ...verticals];
      const totalLength = candidates.reduce((sum, s) => sum + s.length, 0) || 1;
      const midX = (first.startPoint.x + last.endPoint.x) / 2;
      const midY = (first.startPoint.y + last.endPoint.y) / 2;

      // The pill renders centered ON the line (opaque pill covers it), so the
      // candidate point IS the rendered center — no offset means no blind
      // spot between where collisions are tested and where the pill lands.
      const pillCenter = (c: Segment) => ({ x: c.cx, y: c.cy });
      const pillW = labelWidth(String(rfEdge.data?.label ?? ""));
      const hitsPlacedLabel = (x: number, y: number, w: number) =>
        placedLabelRects.some(
          (r) =>
            x + w / 2 > r.x - 10 && x - w / 2 < r.x + r.width + 10 &&
            y + LABEL_H / 2 > r.y - 10 && y - LABEL_H / 2 < r.y + r.height + 10
        );

      let label: { x: number; y: number } | null = null;
      let bestScore = -Infinity;
      for (const c of candidates) {
        const pc = pillCenter(c);
        if (overlapsCard(pc.x, pc.y, pillW)) continue; // hard reject: pill would clip a card
        if (hitsPlacedLabel(pc.x, pc.y, pillW)) continue; // hard reject: would stack on an earlier label
        const lengthScore = c.length / totalLength;
        const midDist = Math.abs(c.cx - midX) + Math.abs(c.cy - midY);
        // Horizontal placements win ties — a pill above/below a run reads
        // better than one straddling a vertical channel — so verticals carry
        // a fixed penalty and are only chosen when horizontals are blocked.
        const score = lengthScore * 2 - (midDist / totalLength) * 0.5 - (c.vertical ? 0.6 : 0);
        if (score > bestScore) {
          bestScore = score;
          label = pc;
        }
      }
      if (!label) {
        // Every candidate collides (dense graph): slide along each segment of
        // this edge — horizontal runs first, then vertical channel runs —
        // until a spot clears both cards and placed labels. Every step stays
        // ON the path, so the label can never float away from its edge.
        const free = (x: number, y: number) =>
          !overlapsCard(x, y, pillW) && !hitsPlacedLabel(x, y, pillW);
        let chosen: { x: number; y: number } | null = null;
        for (const seg of [...horizontals].sort((a, b) => b.length - a.length)) {
          const left = seg.cx - seg.length / 2;
          const span = seg.length;
          if (span < 40) continue;
          for (let t = 0.5; t >= 0 && !chosen; t -= 0.1) {
            for (const frac of [t, 1 - t]) {
              const x = left + span * frac;
              if (free(x, seg.cy)) {
                chosen = { x, y: seg.cy };
                break;
              }
            }
          }
        }
        if (!chosen) {
          // Vertical segments are the escape hatch: the channel runs between
          // card rows are long, thin, and usually card-free.
          for (const seg of [...verticals].sort((a, b) => b.length - a.length)) {
            const top = seg.cy - seg.length / 2;
            const span = seg.length;
            if (span < 30) continue;
            for (let t = 0.5; t >= 0 && !chosen; t -= 0.1) {
              for (const frac of [t, 1 - t]) {
                const y = top + span * frac;
                if (free(seg.cx, y)) {
                  chosen = { x: seg.cx, y };
                  break;
                }
              }
            }
          }
        }
        // Absolute last resort: still on the longest horizontal run, but at
        // the spot with the least card overlap — never blindly centered, and
        // the previous give-up anchor ignored cards entirely.
        if (!chosen && horizontals.length > 0) {
          const best = [...horizontals].sort((a, b) => b.length - a.length)[0];
          const left = best.cx - best.length / 2;
          const span = best.length;
          let bestX = best.cx;
          let bestDepth = Infinity;
          for (let x = left + pillW / 2; x <= left + span - pillW / 2; x += 12) {
            let depth = 0;
            for (const r of nodeRects) {
              if (
                x + pillW / 2 > r.x &&
                x - pillW / 2 < r.x + r.width &&
                best.cy + LABEL_H / 2 > r.y &&
                best.cy - LABEL_H / 2 < r.y + r.height
              ) {
                depth = Math.max(depth, Math.min(x + pillW / 2 - r.x, r.x + r.width - (x - pillW / 2)));
              }
            }
            if (depth < bestDepth) {
              bestDepth = depth;
              bestX = x;
            }
            if (depth === 0) break;
          }
          chosen = { x: bestX, y: best.cy };
        }
        label = chosen ?? { x: midX, y: midY };
      }

      // Remember the pill rect so later edges route their labels around it.
      placedLabelRects.push({ x: label.x - pillW / 2, y: label.y - LABEL_H / 2, width: pillW, height: LABEL_H });

      // Inject ELK's orthogonal path sections into the RF Edge data
      rfEdge.data = {
        ...rfEdge.data,
        sections,
        labelX: label.x,
        labelY: label.y,
      };
    });
  } catch (err) {
    console.error("ELK Layout failed:", err);
  }

  return { nodes: rfNodes, edges: rfEdges };
}
