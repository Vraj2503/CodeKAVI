import React from "react";
import { Handle, Position, NodeProps, Node } from "@xyflow/react";
import { ArchitectureNodeData, ArchitectureTechnology } from "./types";
import { cn } from "@/lib/utils";
import { Circle, Server, Database, CloudCog, ArrowRightLeft, Users } from "lucide-react";

const KindIcon = ({ kind, className }: { kind: string; className?: string }) => {
  switch (kind) {
    case "gateway":
      return <ArrowRightLeft className={cn("w-4 h-4", className)} />;
    case "service":
      return <Server className={cn("w-4 h-4", className)} />;
    case "datastore":
    case "cache":
      return <Database className={cn("w-4 h-4", className)} />;
    case "external":
    case "queue":
      return <CloudCog className={cn("w-4 h-4", className)} />;
    case "client":
      return <Users className={cn("w-4 h-4", className)} />;
    default:
      return <Circle className={cn("w-4 h-4", className)} />;
  }
};

export function ArchitectureNode({ data, selected }: NodeProps<Node<ArchitectureNodeData>>) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card text-card-foreground shadow-sm w-[320px] transition-all overflow-hidden",
        selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50"
      )}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-muted text-muted-foreground flex-shrink-0">
            <KindIcon kind={data.kind} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm truncate" title={data.label}>
              {data.label}
            </div>
          </div>
        </div>
        
        {data.summary && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2" title={data.summary}>
            {data.summary}
          </p>
        )}
        
        {data.technologies && data.technologies.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {data.technologies.map((tech: ArchitectureTechnology, i: number) => (
              <div 
                key={i} 
                className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-[10px] uppercase font-medium tracking-wide flex items-center gap-1"
                title={tech.purpose || `${tech.vendor} ${tech.product}`}
              >
                <span className="opacity-70">{tech.vendor}</span>
                <span>{tech.product}</span>
                {tech.model && <span className="opacity-70 border-l border-border pl-1">{tech.model}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

export function ArchitectureGroupNode({ data }: NodeProps<Node<{ label: string } & Record<string, unknown>>>) {
  return (
    <div className="w-full h-full relative">
      <div className="absolute top-0 left-4 z-10 -translate-y-1/2 rounded border border-border/50 bg-background/75 px-2 py-0.5 font-mono text-xs font-semibold tracking-widest uppercase text-muted-foreground shadow-sm backdrop-blur-md">
        {data.label}
      </div>
      <div className="pointer-events-none h-full w-full rounded-2xl border-2 border-dashed border-border/50 bg-muted/10 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.05)] backdrop-blur-md" />
    </div>
  );
}
