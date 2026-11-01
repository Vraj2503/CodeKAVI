"use client";

import React, { useMemo, useCallback } from "react";
import { inkDimVar } from "@/lib/viz/tokens";
import type { RadarModule, RadarTier, ColorMode, SizeMode } from "../types";
import { nodeColor, nodeRadius, labelPosition, textAnchor, getConnected, riskColor } from "../useRadarLayout";

interface ModuleNodesProps {
  modules: RadarModule[];
  tiers: RadarTier[];
  colorMode: ColorMode;
  sizeMode: SizeMode;
  hoveredId: string | null;
  selectedId: string | null;
  searchMatches: Set<string>;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}

export const ModuleNodes = React.memo(function ModuleNodes({
  modules,
  tiers,
  colorMode,
  sizeMode,
  hoveredId,
  selectedId,
  searchMatches,
  onHover,
  onSelect,
}: ModuleNodesProps) {
  const activeId = hoveredId || selectedId;

  const connectedIds = useMemo(() => {
    if (!activeId) return new Set<string>();
    const { inbound, outbound } = getConnected(activeId, modules);
    return new Set([...inbound, ...outbound]);
  }, [activeId, modules]);

  return (
    <g className="radar-nodes">
      {modules.map((mod) => {
        const r = nodeRadius(mod, sizeMode);
        const fill = nodeColor(mod, colorMode, tiers);
        const { lx, ly } = labelPosition(mod, r);
        const anchor = textAnchor(mod.theta);

        let opacity = 1;
        if (activeId) {
          if (mod.id !== activeId && !connectedIds.has(mod.id)) {
            opacity = 0.18;
          }
        } else if (searchMatches.size < modules.length && !searchMatches.has(mod.id)) {
          opacity = 0.18;
        }

        const isHotspot = mod.cc >= 50;
        const fontSize = Math.max(8, Math.min(13, r * 0.6));

        const handleKeyDown = (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(selectedId === mod.id ? null : mod.id);
          }
        };

        return (
          <g
            key={mod.id}
            transform={`translate(${mod.x}, ${mod.y})`}
            opacity={opacity}
            style={{ transition: "opacity 0.2s ease" }}
            onMouseEnter={() => onHover(mod.id)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onSelect(selectedId === mod.id ? null : mod.id)}
            onKeyDown={handleKeyDown}
            role="button"
            tabIndex={0}
            aria-label={`${mod.path}, Complexity ${mod.cc}`}
            cursor="pointer"
          >
            {/* Hotspot Halo */}
            {isHotspot && (
              <circle
                r={r + 5}
                fill="none"
                stroke={riskColor(mod.cc)}
                strokeWidth={3}
                opacity={0.4}
              />
            )}

            {/* Main Circle */}
            <circle
              r={r}
              fill={fill}
              stroke="hsl(var(--viz-surface))"
              strokeWidth={1.5}
            />

            {/* CC Badge */}
            <text
              y={fontSize * 0.35}
              fill="#fff"
              fontSize={fontSize}
              fontWeight="bold"
              textAnchor="middle"
              pointerEvents="none"
            >
              {mod.cc}
            </text>

            {/* Label */}
            <text
              x={lx - mod.x}
              y={ly - mod.y}
              fill={inkDimVar()}
              fontSize={11}
              textAnchor={anchor}
              paintOrder="stroke fill"
              stroke="hsl(var(--viz-surface))"
              strokeWidth={4}
              strokeLinejoin="round"
              pointerEvents="none"
            >
              {mod.name}
            </text>
          </g>
        );
      })}
    </g>
  );
});
