import React, { useMemo } from "react";
import { ArchitectureNodeData, ArchitectureDiagnostics } from "./types";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Network, FileCode, CheckCircle2, Sparkles } from "lucide-react";
import { getRichResponsibility } from "./responsibilities";

interface ArchitectureInspectorProps {
  node: ArchitectureNodeData | null;
  diagnostics?: ArchitectureDiagnostics | null;
  onClose?: () => void;
}

export function ArchitectureInspector({ node, diagnostics, onClose }: ArchitectureInspectorProps) {
  const responsibilities = useMemo(() => {
    if (!node) return [];
    return getRichResponsibility(node);
  }, [node]);

  const isEnriched = useMemo(() => {
    if (diagnostics?.is_llm_enriched) return true;
    return responsibilities.some(
      (s) =>
        s.startsWith("Business problem solved:") ||
        s.startsWith("Key project workflows:"),
    );
  }, [diagnostics, responsibilities]);

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
          
          {/* Responsibility */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Responsibility</h4>
                {isEnriched ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                    <Sparkles className="w-2.5 h-2.5" /> AI Enriched{diagnostics?.model_name ? ` (${diagnostics.model_name})` : ""}
                  </span>
                ) : (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    Static Analysis{diagnostics?.fallback_reason ? ` (${diagnostics.fallback_reason})` : ""}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/50">
                {node.kind}
              </span>
            </div>
            <div className="space-y-3">
              {responsibilities.map((sentence, i) => {
                const colonIndex = sentence.indexOf(": ");
                const hasLabel = colonIndex > 0 && colonIndex < 35;
                const label = hasLabel ? sentence.slice(0, colonIndex) : null;
                const body = hasLabel ? sentence.slice(colonIndex + 2) : sentence;

                return (
                  <div key={i} className="flex items-start gap-2.5 text-xs sm:text-sm leading-relaxed">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/70 mt-1.5 shrink-0" />
                    <div>
                      {label && (
                        <span className="font-semibold text-foreground mr-1.5">
                          {label}:
                        </span>
                      )}
                      <span className="text-muted-foreground">{body}</span>
                    </div>
                  </div>
                );
              })}
            </div>
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
