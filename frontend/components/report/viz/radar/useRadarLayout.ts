"use client";

import { useMemo } from "react";
import type { RadarModule, RadarData, RadarTier, ColorMode, SizeMode } from "./types";

// Risk tier colors (same as mockup)
const RISK_COLORS = {
  low: "#10b981",    // CC < 15
  med: "#f59e0b",    // 15 <= CC < 30
  high: "#f97316",   // 30 <= CC < 50
  crit: "#ef4444",   // CC >= 50
} as const;

export function riskColor(cc: number): string {
  if (cc >= 50) return RISK_COLORS.crit;
  if (cc >= 30) return RISK_COLORS.high;
  if (cc >= 15) return RISK_COLORS.med;
  return RISK_COLORS.low;
}

export function riskLabel(cc: number): string {
  if (cc >= 50) return "Critical";
  if (cc >= 30) return "High";
  if (cc >= 15) return "Medium";
  return "Clean";
}

export function nodeColor(mod: RadarModule, mode: ColorMode, tiers: RadarTier[]): string {
  if (mode === "tier") return tiers[mod.tier]?.color ?? "#94a3b8";
  return riskColor(mod.cc);
}

export function nodeRadius(mod: RadarModule, mode: SizeMode): number {
  if (mode === "loc") {
    return Math.min(38, Math.max(12, 9 + Math.sqrt(mod.loc) * 0.85));
  }
  return Math.min(38, Math.max(12, 10 + Math.sqrt(mod.cc) * 2.8));
}

/** Quadratic Bezier edge path with control point pulled toward origin. */
export function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const mx = (sx + tx) / 2 * 0.65;
  const my = (sy + ty) / 2 * 0.65;
  return `M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`;
}

/** Hull polygon points — outer modules sorted by theta with spike distance. */
export function hullPoints(modules: RadarModule[]): string {
  const outer = modules
    .filter(m => m.tier >= 1)
    .sort((a, b) => a.theta - b.theta);
  if (outer.length < 3) return "";
  return outer
    .map(m => {
      const spikeDist = m.dist + (m.cc / 100) * 35;
      const x = spikeDist * Math.cos(m.theta);
      const y = spikeDist * Math.sin(m.theta);
      return `${x},${y}`;
    })
    .join(" ");
}

/** Text anchor based on angle quadrant. */
export function textAnchor(theta: number): "start" | "middle" | "end" {
  const cos = Math.cos(theta);
  if (cos > 0.1) return "start";
  if (cos < -0.1) return "end";
  return "middle";
}

/** Label position shifted outward from node center. */
export function labelPosition(mod: RadarModule, r: number): { lx: number; ly: number } {
  const offset = r + 14;
  return {
    lx: (mod.dist + offset) * Math.cos(mod.theta),
    ly: (mod.dist + offset) * Math.sin(mod.theta) + 4,
  };
}

/** Filter modules by search query. Returns Set of matching IDs. */
export function searchFilter(modules: RadarModule[], query: string): Set<string> {
  if (!query.trim()) return new Set(modules.map(m => m.id));
  const q = query.toLowerCase();
  return new Set(
    modules.filter(m => m.name.toLowerCase().includes(q) || m.path.toLowerCase().includes(q)).map(m => m.id)
  );
}

/** Get connected module IDs for a given module. */
export function getConnected(
  moduleId: string,
  modules: RadarModule[],
): { inbound: Set<string>; outbound: Set<string> } {
  const mod = modules.find(m => m.id === moduleId);
  if (!mod) return { inbound: new Set(), outbound: new Set() };
  return {
    inbound: new Set(mod.inbound),
    outbound: new Set(mod.outbound),
  };
}

export { RISK_COLORS };
