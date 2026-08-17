"use client";
// dataflow/trace-toolbar.tsx — Trace from / Reset affordance
interface TraceToolbarProps {
  traceFrom: string | null;
  selectedId: string | null;
  selectedLabel: string;
  onTrace: (id: string) => void;
  onReset: () => void;
}

export function TraceToolbar({
  traceFrom,
  selectedId,
  selectedLabel,
  onTrace,
  onReset,
}: TraceToolbarProps) {
  if (!selectedId) return null;

  return (
    <div className="flex items-center gap-2">
      {!traceFrom ? (
        <button
          onClick={() => onTrace(selectedId)}
          className="rounded px-2 py-0.5 text-[11px] bg-accent text-foreground hover:bg-accent/80 transition-colors"
        >
          Trace <span className="font-mono text-muted-foreground">{selectedLabel}</span>
        </button>
      ) : (
        <button
          onClick={onReset}
          className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          ✕ Reset trace
        </button>
      )}
    </div>
  );
}
