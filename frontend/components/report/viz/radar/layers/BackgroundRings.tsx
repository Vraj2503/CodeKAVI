"use client";

import React from "react";
import { edgeVar, inkDimVar } from "@/lib/viz/tokens";
import type { RadarTier } from "../types";

interface BackgroundRingsProps {
  tiers: RadarTier[];
}

export const BackgroundRings = React.memo(function BackgroundRings({
  tiers,
}: BackgroundRingsProps) {
  // Generate 8 spoke lines
  const spokes = Array.from({ length: 8 }).map((_, i) => {
    const angle = (i * 45 * Math.PI) / 180;
    return {
      x2: 520 * Math.cos(angle),
      y2: 520 * Math.sin(angle),
    };
  });

  return (
    <g className="radar-background">
      {/* Spoke lines */}
      <g stroke={edgeVar()} strokeWidth={1} opacity={0.3}>
        {spokes.map((spoke, i) => (
          <line key={`spoke-${i}`} x1={0} y1={0} x2={spoke.x2} y2={spoke.y2} />
        ))}
      </g>

      {/* Rings and Labels */}
      {tiers.map((tier, i) => (
        <g key={`ring-${i}`}>
          <circle
            cx={0}
            cy={0}
            r={tier.radius}
            fill="none"
            stroke={edgeVar()}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text
            x={0}
            y={-tier.radius - 8}
            fill={inkDimVar()}
            fontSize={11}
            textAnchor="middle"
            paintOrder="stroke fill"
            stroke="hsl(var(--viz-surface))"
            strokeWidth={4}
            strokeLinejoin="round"
          >
            {tier.name}
          </text>
        </g>
      ))}
    </g>
  );
});
