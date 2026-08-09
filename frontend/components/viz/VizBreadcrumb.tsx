"use client";

/**
 * N-segment breadcrumb for drilling into a visualization.
 *
 * Generalized from components/graph/GraphBreadcrumb.tsx, which was hardwired
 * to exactly two levels ("All layers > current"). That shape works for the
 * dependency graph, whose hierarchy really is two deep, but not for the
 * treemap, where a path like frontend/components/report/viz is four. A back
 * button also cannot express where you are or let you jump two levels at once.
 */

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VizCrumb {
  /** Stable key — a path prefix, a module id. Not the label, which can repeat. */
  id: string | null;
  label: string;
}

export interface VizBreadcrumbProps {
  segments: VizCrumb[];
  onNavigate: (id: string | null, index: number) => void;
  className?: string;
}

export function VizBreadcrumb({
  segments,
  onNavigate,
  className,
}: VizBreadcrumbProps) {
  if (segments.length === 0) return null;

  return (
    <nav
      aria-label="breadcrumb"
      className={cn("flex items-center gap-1 font-mono text-xs", className)}
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={`${seg.id ?? "root"}-${i}`} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight
                className="h-3 w-3 shrink-0 text-muted-foreground/60"
                aria-hidden="true"
              />
            )}
            {isLast ? (
              // Current location is not a control — announcing it as one would
              // promise navigation that goes nowhere.
              <span
                aria-current="page"
                className="rounded px-1 py-0.5 font-medium text-foreground"
              >
                {seg.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(seg.id, i)}
                className={cn(
                  "rounded px-1 py-0.5 text-muted-foreground transition-colors",
                  "hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2",
                  "focus-visible:ring-[hsl(var(--viz-highlight))]",
                )}
              >
                {seg.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
