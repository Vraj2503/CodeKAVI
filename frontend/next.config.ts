import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
        destination: `${process.env.BACKEND_URL || "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;