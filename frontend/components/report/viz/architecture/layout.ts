import type { ElkNode } from "elkjs/lib/elk-api";
import { Node as RFNode, Edge as RFEdge } from "@xyflow/react";
import { ArchitectureGraphData } from "./types";

/**
 * Configure ELK for the architecture v2 orthogonal layered layout.
 */
export async function layoutArchitectureGraph(
  data: ArchitectureGraphData
): Promise<{ nodes: RFNode[]; edges: RFEdge[] }> {
  // Lazy load ELK so it respects Next.js chunking
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const elk = new ELK();

  const isLR = "RIGHT";

  const rootConfig = {
    "elk.algorithm": "layered",
    "elk.direction": isLR,
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.spacing.nodeNode": "60",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120",
    "elk.layered.spacing.edgeNodeBetweenLayers": "40",
    "elk.layered.spacing.edgeEdgeBetweenLayers": "20",
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

  for (const group of sortedGroups) {
    const groupMembers = data.nodes.filter((n) => n.group_id === group.id);
    if (groupMembers.length === 0) continue;

    // Create the group box
    const parentNode: ElkNode = {
      id: group.id,
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": isLR,
        "elk.padding": "[top=60,left=30,bottom=30,right=30]",
      },
      children: groupMembers.map((n) => ({
        id: n.id,
        width: 320, // Standard card width
        height: 120 + n.technologies.length * 25, // Estimate height
        layoutOptions: {
          "elk.portConstraints": "FIXED_SIDE",
        }
      })),
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
    
    // Apply layout positions to RFNodes
    layouted.children?.forEach((groupNode) => {
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

    // Extract bend points for edges
    layouted.edges?.forEach((edgeLayout) => {
      const rfEdge = rfEdges.find((e) => e.id === edgeLayout.id);
      if (rfEdge && edgeLayout.sections) {
        // We inject ELK's orthogonal path sections into the RF Edge data
        rfEdge.data = {
          ...rfEdge.data,
          sections: edgeLayout.sections,
        };
      }
    });

  } catch (err) {
    console.error("ELK Layout failed:", err);
  }

  return { nodes: rfNodes, edges: rfEdges };
}
