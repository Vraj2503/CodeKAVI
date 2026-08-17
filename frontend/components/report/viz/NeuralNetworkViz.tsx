/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Info,
  Download,
  Loader2,
  Pencil,
  Eye,
  Plus,
  Maximize2,
} from "lucide-react";
import type { NNModel } from "@/lib/api";
import { FigureCanvas } from "./FigureCanvas";
import { FigureEditor } from "./FigureEditor";
import { NNEditor } from "./NNEditor";
import { exportFigure, figureSlug } from "@/lib/viz/exportFigure";
import { emptyModel, addLayer } from "@/lib/viz/figureModel";
import {
  PALETTES,
  SURFACES,
  DEFAULT_PALETTE,
  paletteById,
  type Surface,
} from "@/lib/viz/palettes";
import { STYLES, DEFAULT_STYLE, styleById } from "@/lib/viz/styles";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/*
 * ── Why this figure ignores the app theme ────────────────────────────────
 *
 * Every other chart in Rune reads `--viz-*` CSS custom properties so it
 * follows light/dark. This one deliberately does not, for two reasons:
 *
 *   1. A serialised SVG has no document to inherit from. `hsl(var(--x))`
 *      resolves to nothing the moment the file leaves the page, so a
 *      token-driven figure exports as a black-on-black rectangle.
 *   2. A figure destined for a paper has to look identical everywhere.
 *
 * The style / palette / surface controls change the *figure's own* material,
 * and the export matches exactly what is on screen.
 */

