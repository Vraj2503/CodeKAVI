"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Trash2,
  Copy,
  Undo2,
  RotateCcw,
  Download,
  Loader2,
  Crosshair,
  Maximize,
  Minimize,
  ChevronUp,
  ChevronDown,
  GripVertical,
} from "lucide-react";
import type { NNModel, NNLayer } from "@/lib/api";
import { FigureCanvas } from "./FigureCanvas";
import { cn } from "@/lib/utils";
import { exportFigure, figureSlug } from "@/lib/viz/exportFigure";
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
  PALETTES,
  SURFACES,
  paletteById,
  swatchFor,
  type Surface,
} from "@/lib/viz/palettes";
import { STYLES, styleById } from "@/lib/viz/styles";
import { formatShape } from "@/lib/viz/nnLayout";
import { toast } from "sonner";

/**
 * The dedicated architecture editor.
 *
 * Rendered as a full-screen portal rather than inline. That is not a
 * cosmetic choice: the visualization panel clips on the x-axis, so an inline
 * editor's controls became unreachable the moment the sidebar opened. A
 * portal at the document root answers to nobody's overflow.
 *
 * Chrome follows Apple's HIG rather than the app's square TELEMETRY styling —
 * generous continuous radii, translucent materials over a blurred backdrop,
 * one soft shadow layer instead of borders everywhere, and 32–44px hit
 * targets. The figure inside stays exactly as it renders everywhere else.
 */
