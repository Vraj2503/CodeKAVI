"use client";

import React, { useEffect, useRef } from "react";

interface SweepBeamProps {
  visible: boolean;
  reducedMotion: boolean;
}

export const SweepBeam = React.memo(function SweepBeam({
  visible,
  reducedMotion,
}: SweepBeamProps) {
  const groupRef = useRef<SVGGElement>(null);
  const angleRef = useRef(0);
  const rAFRef = useRef<number>(0);

  useEffect(() => {
    if (!visible || reducedMotion) {
      if (rAFRef.current) {
        cancelAnimationFrame(rAFRef.current);
      }
      return;
    }

    const animate = () => {
      angleRef.current = (angleRef.current + 0.5) % 360;
      if (groupRef.current) {
        groupRef.current.setAttribute("transform", `rotate(${angleRef.current})`);
      }
      rAFRef.current = requestAnimationFrame(animate);
    };

    rAFRef.current = requestAnimationFrame(animate);

    return () => {
      if (rAFRef.current) {
        cancelAnimationFrame(rAFRef.current);
      }
    };
  }, [visible, reducedMotion]);

  // A 45 degree wedge. Radius 520.
  // x1 = 520 * cos(45deg), y1 = 520 * sin(45deg)
  // 45 degrees in radians is Math.PI / 4
  const r = 520;
  const x1 = r * Math.cos(Math.PI / 4);
  const y1 = r * Math.sin(Math.PI / 4);

  return (
    <g
      ref={groupRef}
      style={{
        opacity: visible && !reducedMotion ? 1 : 0,
        transition: "opacity 0.5s ease-in-out",
        pointerEvents: "none",
      }}
    >
      <defs>
        <linearGradient id="sweep-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(56, 189, 248, 0)" />
          <stop offset="100%" stopColor="rgba(56, 189, 248, 0.08)" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,0 ${r},0 ${x1},${y1}`}
        fill="url(#sweep-grad)"
      />
      {/* Leading edge line */}
      <line
        x1={0}
        y1={0}
        x2={r}
        y2={0}
        stroke="rgba(56, 189, 248, 0.3)"
        strokeWidth={1}
      />
    </g>
  );
});
