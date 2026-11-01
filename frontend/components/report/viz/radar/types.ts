export interface RadarTier {
  level: number;
  name: string;
  radius: number;
  color: string;
}

export interface RadarSymbol {
  name: string;
  kind: "function" | "method" | "class";
  line: number;
  complexity: number;
  doc?: string;
}

export interface RadarModule {
  id: string;
  name: string;
  path: string;
  tier: number;
  role: string;
  role_label: string;
  loc: number;
  cc: number;
  functions: number;
  density: number;
  is_hotspot: boolean;
  inbound: string[];
  outbound: string[];
  symbols: RadarSymbol[];
  theta: number;
  dist: number;
  x: number;
  y: number;
}

export interface RadarEdge {
  source: string;
  target: string;
}

export interface RadarStats {
  total_modules: number;
  avg_cc: number;
  hotspot_count: number;
  tier_counts: number[];
}

export interface RadarData {
  tiers: RadarTier[];
  modules: RadarModule[];
  edges: RadarEdge[];
  stats: RadarStats;
}

export type ColorMode = "risk" | "tier";
export type SizeMode = "cc" | "loc";

export interface RadarState {
  colorMode: ColorMode;
  sizeMode: SizeMode;
  showHull: boolean;
  showSweep: boolean;
  hoveredId: string | null;
  selectedId: string | null;
  searchQuery: string;
}

export type RadarAction =
  | { type: "SET_COLOR_MODE"; payload: ColorMode }
  | { type: "SET_SIZE_MODE"; payload: SizeMode }
  | { type: "TOGGLE_HULL" }
  | { type: "TOGGLE_SWEEP" }
  | { type: "HOVER"; payload: string | null }
  | { type: "SELECT"; payload: string | null }
  | { type: "SEARCH"; payload: string };