export function NNEditor({
  initial,
  onClose,
  onApply,
}: {
  initial: NNModel;
  onClose: () => void;
  onApply: (m: NNModel) => void;
}) {
  const [model, setModel] = useState<NNModel>(initial);
  const [history, setHistory] = useState<NNModel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    initial.layers[0]?.id ?? null,
  );
  const [offsets, setOffsets] = useState<Record<string, { dx: number; dy: number }>>({});
  const [colors, setColors] = useState<Record<string, string>>({});
  const [styleId, setStyleId] = useState("publication");
  const [paletteId, setPaletteId] = useState("scientific");
  const [surfaceKey, setSurfaceKey] = useState<keyof typeof SURFACES>("black");
  const [ground, setGround] = useState<"plain" | "grid" | "dots">("dots");
  const [busy, setBusy] = useState<string | null>(null);
  /*
   * Export background is independent of the canvas you design on.
   *
   * Those are different decisions: people compose against black because the
   * blocks read best there, then need the figure to drop onto white paper or
   * a branded slide. Tying the two together forced them to switch the canvas
   * to Transparent purely to get a transparent file — changing how the
   * figure looked while they were still working on it.
   */
  const [exportBg, setExportBg] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  /*
   * Fit the figure to the pane, same as the read-only view. Without this the
   * SVG overflowed horizontally, and because the white sheet was an inner
   * `w-full` div — 100% of the *visible* width, not the scroll width — the
   * region past it was never painted and the editor backdrop showed through
   * as a dark rectangle in the bottom-right.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  /*
   * True fullscreen, not just a full-viewport overlay.
   *
   * The overlay already covers the page, but browser chrome, tab strip and OS
   * menu bar still eat vertical space — on a laptop that is ~15% of the
   * canvas. `requestFullscreen` on the editor root reclaims it.
   *
   * State is driven by the `fullscreenchange` event rather than by the click
   * handler, because the user can also leave fullscreen with Escape or F11
   * and the button has to stay truthful about which state it is in.
   */
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await rootRef.current?.requestFullscreen();
      }
    } catch {
      // Denied by the browser (permissions policy, or no user gesture).
      // The overlay is still full-viewport, so this degrades to a no-op.
      toast.error("Fullscreen was blocked by the browser");
    }
  };

  const paneRef = useRef<HTMLElement>(null);
  const [paneWidth, setPaneWidth] = useState(0);
  useEffect(() => {
    const el = paneRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) =>
      setPaneWidth(entry.contentRect.width),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const style = styleById(styleId);
  const palette = paletteById(paletteId);
  const surface: Surface = { ...SURFACES[surfaceKey], ...(style.surface ?? {}) };

  const selected = useMemo(
    () => model.layers.find((l) => l.id === selectedId) ?? null,
    [model, selectedId],
  );

  // Escape closes, matching every other modal surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // In fullscreen the browser consumes Escape to exit; closing the editor
      // too would dump the user back two levels from one keypress.
      if (e.key === "Escape" && !document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const commit = (next: NNModel) => {
    setHistory((h) => [...h, model].slice(-60));
    setModel(next);
  };
  const undo = () => {
    if (!history.length) return;
    setModel(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  };
  const patch = (p: Partial<NNLayer>) => {
    if (selected) commit(updateLayer(model, selected.id, p));
  };

  const nudge = (id: string, dx: number, dy: number) =>
    setOffsets((o) => {
      const cur = o[id] ?? { dx: 0, dy: 0 };
      // No negation. The offset is consumed in SCREEN space — `cuboid` adds
      // cx/cy after projection — so a downward pointer delta is a downward
      // move. Negating here inverted the vertical drag.
      return { ...o, [id]: { dx: cur.dx + dx, dy: cur.dy + dy } };
    });

  const download = async (format: "svg" | "png") => {
    if (!svgRef.current) return;
    setBusy(format);
    try {
      await exportFigure(svgRef.current, format, {
        filename: figureSlug(model.name),
        scale: 3,
        // `null` keeps PNG alpha and omits the SVG's backing rect entirely.
        background:
          !exportBg || surface.bg === "transparent" ? null : surface.bg,
      });
      toast.success(
        `Exported ${format.toUpperCase()}${exportBg ? "" : " · transparent"}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[300] flex flex-col bg-background/80 backdrop-blur-xl"
    >
      {/* ── Title bar ─────────────────────────────────────────────── */}
      <header className="flex flex-shrink-0 flex-wrap items-center gap-2 px-4 py-3">
        <input
          value={model.name}
          onChange={(e) => setModel({ ...model, name: e.target.value })}
          aria-label="Diagram title"
          className="min-w-0 max-w-[240px] flex-1 rounded-xl border border-border/60 bg-card/60 px-3 py-1.5 font-sans text-[14px] font-semibold text-foreground outline-none transition-colors focus:border-signal"
        />

        {/* Selects, not pills. Six styles + three grounds + four surfaces is
            thirteen pills; they overflowed the bar and pushed Done and the
            canvas picker off-screen entirely. */}
        <Field2 label="Style">
          <select
            value={styleId}
            title={style.description}
            onChange={(e) => setStyleId(e.target.value)}
            className={selectCls}
          >
            {STYLES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </Field2>

        {/* Plain select. A strip of square swatches never optically aligned
            beside the capsule controls, and the canvas is the real preview. */}
        <div className="flex h-9 items-center rounded-full border border-border/60 bg-card/60 px-1">
          <select
            value={paletteId}
            onChange={(e) => setPaletteId(e.target.value)}
            className="h-7 rounded-full bg-transparent px-2 font-sans text-[12px] text-foreground outline-none"
          >
            {PALETTES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <Field2 label="Ground">
          <select
            value={ground}
            onChange={(e) => setGround(e.target.value as typeof ground)}
            className={selectCls}
          >
            <option value="plain">Plain</option>
            <option value="grid">Grid</option>
            <option value="dots">Dots</option>
          </select>
        </Field2>

        <Field2 label="Canvas">
          <select
            value={surfaceKey}
            onChange={(e) =>
              setSurfaceKey(e.target.value as keyof typeof SURFACES)
            }
            className={selectCls}
          >
            {Object.values(SURFACES).map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </Field2>

        <div className="ml-auto flex items-center gap-2">
          <RoundBtn onClick={undo} disabled={!history.length} label="Undo">
            <Undo2 className="h-4 w-4" />
          </RoundBtn>
          <RoundBtn
            onClick={() => {
              setModel(initial);
              setOffsets({});
              setColors({});
              setHistory([]);
            }}
            label="Reset"
          >
            <RotateCcw className="h-4 w-4" />
          </RoundBtn>
          <RoundBtn onClick={() => setOffsets({})} label="Re-align blocks">
            <Crosshair className="h-4 w-4" />
          </RoundBtn>
          <RoundBtn
            onClick={toggleFullscreen}
            label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </RoundBtn>

          <button
            type="button"
            role="switch"
            aria-checked={exportBg}
            onClick={() => setExportBg(!exportBg)}
            title={
              exportBg
                ? "Exporting with the canvas background"
                : "Exporting with a transparent background"
            }
            className={cn(
              "flex h-9 items-center gap-2 rounded-full border px-3",
              "font-sans text-[12px] transition-colors",
              exportBg
                ? "border-border/60 bg-card/60 text-foreground"
                : "border-signal/50 bg-signal/10 text-signal",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "h-3 w-3 rounded-[3px] border",
                exportBg ? "border-border bg-foreground/70" : "border-signal/60",
              )}
              /* Checkerboard when off — the universal "no background" cue. */
              style={
                exportBg
                  ? undefined
                  : {
                      backgroundImage:
                        "linear-gradient(45deg,#8888 25%,transparent 25%,transparent 75%,#8888 75%),linear-gradient(45deg,#8888 25%,transparent 25%,transparent 75%,#8888 75%)",
                      backgroundSize: "6px 6px",
                      backgroundPosition: "0 0, 3px 3px",
                    }
              }
            />
            {exportBg ? "Background" : "Transparent"}
          </button>

          {(["svg", "png"] as const).map((f) => (
            <button
              key={f}
              onClick={() => download(f)}
              disabled={busy !== null}
              className="flex h-9 items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 font-sans text-[13px] font-medium text-foreground transition-all hover:border-signal/60 hover:bg-signal/10 active:scale-[0.97] disabled:opacity-50"
            >
              {busy === f ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {f.toUpperCase()}
            </button>
          ))}

          <button
            onClick={() => {
              onApply(model);
              onClose();
            }}
            className="h-9 rounded-full bg-signal px-5 font-sans text-[13px] font-semibold text-signal-foreground transition-transform active:scale-[0.97]"
          >
            Done
          </button>
          <RoundBtn onClick={onClose} label="Close editor">
            <X className="h-4 w-4" />
          </RoundBtn>
        </div>
      </header>

      {/* ── Work area ─────────────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 gap-3 px-4 pb-4 lg:grid-cols-[248px_minmax(0,1fr)_248px]">
        {/* Library + layer stack */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/50 shadow-lift">
          <SectionTitle>Add block</SectionTitle>
          <div className="flex flex-wrap gap-1.5 px-3 pb-3">
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
                  className="flex items-center gap-1.5 rounded-full border border-border/50 px-2.5 py-1 font-sans text-[11.5px] text-foreground transition-all hover:border-signal/50 active:scale-[0.96]"
                  style={{ background: `${c.face}1f` }}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: c.face }}
                    aria-hidden="true"
                  />
                  {CATEGORY_LABEL[cat]}
                </button>
              );
            })}
          </div>

          <SectionTitle>Layers</SectionTitle>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {model.layers.map((l, i) => {
              const c = colors[l.id]
                ? { face: colors[l.id] }
                : swatchFor(palette, l.category);
              return (
                <div
                  key={l.id}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex != null && dragIndex !== i)
                      commit(moveLayer(model, dragIndex, i));
                    setDragIndex(null);
                  }}
                  onClick={() => setSelectedId(l.id)}
                  className={cn(
                    "group mb-1 flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 transition-colors",
                    selectedId === l.id ? "bg-signal/15" : "hover:bg-accent/60",
                    dragIndex === i && "opacity-40",
                  )}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-md"
                    style={{ background: c.face }}
                  />
                  <span className="min-w-0 flex-1 truncate font-sans text-[12.5px] text-foreground">
                    {l.type}
                  </span>
                  <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
                    <IconBtn onClick={() => commit(moveLayer(model, i, i - 1))} label="Up">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn onClick={() => commit(moveLayer(model, i, i + 1))} label="Down">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn onClick={() => commit(duplicateLayer(model, l.id))} label="Duplicate">
                      <Copy className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn
                      onClick={() => {
                        commit(removeLayer(model, l.id));
                        if (selectedId === l.id) setSelectedId(null);
                      }}
                      label="Delete"
                      danger
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  </div>
                </div>
              );
            })}
            {!model.layers.length && (
              <p className="px-2 py-6 text-center font-sans text-[12px] text-muted-foreground">
                No blocks yet — add one above.
              </p>
            )}
          </div>
        </aside>

        {/* Canvas */}
        {/* The surface colour lives on the SCROLLING element. A background on
            an inner child only covers the visible box, leaving the overflow
            region unpainted. */}
        {/*
          The ground is painted TWICE, deliberately.

          Inside the <svg> it is an SVG <pattern>, so it survives
          serialisation and shows up in every export. But the svg is only as
          tall as the figure, which left the rest of the pane bare — so the
          same pattern is mirrored here in CSS to make the editor read as one
          continuous canvas. The export stays correctly cropped to the figure
          instead of baking in a screenful of empty ground.
        */}
        <main
          ref={paneRef}
          className="min-w-0 overflow-auto rounded-2xl border border-border/60 shadow-lift"
          style={{
            background: surface.bg === "transparent" ? undefined : surface.bg,
            ...(ground === "dots"
              ? {
                  backgroundImage: `radial-gradient(circle at 2px 2px, ${surface.inkDim}57 1.1px, transparent 1.1px)`,
                  backgroundSize: "20px 20px",
                }
              : ground === "grid"
                ? {
                    backgroundImage: `linear-gradient(to right, ${surface.inkDim}29 1px, transparent 1px), linear-gradient(to bottom, ${surface.inkDim}29 1px, transparent 1px)`,
                    backgroundSize: "24px 24px",
                  }
                : {}),
          }}
        >
          <FigureCanvas
            ref={svgRef}
            model={model}
            palette={palette}
            surface={surface}
            style={style}
            offsets={offsets}
            colors={colors}
            uid="nn-editor"
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNodeDrag={nudge}
            ground={ground}
            fitWidth={paneWidth ? paneWidth - 2 : undefined}
          />
        </main>

        {/* Inspector */}
        <aside className="flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-border/60 bg-card/50 shadow-lift">
          <SectionTitle>Inspector</SectionTitle>
          {!selected ? (
            <p className="px-3 pb-4 font-sans text-[12px] text-muted-foreground">
              Select a block on the canvas.
            </p>
          ) : (
            <div className="space-y-3 px-3 pb-4">
              <Field label="Label">
                <input
                  value={selected.type}
                  onChange={(e) => patch({ type: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Type">
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

              <Field label="Colour">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={colors[selected.id] ?? swatchFor(palette, selected.category).face}
                    onChange={(e) =>
                      setColors((c) => ({ ...c, [selected.id]: e.target.value }))
                    }
                    className="h-8 w-10 cursor-pointer rounded-lg border border-border/60 bg-transparent p-0.5"
                  />
                  {colors[selected.id] && (
                    <button
                      onClick={() =>
                        setColors((c) => {
                          const n = { ...c };
                          delete n[selected.id];
                          return n;
                        })
                      }
                      className="rounded-full border border-border/60 px-2 py-1 font-sans text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </Field>

              <Field label="Units">
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
              <Field label="Shape">
                <input
                  defaultValue={formatShape(selected.output_shape)}
                  placeholder="64×112×112"
                  onBlur={(e) => patch({ output_shape: parseShape(e.target.value) })}
                  className={inputCls}
                />
              </Field>
              <Field label="Params">
                <input
                  type="number"
                  min={0}
                  value={selected.param_count ?? ""}
                  onChange={(e) =>
                    patch({ param_count: Number(e.target.value) || undefined })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Repeat">
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={repeatOf(model, selected.id)}
                  onChange={(e) =>
                    commit(setRepeat(model, selected.id, Number(e.target.value)))
                  }
                  className={inputCls}
                />
              </Field>

              {model.layers.slice(0, model.layers.findIndex((l) => l.id === selected.id))
                .length > 0 && (
                <Field label="Residual">
                  <select
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      commit(toggleSkip(model, e.target.value, selected.id))
                    }
                    className={inputCls}
                  >
                    <option value="">add from…</option>
                    {model.layers
                      .slice(0, model.layers.findIndex((l) => l.id === selected.id))
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.type}
                        </option>
                      ))}
                  </select>
                </Field>
              )}

              <p className="pt-1 font-sans text-[11px] leading-relaxed text-muted-foreground">
                Drag a block on the canvas to nudge it off the auto-layout.
                Re-align (⌖) clears every nudge.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>,
    document.body,
  );
}

const selectCls =
  "h-7 rounded-full bg-transparent px-1 font-sans text-[12px] text-foreground outline-none";

/** Label + control in one capsule, so the bar reads as a row of settings. */
function Field2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex h-9 items-center gap-1.5 rounded-full border border-border/60 bg-card/60 pl-3 pr-1.5">
      <span className="font-sans text-[11px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 font-sans text-[12.5px] text-foreground outline-none transition-colors focus:border-signal";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-sans text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-3 pb-2 pt-3 font-sans text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </h3>
  );
}

function RoundBtn({
  children,
  onClick,
  label,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card/60 text-muted-foreground transition-all hover:border-signal/60 hover:text-signal active:scale-[0.94] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-lg p-1 text-muted-foreground/70 transition-colors",
        danger ? "hover:text-crit" : "hover:text-signal",
      )}
    >
      {children}
    </button>
  );
}
