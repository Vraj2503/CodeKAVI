import React from "react";
import { ArchitectureNodeData } from "./types";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Network, FileCode, CheckCircle2 } from "lucide-react";

interface ArchitectureInspectorProps {
  node: ArchitectureNodeData | null;
  onClose?: () => void;
}

export function ArchitectureInspector({ node, onClose }: ArchitectureInspectorProps) {
  if (!node) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground p-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <Network className="w-8 h-8 opacity-20" />
          <p className="text-sm">Select a component<br/>to inspect responsibilities</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background/50 backdrop-blur-sm border-l border-border/50">
      <div className="p-4 border-b border-border/50 flex items-center justify-between">
        <h3 className="font-semibold">{node.label}</h3>
        {onClose && (
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            &times;
          </button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          
          {/* Summary */}
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Responsibility</h4>
            <p className="text-sm leading-relaxed">{node.summary}</p>
          </section>

          {/* Technologies */}
          {node.technologies && node.technologies.length > 0 && (
            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Technologies</h4>
              <div className="space-y-2">
                {node.technologies.map((tech, i) => (
                  <div key={i} className="flex flex-col gap-1 text-sm bg-muted/50 p-2.5 rounded-lg border border-border/50">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground">{tech.vendor} {tech.product}</span>
                      {tech.model && <span className="text-xs bg-secondary px-1.5 py-0.5 rounded text-secondary-foreground">{tech.model}</span>}
                    </div>
                    {tech.purpose && <span className="text-xs text-muted-foreground">{tech.purpose}</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="h-px bg-border/50 my-4" />

          {/* Evidence */}
          {node.evidence && node.evidence.length > 0 && (
            <section className="space-y-3">
              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <CheckCircle2 className="w-3.5 h-3.5" /> Source Evidence
              </h4>
              <div className="space-y-2">
                {node.evidence.map((ev, i) => (
                  <div key={i} className="text-sm space-y-1.5 p-2 rounded-md hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-2 font-mono text-xs text-primary">
                      <FileCode className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate" title={ev.path}>{ev.path}</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-5">{ev.reason}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      </ScrollArea>
    </div>
  );
}
