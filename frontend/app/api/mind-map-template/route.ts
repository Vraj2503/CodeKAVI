import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const runtime = "nodejs";

/**
 * The supplied template lives beside the project in development and is copied
 * into the frontend image during Docker builds. Serving it verbatim keeps its
 * embedded hand-drawn PNG assets and original editable-label behavior intact.
 */
// The dev server runs from `frontend/`, while the production image copies the
// file into that working directory. This remains a fixed, non-user-controlled
// path; the trace hint prevents Turbopack from treating the parent directory
// as an application dependency in development.
const templatePath = resolve(
  /* turbopackIgnore: true */ process.cwd(),
  process.env.NODE_ENV === "production" ? "Mind Map.html" : "../Mind Map.html",
);

export async function GET() {
  try {
    const template = await readFile(templatePath, "utf8");
    return new Response(template, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Mind map template is unavailable.", { status: 404 });
  }
}
