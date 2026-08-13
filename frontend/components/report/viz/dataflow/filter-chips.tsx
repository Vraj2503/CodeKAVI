"use client";
// dataflow/filter-chips.tsx — node kind toggle chips
import type { NodeKind } from "./model";
import { ALL_NODE_KINDS, KIND_LABEL } from "./model";

interface FilterChipsProps {
  value: Set<NodeKind>;
  onChange: (next: Set<NodeKind>) => void;
}

export function FilterChips({ value, onChange }: FilterChipsProps) {
  function toggle(kind: NodeKind) {
    const next = new Set(value);
    next.has(kind) ? next.delete(kind) : next.add(kind);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap gap-1">
      {ALL_NODE_KINDS.map((k) => (
        <button
          key={k}
          aria-pressed={value.has(k)}
          onClick={() => toggle(k)}
          className={[
            "rounded px-2 py-0.5 text-[11px] transition-colors",
            value.has(k)
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {KIND_LABEL[k]}
        </button>
      ))}
    </div>
  );
}
