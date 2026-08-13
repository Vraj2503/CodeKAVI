import {
  Unlink2,
  RefreshCw,
  Share2,
  LogIn,
  FileWarning,
  type LucideIcon,
} from "lucide-react";
import type { RepoGraphFile } from "@/lib/api";

export type GraphFlag =
  "orphan" | "in_cycle" | "hub" | "entry_point" | "god_file";

export const FLAG_ORDER: GraphFlag[] = [
  "entry_point",
  "hub",
  "orphan",
  "in_cycle",
  "god_file",
];

export const FLAG_META: Record<
  GraphFlag,
  { label: string; plural: string; description: string; icon: LucideIcon }
> = {
  orphan: {
    label: "orphaned",
    plural: "orphaned",
    description: "Nothing in the repo imports this file",
    icon: Unlink2,
  },
  in_cycle: {
    label: "circular",
    plural: "circular",
    description: "Part of a circular dependency",
    icon: RefreshCw,
  },
  hub: {
    label: "hub",
    plural: "hubs",
    description: "Heavily depended on by other files",
    icon: Share2,
  },
  entry_point: {
    label: "entry point",
    plural: "entry points",
    description: "Where execution starts",
    icon: LogIn,
  },
  god_file: {
    label: "god file",
    plural: "god files",
    description: "Unusually large for this repo",
    icon: FileWarning,
  },
};

function isGraphFlag(flag: string): flag is GraphFlag {
  return flag in FLAG_META;
}

/** Counts per flag across a file set, in display order. Zero-count flags are omitted. */
export function countFlags(
  files: RepoGraphFile[],
): { flag: GraphFlag; count: number }[] {
  const counts = new Map<GraphFlag, number>();
  for (const file of files) {
    for (const flag of file.flags) {
      if (!isGraphFlag(flag)) continue;
      counts.set(flag, (counts.get(flag) ?? 0) + 1);
    }
  }
  return FLAG_ORDER.filter((flag) => counts.get(flag)).map((flag) => ({
    flag,
    count: counts.get(flag)!,
  }));
}
