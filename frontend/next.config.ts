import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /*
   * Hides the floating "N" dev-tools badge Next.js pins to the corner in
   * development. It is Next's chrome, not ours, and it sat on top of the app
   * UI. Build and runtime errors are still surfaced — this only removes the
   * always-on indicator.
   */
  devIndicators: false,

  /**
   * Pin the Turbopack root to this directory.
   *
   * Next infers the root from the nearest lockfile, and a stray
   * `C:\Users\<you>\package-lock.json` outranks this project's own — so it was
   * inferring the whole HOME DIRECTORY as the workspace root and logging
   * "we detected multiple lockfiles". Per the Turbopack docs the root governs
   * module resolution and, more importantly here, filesystem watching scope:
   * rooted at home, the dev server watches Desktop, Documents and AppData.
   * That is what left it sitting near 1GB before its compile workers started
   * dying with "Jest worker encountered N child process exceptions".
   */
  turbopack: {
    root: projectRoot,
  },
  /* Allow Google profile photos */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  /* Route /api/analyze/stream to its dedicated Route Handler (app/api/analyze/stream/route.ts).
     All other /api/* calls are proxied to FastAPI without buffering. */
  async rewrites() {
    return [
      {
        // Specific match for the SSE endpoint — handled by the route handler
        source: "/api/analyze/stream",
        destination: "/api/analyze/stream",
      },
      {
        // Catch-all for everything else
        source: "/api/:path*",
        destination: `${process.env.BACKEND_URL || "http://127.0.0.1:8000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
