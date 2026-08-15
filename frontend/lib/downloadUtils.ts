import { toPng, toSvg } from 'html-to-image';

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

const FILTER_CLASSES = ['react-flow__minimap', 'react-flow__controls', 'react-flow__panel', 'export-hide'];

function filterUiElements(node: HTMLElement): boolean {
  if (node?.classList) {
    for (const cls of FILTER_CLASSES) {
      if (node.classList.contains(cls)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Export the visual content inside `container` as a PNG image.
 */
export async function exportAsPng(
  container: HTMLElement,
  filename = "visualization.png"
): Promise<void> {
  // Use a dark background to blend nicely, maintaining WySiWyg from screen
  const dataUrl = await toPng(container, {
    backgroundColor: '#060B18', // Match the CodeKAVI dark theme bg
    pixelRatio: 2, // High DPI
    filter: filterUiElements,
  });
  downloadDataUrl(dataUrl, filename);
}

/**
 * Export the visual content inside `container` as an SVG file.
 * We use a foreignObject wrapper through html-to-image to preserve HTML nodes and SVG edge animations!
 */
export async function exportAsSvg(
  container: HTMLElement,
  filename = "visualization.svg"
): Promise<void> {
  const dataUrl = await toSvg(container, {
    backgroundColor: '#060B18', // Match the CodeKAVI dark theme bg
    filter: filterUiElements,
  });
  downloadDataUrl(dataUrl, filename);
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
