"use client";

import React, { useMemo } from "react";
import { edgeVar } from "@/lib/viz/tokens";
import type { RadarEdge, RadarModule } from "../types";
import { edgePath, getConnected } from "../useRadarLayout";

interface DependencyArcsProps {
  edges: RadarEdge[];
  modules: RadarModule[];
  hoveredId: string | null;
  selectedId: string | null;
  reducedMotion: boolean;
}

export const DependencyArcs = React.memo(function DependencyArcs({
  edges,
  modules,
  hoveredId,
  selectedId,
  reducedMotion,
}: DependencyArcsProps) {
  const moduleMap = useMemo(() => {
    const map = new Map<string, RadarModule>();
    modules.forEach((m) => map.set(m.id, m));
    return map;
  }, [modules]);

  const activeId = hoveredId || selectedId;

  const connected = useMemo(() => {
    if (!activeId) return { inbound: new Set<string>(), outbound: new Set<string>() };
    return getConnected(activeId, modules);
  }, [activeId, modules]);

  return (
    <g className="radar-arcs">
      <defs>
        <marker
          id="arrow-dim"
          viewBox="0 -5 10 10"
          refX="25"
          refY="0"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,-5L10,0L0,5" fill={edgeVar(0.15)} />
        </marker>
        <marker
          id="arrow-outbound"
          viewBox="0 -5 10 10"
          refX="25"
          refY="0"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,-5L10,0L0,5" fill="#38bdf8" />
        </marker>
        <marker
          id="arrow-inbound"
          viewBox="0 -5 10 10"
          refX="25"
          refY="0"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0,-5L10,0L0,5" fill="#a855f7" />
        </marker>
        <style>
          {`
            @keyframes dash-flow {
              to { stroke-dashoffset: -20; }
            }
          `}
        </style>
      </defs>

      {edges.map((edge) => {
        const sourceMod = moduleMap.get(edge.source);
        const targetMod = moduleMap.get(edge.target);

        if (!sourceMod || !targetMod) return null;

        const path = edgePath(sourceMod.x, sourceMod.y, targetMod.x, targetMod.y);

        let strokeColor = edgeVar(0.15);
        let strokeWidth = 1;
        let strokeOpacity = 1;
        let markerId = "arrow-dim";
        let isHighlighted = false;
        let dashStyle = {};

        if (activeId) {
          if (sourceMod.id === activeId) {
            // Outbound from active node
            strokeColor = "#38bdf8";
            strokeWidth = 2;
            markerId = "arrow-outbound";
            isHighlighted = true;
          } else if (targetMod.id === activeId) {
            // Inbound to active node
            strokeColor = "#a855f7";
            strokeWidth = 2;
            markerId = "arrow-inbound";
            isHighlighted = true;
          } else {
            // Unrelated edge
            strokeOpacity = 0.08;
          }
        }

        if (isHighlighted && !reducedMotion) {
          dashStyle = {
            strokeDasharray: "6 4",
            animation: "dash-flow 1s linear infinite",
          };
        } else if (isHighlighted && reducedMotion) {
            dashStyle = {
                strokeDasharray: "6 4",
            }
        }

        return (
          <path
            key={`${edge.source}-${edge.target}`}
            d={path}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            opacity={strokeOpacity}
            markerEnd={`url(#${markerId})`}
            style={dashStyle}
            pointerEvents="none"
          />
        );
      })}
    </g>
  );
});