function ModelFigure({ model: detected }: { model: NNModel }) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Scopes marker/pattern/gradient ids. Two figures on one page would
  // otherwise share `url(#glow-…)` and the second would inherit the first's.
  const uid = useId().replace(/:/g, "");

  const [styleId, setStyleId] = useState(DEFAULT_STYLE.id);
  const [paletteId, setPaletteId] = useState(DEFAULT_PALETTE.id);
  const [surfaceId, setSurfaceId] = useState<keyof typeof SURFACES>("paper");
  const [surfaceTouched, setSurfaceTouched] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NNModel>(detected);
  const [busy, setBusy] = useState<string | null>(null);
  const [fullEditor, setFullEditor] = useState(false);

  /*
   * The figure is scaled to fit its pane rather than left to overflow.
   * A wide model used to run off the right edge and disappear under the
   * visualization panel, where no amount of scrolling could reach it.
   */
  const paneRef = useRef<HTMLDivElement>(null);
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

  // A style implies a surface, but an explicit pick always wins — switching
  // style should not silently discard a background the user chose.
  const surface: Surface = {
    ...SURFACES[surfaceTouched ? surfaceId : style.surfaceId],
    ...(style.surface ?? {}),
  };

  const download = async (format: "svg" | "png") => {
    if (!svgRef.current) return;
    setBusy(format);
    try {
      await exportFigure(svgRef.current, format, {
        filename: figureSlug(draft.name),
        scale: 3,
        // A transparent surface must export with alpha, not a white plate.
        background: surface.bg === "transparent" ? null : surface.bg,
      });
      toast.success(`Exported ${format.toUpperCase()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    /*
     * `min-w-0` matters: this sits inside flex and grid ancestors whose
     * default `auto` minimum is the *content* width. A wide figure would
     * otherwise force every ancestor wider than the viewport, pushing the
     * toolbar's export buttons off-screen — which is exactly what happened.
     */
    <div className="w-full min-w-0 max-w-full">
      {/* Toolbar — app chrome, never part of the exported figure */}
      {/* Toolbar. `flex-wrap` plus no `ml-auto` on the export group: with
          `ml-auto` the buttons were pinned to the far right of the line, and
          once the sidebar opened they slid under the panel's `overflow-x-hidden`
          where they could be neither seen nor clicked. Wrapping to a second
          row keeps them reachable at every width. */}
      <div className="mb-2 flex w-full min-w-0 flex-wrap items-center gap-1.5 px-1">
        <button
          onClick={() => setEditing(!editing)}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full border px-3 font-sans text-[12px] font-medium transition-all active:scale-[0.97]",
            editing
              ? "border-signal bg-signal/15 text-signal"
              : "border-border/60 bg-card/50 text-muted-foreground hover:border-signal/60 hover:text-signal",
          )}
        >
          {editing ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
          {editing ? "Preview" : "Quick edit"}
        </button>

        <button
          onClick={() => setFullEditor(true)}
          className="flex h-8 items-center gap-1.5 rounded-full bg-signal px-3.5 font-sans text-[12px] font-semibold text-signal-foreground transition-transform active:scale-[0.97]"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          NN Editor
        </button>

        <Select
          value={styleId}
          onChange={setStyleId}
          title={style.description}
          options={STYLES.map((s) => ({ value: s.id, label: s.label }))}
        />

        {/* Palette is a plain select. The swatch strip that used to sit
            beside it never optically aligned with the pill controls — a row
            of squares reads as a different rhythm from a row of capsules, and
            the figure itself is the real preview anyway. */}
        <Select
          value={paletteId}
          onChange={setPaletteId}
          title={palette.description}
          options={PALETTES.map((p) => ({ value: p.id, label: p.label }))}
        />

        <Select
          value={surfaceTouched ? surfaceId : style.surfaceId}
          onChange={(v) => {
            setSurfaceTouched(true);
            setSurfaceId(v as keyof typeof SURFACES);
          }}
          title="Figure background"
          options={Object.values(SURFACES).map((s) => ({
            value: s.id,
            label: s.label,
          }))}
        />

        <div className="flex items-center gap-1.5">
          {(["svg", "png"] as const).map((f) => (
            <button
              key={f}
              onClick={() => download(f)}
              disabled={busy !== null}
              title={
                f === "svg"
                  ? "Vector — for LaTeX, Illustrator, print"
                  : "Raster at 3× ≈ 300dpi"
              }
              className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-3 font-sans text-[12px] font-medium text-muted-foreground transition-all hover:border-signal/60 hover:text-signal active:scale-[0.97] disabled:opacity-50"
            >
              {busy === f ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {fullEditor && (
        <NNEditor
          initial={draft}
          onClose={() => setFullEditor(false)}
          onApply={setDraft}
        />
      )}

      {editing ? (
        <FigureEditor
          model={draft}
          onChange={setDraft}
          onReset={() => setDraft(detected)}
          palette={palette}
          surface={surface}
          style={style}
          svgRef={svgRef}
          uid={uid}
        />
      ) : (
        /* The surface colour lives on the CONTAINER, not just the <svg>.
           A figure narrower than the panel used to leave the sheet ending
           mid-panel with app background beside it, which read as a broken
           layout. Export is unaffected — `exportFigure` paints its own
           background rect into the serialised document. */
        <div
          ref={paneRef}
          className="w-full min-w-0 max-w-full overflow-x-auto rounded-2xl border border-border/60"
          style={{
            background: surface.bg === "transparent" ? undefined : surface.bg,
          }}
        >
          <FigureCanvas
            ref={svgRef}
            model={draft}
            palette={palette}
            surface={surface}
            style={style}
            uid={uid}
            fitWidth={paneWidth ? paneWidth - 2 : undefined}
          />
        </div>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  title?: string;
}) {
  return (
    <select
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-full border border-border/60 bg-card/50 px-3 font-sans text-[12px] text-muted-foreground outline-none transition-colors hover:border-signal/60 hover:text-signal focus:border-signal"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ── Main export ──────────────────────────────────────────────────────────
interface NeuralNetworkVizProps {
  models?: NNModel[];
  data?: any; // Fallback for VizContainer data passing
}

export function NeuralNetworkViz({ models, data }: NeuralNetworkVizProps) {
  // Support both direct models prop and data.models from viz pipeline
  const resolvedModels: NNModel[] = models || data?.models || [];
  const [scratch, setScratch] = useState<NNModel | null>(null);

  if (resolvedModels.length === 0) {
    // No detected model is not a dead end — the editor can build one from
    // scratch, which is half the point of shipping it.
    if (scratch) return <ModelFigure model={scratch} />;

    return (
      <div className="flex h-[400px] flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center border border-border">
          <Info size={24} className="text-muted-foreground" />
        </div>
        <h3 className="mb-2 font-sans text-[15px] font-semibold text-foreground">
          No neural networks detected
        </h3>
        <p className="mb-5 max-w-md font-sans text-[13px] text-muted-foreground">
          This repository doesn&apos;t contain recognizable model definitions
          (PyTorch nn.Module, Keras Sequential, TensorFlow). You can still draw
          an architecture by hand.
        </p>
        <button
          onClick={() => {
            const base = emptyModel("New architecture");
            const a = addLayer(base, "convolution");
            const b = addLayer(a.model, "activation");
            setScratch(b.model);
          }}
          className="flex h-8 items-center gap-2 border border-signal bg-signal/12 px-3 font-mono text-[11.5px] text-signal transition-colors hover:bg-signal/20"
        >
          <Plus className="h-3.5 w-3.5" />
          START A BLANK DIAGRAM
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-10">
      {resolvedModels.map((model, idx) => (
        <ModelFigure key={`${model.name}-${idx}`} model={model} />
      ))}
    </div>
  );
}
