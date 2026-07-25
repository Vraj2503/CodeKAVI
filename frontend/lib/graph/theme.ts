// ponytail: 5 chart hues cycled across 9 backend layer ids means two layers
// share a hue (routes/config, services/tests, models/documentation). Upgrade
// to distinct hues per layer if that visibly reads as ambiguous on a real repo.
const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const LAYER_ORDER = [
  "routes",
  "services",
  "models",
  "database",
  "utils",
  "config",
  "tests",
  "documentation",
  "other",
];

const LAYER_COLOR_VARS: Record<string, string> = Object.fromEntries(
  LAYER_ORDER.map((id, i) => [id, CHART_VARS[i % CHART_VARS.length]]),
);

export function layerColor(layerId: string | null): string {
  return (layerId && LAYER_COLOR_VARS[layerId]) || "var(--muted-foreground)";
}
