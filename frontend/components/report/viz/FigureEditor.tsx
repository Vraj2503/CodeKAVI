"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  GripVertical,
  RotateCcw,
  Undo2,
} from "lucide-react";
import type { NNModel, NNLayer } from "@/lib/api";
import { FigureCanvas } from "./FigureCanvas";
import { cn } from "@/lib/utils";
import {
  ADDABLE_CATEGORIES,
  addLayer,
  duplicateLayer,
  moveLayer,
  parseShape,
  removeLayer,
  repeatOf,
  setRepeat,
  toggleSkip,
  updateLayer,
} from "@/lib/viz/figureModel";
import {
  CATEGORY_LABEL,
  swatchFor,
  type Palette,
  type Surface,
} from "@/lib/viz/palettes";
import { formatShape } from "@/lib/viz/nnLayout";
import type { FigureStyle } from "@/lib/viz/styles";

/**
 * Direct-manipulation editor for the architecture figure.
 *
 * Every mutation is a pure transform in `figureModel`, so the preview is the
 * exact same `FigureCanvas` the read-only view and the exporter use. Undo is
 * therefore a stack of previous documents rather than a log of inverse
 * operations — cheap, and impossible to get out of sync.
 */
export function FigureEditor({
  model,
  onChange,
  onReset,
  palette,
  surface,
  style,
  svgRef,
  uid,
}: {
  model: NNModel;
  onChange: (next: NNModel) => void;
  onReset: () => void;
  palette: Palette;
  surface: Surface;
  style: FigureStyle;
  svgRef: React.Ref<SVGSVGElement>;
  uid: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    model.layers[0]?.id ?? null,
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /*
   * Undo history is state, not a ref. The undo button's `disabled` is derived
   * from its depth, and a ref read during render does not schedule the
   * re-render that would update it — the button would stay stuck.
   */
  const [history, setHistory] = useState<NNModel[]>([]);

  const selected = useMemo(
    () => model.layers.find((l) => l.id === selectedId) ?? null,
    [model, selectedId],
  );

  const commit = (next: NNModel) => {
    setHistory((h) => [...h, model].slice(-50));
    onChange(next);
  };

  const undo = () => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    onChange(prev);
  };

  const patch = (p: Partial<NNLayer>) => {
    if (!selected) return;
    commit(updateLayer(model, selected.id, p));
  };

  const selIndex = model.layers.findIndex((l) => l.id === selectedId);
  const earlier = model.layers.slice(0, Math.max(selIndex, 0));
  const activeSkips = (model.connections ?? []).filter(
    (c) => c.type !== "sequential" && c.to_id === selectedId,
  );

  return (
    /*
      `minmax(0, 1fr)`, not `1fr`. A bare `1fr` track is `minmax(auto, 1fr)`,
      and its auto minimum is the content's intrinsic width — so the wide
      preview SVG would blow the grid out past the viewport instead of
      scrolling inside its own pane.
    */
    <div className="grid min-w-0 gap-3 lg:grid-cols-[290px_minmax(0,1fr)]">
      {/* ── Left rail: layer stack + inspector ────────────────────── */}
      <div className="flex min-h-0 flex-col border border-border bg-card/40">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="eyebrow">layers</span>
          <div className="flex items-center gap-1">
            <button
              onClick={undo}
              disabled={history.length === 0}
              title="Undo"
              aria-label="Undo"
              className="p-1 text-muted-foreground transition-colors hover:text-signal disabled:opacity-30"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onReset}
              title="Reset to detected model"
              aria-label="Reset to detected model"
              className="p-1 text-muted-foreground transition-colors hover:text-signal"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="max-h-[280px] overflow-y-auto">
          {model.layers.length === 0 && (
            <p className="px-3 py-6 text-center font-mono text-[11px] text-muted-foreground">
              empty — add a layer below
            </p>
          )}
          {model.layers.map((l, i) => {
            const c = swatchFor(palette, l.category);
            return (
              <div
                key={l.id}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex != null && dragIndex !== i) {
                    commit(moveLayer(model, dragIndex, i));
                  }
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
                onClick={() => setSelectedId(l.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-b border-border/60 px-2 py-1.5",
                  "transition-colors",
                  selectedId === l.id
                    ? "bg-signal/12"
                    : "hover:bg-accent/50",
                  dragIndex === i && "opacity-40",
                )}
              >
                <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                <span
                  className="h-3 w-3 shrink-0 border"
                  style={{ background: c.face, borderColor: c.edge }}
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground">
                  {l.type}
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(moveLayer(model, i, i - 1));
                    }}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="p-0.5 text-muted-foreground/60 hover:text-signal disabled:opacity-20"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(moveLayer(model, i, i + 1));
                    }}
                    disabled={i === model.layers.length - 1}
                    aria-label="Move down"
                    className="p-0.5 text-muted-foreground/60 hover:text-signal disabled:opacity-20"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(duplicateLayer(model, l.id));
                    }}
                    aria-label="Duplicate"
                    className="p-0.5 text-muted-foreground/60 hover:text-signal"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      commit(removeLayer(model, l.id));
                      if (selectedId === l.id) setSelectedId(null);
                    }}
                    aria-label="Delete"
                    className="p-0.5 text-muted-foreground/60 hover:text-crit"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add */}
        <div className="border-t border-border p-2">
          <label className="eyebrow mb-1 block">add layer</label>
          <div className="flex flex-wrap gap-1">
            {ADDABLE_CATEGORIES.map((cat) => {
              const c = swatchFor(palette, cat);
              return (
                <button
                  key={cat}
                  onClick={() => {
                    const { model: next, id } = addLayer(model, cat);
                    commit(next);
                    setSelectedId(id);
                  }}
                  title={`Add ${CATEGORY_LABEL[cat]}`}
                  className="flex items-center gap-1 border px-1.5 py-0.5 font-mono text-[10px] text-foreground transition-transform hover:scale-105"
                  style={{ borderColor: c.edge, background: `${c.face}22` }}
                >
                  <span
                    className="h-2 w-2"
                    style={{ background: c.face }}
                    aria-hidden="true"
                  />
                  {CATEGORY_LABEL[cat]}
                  <Plus className="h-2.5 w-2.5" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Inspector */}
        {selected && (
          <div className="border-t border-border p-3">
            <span className="eyebrow mb-2 block">inspector</span>
            <div className="space-y-2">
              <Field label="name">
                <input
                  value={selected.type}
                  onChange={(e) => patch({ type: e.target.value })}
                  className={inputCls}
                />
              </Field>

              <Field label="category">
                <select
                  value={selected.category}
                  onChange={(e) => patch({ category: e.target.value })}
                  className={inputCls}
                >
                  {ADDABLE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="units">
                <input
                  type="number"
                  min={1}
                  value={Number(selected.params?.units ?? "") || ""}
                  placeholder="auto"
                  onChange={(e) =>
                    patch({
                      params: {
                        ...selected.params,
                        units: Number(e.target.value) || undefined,
                      },
                    })
                  }
                  className={inputCls}
                />
              </Field>

              <Field label="shape">
                <input
                  defaultValue={formatShape(selected.output_shape)}
                  placeholder="64×112×112"
                  onBlur={(e) =>
                    patch({ output_shape: parseShape(e.target.value) })
                  }
                  className={inputCls}
                />
              </Field>

              <Field label="params">
                <input
                  type="number"
                  min={0}
                  value={selected.param_count ?? ""}
                  placeholder="0"
                  onChange={(e) =>
                    patch({
                      param_count: Number(e.target.value) || undefined,
                    })
                  }
                  className={inputCls}
                />
              </Field>

              <Field label="repeat">
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={repeatOf(model, selected.id)}
                  onChange={(e) =>
                    commit(
                      setRepeat(model, selected.id, Number(e.target.value)),
                    )
                  }
                  className={inputCls}
                />
              </Field>

              {earlier.length > 0 && (
                <Field label="residual">
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      commit(toggleSkip(model, e.target.value, selected.id));
                    }}
                    className={inputCls}
                  >
                    <option value="">
                      {activeSkips.length
                        ? `${activeSkips.length} incoming`
                        : "add from…"}
                    </option>
                    {earlier.map((l) => (
                      <option key={l.id} value={l.id}>
                        {activeSkips.some((s) => s.from_id === l.id)
                          ? `✓ ${l.type}`
                          : l.type}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Live preview ──────────────────────────────────────────── */}
      <div
        className="min-w-0 overflow-x-auto border border-border"
        style={{
          background: surface.bg === "transparent" ? undefined : surface.bg,
        }}
      >
        <FigureCanvas
          ref={svgRef}
          model={model}
          palette={palette}
          surface={surface}
          style={style}
          uid={uid}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  );
}

const inputCls =
  "w-full border border-border bg-background px-1.5 py-1 font-mono text-[11.5px] text-foreground outline-none focus:border-signal";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid grid-cols-[60px_1fr] items-center gap-2">
      <span className="font-mono text-[10.5px] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
