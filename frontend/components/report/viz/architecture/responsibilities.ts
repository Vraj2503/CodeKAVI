import { ArchitectureNodeData } from "./types";

/** A summary as points: one per line (how the backend writes them), else one per sentence. */
export function splitIntoSentences(text: string): string[] {
  if (!text) return [];

  if (text.includes("\n")) {
    return text
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // Split on sentence boundaries: period/exclamation/question followed by space and a prefix/capital letter
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z`])/);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function evidenceLine(evidence: ArchitectureNodeData["evidence"]): string[] {
  const paths = (evidence ?? []).map((e) => e.path).filter((p) => p && !p.startsWith("<"));
  if (paths.length === 0) return [];
  const names = paths
    .slice(0, 2)
    .map((p) => `\`${p.split("/").pop() || p}\``)
    .join(" and ");
  return [
    paths.length <= 2
      ? `Implemented in ${names}.`
      : `Implemented in ${paths.length} source files, including ${names}.`,
  ];
}

/**
 * The points shown for an architecture node. The backend writes its summary from the
 * analyzed repository's facts (what the main files do, which files use a provider), or
 * the AI mode writes it from them. Nothing is filled in from fixed text: a fixed
 * paragraph per label and per provider described CodeKAVI's own features for every
 * repository (removed 2026-11-16). With no summary, only the files the node rests on.
 */
export function getRichResponsibility(node: ArchitectureNodeData): string[] {
  const points = splitIntoSentences((node.summary || "").trim());
  return points.length > 0 ? points : evidenceLine(node.evidence);
}
