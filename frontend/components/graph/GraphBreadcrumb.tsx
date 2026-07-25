import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RepoGraphLayer } from "@/lib/api";

export interface GraphBreadcrumbProps {
  activeLayer: RepoGraphLayer | null;
  onNavigate: (layerId: string | null) => void;
}

export function GraphBreadcrumb({
  activeLayer,
  onNavigate,
}: GraphBreadcrumbProps) {
  return (
    <nav
      aria-label="breadcrumb"
      className="flex items-center gap-1.5 font-mono text-xs"
    >
      <button
        type="button"
        onClick={() => onNavigate(null)}
        className={cn(
          "text-muted-foreground hover:text-foreground",
          !activeLayer && "font-medium text-foreground",
        )}
      >
        All layers
      </button>
      {activeLayer && (
        <>
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="font-medium text-foreground">
            {activeLayer.label}
          </span>
        </>
      )}
    </nav>
  );
}
