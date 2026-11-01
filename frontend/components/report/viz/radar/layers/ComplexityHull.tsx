"use client";

import React from "react";
import type { RadarModule } from "../types";
import { hullPoints } from "../useRadarLayout";

interface ComplexityHullProps {
  modules: RadarModule[];
  visible: boolean;
}

export const ComplexityHull = React.memo(function ComplexityHull({
  modules,
  visible,
}: ComplexityHullProps) {
  const points = hullPoints(modules);

  if (!points) return null;

  return (
    <g
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 0.3s ease-in-out",
        pointerEvents: "none",
      }}
    >
      <defs>
        <radialGradient id="hull-gradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(239, 68, 68, 0.05)" />
          <stop offset="100%" stopColor="rgba(239, 68, 68, 0.35)" />
        </radialGradient>
        <filter id="hull-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy="0"
            stdDeviation="8"
            floodColor="rgba(239,68,68,0.4)"
          />
        </filter>
      </defs>

      <polygon
        points={points}
        fill="url(#hull-gradient)"
        stroke="#ef4444"
        strokeWidth="1.5"
        strokeDasharray="4 2"
        strokeOpacity="0.7"
        filter="url(#hull-shadow)"
      />
    </g>
  );
});
