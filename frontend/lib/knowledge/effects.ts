import {
  HardDrive,
  Globe,
  Database,
  Zap,
  Sparkles,
  Terminal,
  GitBranch,
  type LucideIcon,
} from "lucide-react";

// Mirrors backend rune/symbol_graph.py's _EFFECT_KEYWORDS tags.
export type KnowledgeEffect =
  | "filesystem"
  | "network"
  | "db"
  | "cache"
  | "llm"
  | "subprocess"
  | "concurrency";

export const EFFECT_META: Record<
  KnowledgeEffect,
  { label: string; icon: LucideIcon }
> = {
  filesystem: { label: "filesystem", icon: HardDrive },
  network: { label: "network", icon: Globe },
  db: { label: "database", icon: Database },
  cache: { label: "cache", icon: Zap },
  llm: { label: "LLM call", icon: Sparkles },
  subprocess: { label: "subprocess", icon: Terminal },
  concurrency: { label: "concurrency", icon: GitBranch },
};

export function isKnowledgeEffect(effect: string): effect is KnowledgeEffect {
  return effect in EFFECT_META;
}
