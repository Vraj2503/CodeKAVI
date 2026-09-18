import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { FunctionSquare, Component, ArrowRightLeft, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { layerColorForRole } from "@/lib/graph/theme";
import { EFFECT_META, isKnowledgeEffect } from "@/lib/knowledge/effects";
import type { KnowledgeSymbol } from "@/lib/api";

const TYPE_ICON = {
  function: FunctionSquare,
  class: Component,
  method: ArrowRightLeft,
} as const;

export interface SymbolNodeData extends Record<string, unknown> {
  symbol: KnowledgeSymbol;
  onOpen: (symbolId: string) => void;
}

export type SymbolNodeType = Node<SymbolNodeData, "symbol">;

const HANDLE_STYLE = "!bg-transparent !border-0 !w-0 !h-0";

function SymbolNodeComponent({ data, selected }: NodeProps<SymbolNodeType>) {
  const { symbol, onOpen } = data;
  const accent = layerColorForRole(symbol.role);
  const importance = Math.max(0, Math.min(symbol.importance ?? 0, 100)) / 100;
  const TypeIcon =
    TYPE_ICON[symbol.type as keyof typeof TYPE_ICON] ?? FunctionSquare;
  const effects = symbol.effects.filter(isKnowledgeEffect);

  return (
    <div
      className={cn(
        "flex h-full w-full items-stretch overflow-hidden rounded-md border bg-card text-card-foreground shadow-sm",
        selected &&
          "ring-2 ring-[hsl(var(--viz-highlight))] ring-offset-1 ring-offset-background",
      )}
      title={symbol.signature ?? symbol.label}
    >
      <Handle type="target" position={Position.Top} className={HANDLE_STYLE} />

      <span
        className="w-1 shrink-0"
        style={{ background: accent, opacity: 0.35 + importance * 0.65 }}
      />

      <button
        type="button"
        onClick={() => onOpen(symbol.id)}
        className="flex min-w-0 flex-1 flex-col gap-1 px-2.5 py-1.5 text-left"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <TypeIcon
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: accent }}
            aria-hidden
          />
          <span className="truncate font-mono text-xs font-medium">
            {symbol.label}
          </span>
          {symbol.is_async && (
            <Zap
              className="h-3 w-3 shrink-0 text-muted-foreground"
              aria-label="async"
            />
          )}
        </div>

        {(() => {
          const secondary =
            symbol.description ?? symbol.doc ?? symbol.signature;
          return (
            secondary && (
              <span
                className="truncate text-[10px] text-muted-foreground"
                title={secondary}
              >
                {secondary}
              </span>
            )
          );
        })()}

        {symbol.http && (
          <span className="w-fit truncate rounded border bg-muted px-1 py-0.5 font-mono text-[9px] leading-none text-muted-foreground">
            {symbol.http}
          </span>
        )}

        {effects.length > 0 && (
          <div className="mt-auto flex items-center gap-1 pt-0.5">
            {effects.map((effect) => {
              const Icon = EFFECT_META[effect].icon;
              return (
                <Icon
                  key={effect}
                  className="h-3 w-3 text-muted-foreground"
                  aria-label={EFFECT_META[effect].label}
                />
              );
            })}
          </div>
        )}
      </button>

      <Handle
        type="source"
        position={Position.Bottom}
        className={HANDLE_STYLE}
      />
    </div>
  );
}

export const SymbolNode = memo(SymbolNodeComponent);
