/**
 * downloadUtils.ts — Export visualization graphs as PNG, SVG, or JSON.
 *
 * All functions are pure browser utilities — no React dependencies.
 */

/**
 * Find the first <svg> element inside a container element.
 */
function findSvg(container: HTMLElement): SVGSVGElement | null {
  return container.querySelector("svg");
}

/**
 * Clone an SVG element and inline all computed styles so the exported
 * file looks identical to what the user sees on screen.
 */
function cloneAndStyleSvg(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  // Ensure the clone has explicit width/height (some browsers need this)
  const bbox = svg.getBoundingClientRect();
  clone.setAttribute("width", String(bbox.width));
  clone.setAttribute("height", String(bbox.height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  // Add a dark background so it looks right outside the app
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#0d1117");
  clone.insertBefore(bg, clone.firstChild);

  return clone;
}

/**
 * Serialize an SVG element to a data URL.
 */
function svgToDataUrl(svg: SVGSVGElement): string {
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svg);
  const encoded = encodeURIComponent(svgString);
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

/**
 * Trigger a browser download for a given blob.
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Trigger a browser download for a data URL.
 */
function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ── Public API ──

/**
 * Export the SVG inside `container` as a PNG image.
 */
export async function exportAsPng(
  container: HTMLElement,
  filename = "visualization.png"
): Promise<void> {
  const svg = findSvg(container);
  if (!svg) throw new Error("No SVG element found in container");

  const clone = cloneAndStyleSvg(svg);
  const svgString = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const bbox = svg.getBoundingClientRect();
  const scale = 2; // 2x for retina

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = bbox.width * scale;
      canvas.height = bbox.height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to create canvas context"));
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to create PNG blob"));
            return;
          }
          downloadBlob(blob, filename);
          resolve();
        },
        "image/png",
        1.0
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load SVG as image"));
    };
    img.src = url;
  });
}

/**
 * Export the SVG inside `container` as an SVG file.
 */
export function exportAsSvg(
  container: HTMLElement,
  filename = "visualization.svg"
): void {
  const svg = findSvg(container);
  if (!svg) throw new Error("No SVG element found in container");

  const clone = cloneAndStyleSvg(svg);
  const svgString = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, filename);
}

/**
 * Export arbitrary data as a formatted JSON file.
 */
export function exportAsJson(
  data: unknown,
  filename = "visualization.json"
): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  downloadBlob(blob, filename);
}
