import { X } from "lucide-react";
import { EFFECT_META, isKnowledgeEffect } from "@/lib/knowledge/effects";
import type { KnowledgeSymbol } from "@/lib/api";

export interface SymbolPanelProps {
  symbol: KnowledgeSymbol;
  onClose: () => void;
}

export function SymbolPanel({ symbol, onClose }: SymbolPanelProps) {
  const effects = symbol.effects.filter(isKnowledgeEffect);

  return (
    <aside
      aria-label={`details for ${symbol.label}`}
      className="flex w-72 shrink-0 flex-col gap-3 border-l bg-card p-3 font-mono text-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{symbol.label}</div>
          <div className="truncate text-muted-foreground" title={symbol.file}>
            {symbol.file}
            {symbol.line !== null && `:${symbol.line}`}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close panel"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {symbol.signature && (
        <div className="overflow-x-auto rounded border bg-muted px-2 py-1.5 text-foreground">
          {symbol.signature}
        </div>
      )}

      {symbol.description && (
        <p className="text-foreground">{symbol.description}</p>
      )}

      {symbol.doc && <p className="text-muted-foreground">{symbol.doc}</p>}

      <dl className="flex flex-col gap-1.5 text-muted-foreground">
        <div className="flex justify-between">
          <dt>called by</dt>
          <dd className="text-foreground">{symbol.in_degree}</dd>
        </div>
        <div className="flex justify-between">
          <dt>calls</dt>
          <dd className="text-foreground">{symbol.out_degree}</dd>
        </div>
        {symbol.role && (
          <div className="flex justify-between gap-2">
            <dt>role</dt>
            <dd className="truncate text-foreground">{symbol.role}</dd>
          </div>
        )}
        {symbol.http && (
          <div className="flex justify-between gap-2">
            <dt>route</dt>
            <dd className="truncate text-foreground">{symbol.http}</dd>
          </div>
        )}
      </dl>

      {symbol.external_calls.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {symbol.external_calls.map((call) => (
            <span
              key={call}
              className="rounded border bg-muted px-1.5 py-0.5 text-foreground"
            >
              {call}
            </span>
          ))}
        </div>
      )}

      {effects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {effects.map((effect) => {
            const Icon = EFFECT_META[effect].icon;
            return (
              <span
                key={effect}
                title={EFFECT_META[effect].label}
                className="flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-muted-foreground"
              >
                <Icon className="h-3 w-3" />
                {EFFECT_META[effect].label}
              </span>
            );
          })}
        </div>
      )}
    </aside>
  );
}
