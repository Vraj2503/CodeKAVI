/**
 * Route Handler: POST /api/analyze/stream
 *
 * Proxies SSE streaming from FastAPI without buffering, so progress events
 * actually reach the frontend as they are emitted.
 *
 * Next.js API rewrites (next.config.ts rewrites) buffer chunked transfer responses,
 * making SSE from proxied backends appear frozen. This Route Handler receives the
 * streaming response from FastAPI and pipes it byte-for-byte to the client.
 */
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const githubUrl = body.github_url?.trim();

  if (!githubUrl) {
    return new Response(JSON.stringify({ detail: "github_url is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const backendUrl = "http://localhost:8000/api/analyze/stream";
    const response = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
      body: JSON.stringify({ github_url: githubUrl }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: "Analysis failed" }));
      return new Response(JSON.stringify(error), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Stream the SSE response directly to the client without buffering.
    // readable.full is not needed here — we pipe the raw stream through.
    const stream = response.body;

    if (!stream) {
      return new Response("Streaming not supported", { status: 500 });
    }

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",          // disable nginx buffering on managed hosts
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ detail: err.message || "Analysis failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}