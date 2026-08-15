/**
 * Serialise an on-page <svg> to a downloadable SVG or PNG.
 *
 * Two things make an exported figure usable in a paper, and both are easy to
 * get wrong:
 *
 *   1. NO EXTERNAL REFERENCES. A live SVG inherits fonts and colours from the
 *      document. Once serialised it has neither, so every colour must already
 *      be a literal in the markup (the figure uses a fixed publication
 *      palette, never CSS custom properties) and font families must be named
 *      with real fallbacks. This is why the figure does not use the app's
 *      theme tokens.
 *   2. RESOLUTION. Journals and slide decks want ~300dpi. A 1× canvas raster
 *      of a 1200px figure is unusably soft in print, so PNG export takes a
 *      scale multiplier and sets the canvas backing store accordingly.
 */

export type ExportFormat = "svg" | "png";

interface ExportOptions {
  filename: string;
  /** Pixel multiplier for PNG. 3 ≈ 300dpi for a figure sized in CSS px. */
  scale?: number;
  /** Painted behind the figure. `null` leaves PNG transparent. */
  background?: string | null;
}

/**
 * Intrinsic size of a figure.
 *
 * The viewBox wins over the width/height attributes: when the figure is
 * scaled down to fit its pane, those attributes hold the *shrunken* size and
 * exporting from them would bake the on-screen reduction into the file.
 */
export function intrinsicSize(svg: SVGSVGElement): { width: number; height: number } {
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  return {
    width: Number(svg.getAttribute("width")) || svg.clientWidth || 1200,
    height: Number(svg.getAttribute("height")) || svg.clientHeight || 600,
  };
}

/** Standalone SVG document text for a live node. */
export function serializeSvg(svg: SVGSVGElement, background?: string | null): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  const { width, height } = intrinsicSize(svg);

  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  if (background) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "100%");
    rect.setAttribute("height", "100%");
    rect.setAttribute("fill", background);
    clone.insertBefore(rect, clone.firstChild);
  }

  const text = new XMLSerializer().serializeToString(clone);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${text}`;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in Safari; one frame is
  // enough for the navigation to have been queued.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

export async function exportFigure(
  svg: SVGSVGElement,
  format: ExportFormat,
  { filename, scale = 3, background = "#ffffff" }: ExportOptions,
): Promise<void> {
  const source = serializeSvg(svg, background);

  if (format === "svg") {
    triggerDownload(
      new Blob([source], { type: "image/svg+xml;charset=utf-8" }),
      `${filename}.svg`,
    );
    return;
  }

  const { width, height } = intrinsicSize(svg);

  // A data: URL rather than a blob: URL — a blob URL taints the canvas in
  // some Safari versions, which makes toBlob() throw a security error on an
  // image the page itself just produced.
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

  const img = new Image();
  img.decoding = "sync";

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not rasterise the figure"));
    img.src = encoded;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not encode the PNG");

  triggerDownload(blob, `${filename}@${scale}x.png`);
}

/** Filesystem-safe slug for a model name. */
export function figureSlug(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "architecture"
  );
}
