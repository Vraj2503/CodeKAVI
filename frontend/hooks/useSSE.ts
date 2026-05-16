"use client";

import { useState, useRef, useCallback } from "react";

interface SSECallbacks {
  onStats?: (data: any) => void;
  onTree?: (data: any) => void;
  onSection?: (data: any) => void;
  onProgress?: (data: {
    phase: string;
    progress: number;
    message: string;
  }) => void;
  onWarning?: (data: { section: string; message: string }) => void;
  onError?: (data: { message: string }) => void;
  onDone?: (data: { status: string }) => void;
}

export function useSSE(callbacks: SSECallbacks) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [message, setMessage] = useState("");

  // Store callbacks in a ref to avoid stale closures
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // AbortController ref for cancellation
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const startStream = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      // Abort any existing stream
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      setProgress(0);
      setPhase("");
      setMessage("");

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          callbacksRef.current.onError?.({
            message: `Stream failed: ${response.status} ${errorText}`,
          });
          setIsStreaming(false);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          callbacksRef.current.onError?.({ message: "No readable stream" });
          setIsStreaming(false);
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();

          if (value) {
            buffer += decoder.decode(value, { stream: !done });
          } else if (done) {
            buffer += decoder.decode(undefined, { stream: false });
          }

          // Split on double newlines (SSE event boundary)
          const parts = buffer.split("\n\n");
          // Keep the last (potentially incomplete) chunk in the buffer
          buffer = parts.pop() || "";

          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            // Parse SSE format: "event: TYPE\ndata: JSON"
            let eventType = "";
            let eventData = "";

            for (const line of trimmed.split("\n")) {
              if (line.startsWith("event:")) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                eventData = line.slice(5).trim();
              }
            }

            if (!eventType || !eventData) continue;

            let parsed: any;
            try {
              parsed = JSON.parse(eventData);
            } catch {
              console.warn("Failed to parse SSE data:", eventData);
              continue;
            }

            // Dispatch to the appropriate callback
            switch (eventType) {
              case "stats":
                callbacksRef.current.onStats?.(parsed);
                break;
              case "tree":
                callbacksRef.current.onTree?.(parsed);
                break;
              case "section":
                callbacksRef.current.onSection?.(parsed);
                break;
              case "progress":
                setProgress(parsed.progress ?? 0);
                setPhase(parsed.phase ?? "");
                setMessage(parsed.message ?? "");
                callbacksRef.current.onProgress?.(parsed);
                break;
              case "warning":
                callbacksRef.current.onWarning?.(parsed);
                break;
              case "error":
                callbacksRef.current.onError?.(parsed);
                break;
              case "done":
                callbacksRef.current.onDone?.(parsed);
                break;
              default:
                console.warn("Unknown SSE event type:", eventType);
            }
          }

          if (done) break;
        }

        // Stream ended naturally
        setIsStreaming(false);
      } catch (err: any) {
        if (err.name === "AbortError") {
          // User cancelled — don't treat as error
          setIsStreaming(false);
          return;
        }
        callbacksRef.current.onError?.({
          message: err.message || "Stream connection failed",
        });
        setIsStreaming(false);
      }
    },
    []
  );

  return { startStream, stop, isStreaming, progress, phase, message };
}
