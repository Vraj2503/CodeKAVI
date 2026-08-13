"use client";
// dataflow/detail-panel.tsx — slide-in node inspector panel
import type { FlowNode } from "./model";
import { KIND_LABEL } from "./model";

interface DetailPanelProps {
  node: FlowNode | null;
  onClose: () => void;
  onTraceFrom: (id: string) => void;
  expanded: boolean;
  onToggleExpanded: (id: string) => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

const SOURCE_KIND_LABEL: Record<string, string> = {
  http:  "HTTP endpoint",
  queue: "Message queue",
  file:  "File / stream",
  cron:  "Scheduled (cron)",
  event: "Event",
};

export function DetailPanel({ node, onClose, onTraceFrom, expanded, onToggleExpanded }: DetailPanelProps) {
  if (!node) return null;

  return (
    <aside
      role="complementary"
      aria-label={`Details for ${node.label}`}
      className="absolute right-3 top-3 z-50 w-72 max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-card/95 backdrop-blur shadow-xl p-4 text-xs"
      style={{ transition: "transform 200ms ease" }}
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{node.label}</h2>
          <p className="text-muted-foreground">{KIND_LABEL[node.kind] ?? node.kind}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close detail panel"
          className="text-muted-foreground hover:text-foreground transition-colors text-base"
        >
          ×
        </button>
      </header>

      {/* Source */}
      {node.source && (
        <Section title="Data source">
          <div className="rounded bg-muted p-2 font-mono text-[10px]">
            <span className="text-muted-foreground">
              {SOURCE_KIND_LABEL[node.source.kind] ?? node.source.kind}:{" "}
            </span>
            {node.source.spec}
          </div>
        </Section>
      )}

      {/* Description */}
      {node.description && (
        <Section title="What it does">
          <p className="text-muted-foreground leading-snug">{node.description}</p>
        </Section>
      )}

      {/* Inputs */}
      {(node.inputs?.length ?? 0) > 0 && (
        <Section title="Inputs">
          <ul className="space-y-0.5 font-mono">
            {node.inputs!.map((i) => (
              <li key={i.name}>
                {i.name}:{" "}
                <span className="text-muted-foreground">{i.type}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Outputs */}
      {(node.outputs?.length ?? 0) > 0 && (
        <Section title="Returns">
          <ul className="space-y-0.5 font-mono">
            {node.outputs!.map((o) => (
              <li key={o.name}>
                {o.name}:{" "}
                <span className="text-muted-foreground">{o.type}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* DB reads/writes */}
      {((node.reads?.length ?? 0) > 0 || (node.writes?.length ?? 0) > 0) && (
        <Section title="Data access">
          <div className="flex flex-wrap gap-1">
            {(node.reads ?? []).map((r) => (
              <span key={r} className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                R: {r}
              </span>
            ))}
            {(node.writes ?? []).map((w) => (
              <span key={w} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                W: {w}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Source files */}
      {(node.source_files?.length ?? 0) > 0 && (
        <Section title="Files">
          <ul className="space-y-0.5">
            {node.source_files!.map((f) => (
              <li key={f} className="truncate font-mono text-[10px] text-muted-foreground">
                {f}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {(node.technologies?.length ?? 0) > 0 && (
        <Section title="Detected products">
          <div className="space-y-1">
            {node.technologies!.map((technology) => (
              <div key={technology.id} className="rounded bg-muted px-2 py-1">
                <span className="font-medium">{technology.label}</span>
                <span className="ml-1 text-muted-foreground">— {technology.role}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => onToggleExpanded(node.id)}
            className="mt-2 w-full rounded border border-border py-1 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors"
          >
            {expanded ? "Hide implementation detail" : "Show implementation detail"}
          </button>
        </Section>
      )}

      {/* Trace action */}
      <div className="mt-4">
        <button
          onClick={() => onTraceFrom(node.id)}
          className="w-full rounded border border-border py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          Trace from here →
        </button>
      </div>
    </aside>
  );
}
