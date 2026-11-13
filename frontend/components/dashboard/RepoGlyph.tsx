/**
 * A tiny dependency-graph mark, drawn from the repository's name.
 *
 * It carries no data — it is a stable fingerprint, so every row in the history
 * is recognisable at a glance and the list reads as a set of maps, not a set of
 * strings. Same path in, same drawing out.
 */

import { useMemo } from "react";
import { hashString, seeded } from "./seed";

export function RepoGlyph({ seed }: { seed: string }) {
  const points = useMemo(() => {
    const rand = seeded(hashString(seed));
    return Array.from({ length: 5 }, () => ({
      x: 6 + rand() * 24,
      y: 6 + rand() * 24,
    }));
  }, [seed]);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      className="db-glyph"
      width="36"
      height="36"
      viewBox="0 0 36 36"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} fill="none" stroke="var(--acc)" strokeWidth="1.2" opacity="0.55" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === 0 ? 2.8 : 2}
          fill={i === 0 ? "var(--ink)" : "var(--acc)"}
        />
      ))}
    </svg>
  );
}

export default RepoGlyph;
