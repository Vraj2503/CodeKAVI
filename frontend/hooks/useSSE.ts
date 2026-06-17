"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase";

interface SSECallbacks {
  onStats?: (data: unknown) => void;
  onTree?: (data: unknown) => void;
  onSection?: (data: unknown) => void;
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
  
  // Update ref in an effect to avoid mutating during render
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

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

      if (url.includes("dev-mock-repo")) {
        setIsStreaming(true);
        setProgress(0);
        setPhase("Starting mock analysis");
        setMessage("Initializing");

        const sections = ["overview", "architecture", "components", "data_flow", "dependencies", "complexity", "patterns", "mindmap"];
        let step = 0;

        const interval = setInterval(() => {
          if (step === 0) {
            callbacksRef.current.onStats?.({
              total_files: 42,
              languages: { TypeScript: 60, CSS: 20, HTML: 20 },
              selected_files: 10,
              entry_points: ["index.ts"]
            });
          } else if (step <= sections.length) {
            const sectionName = sections[step - 1];
            const p = (step / sections.length) * 100;
            callbacksRef.current.onProgress?.({ phase: "generating", progress: p, message: `Generating ${sectionName}...` });
            callbacksRef.current.onSection?.({
              name: sectionName,
              content: `### Mock ${sectionName} content\n\nThis is fake content for testing the UI. It doesn't cost any Groq tokens!\n\n\`\`\`javascript\nconsole.log("Mock code snippet");\n\`\`\``
            });
          } else {
            clearInterval(interval);
            callbacksRef.current.onDone?.({ status: "success" });
            setIsStreaming(false);
          }
          step++;
        }, 1000);

        abortRef.current = { abort: () => clearInterval(interval) } as unknown as AbortController;
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      setIsStreaming(true);
      setProgress(0);
      setPhase("");
      setMessage("");

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const authHeader: Record<string, string> = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeader,
          },
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

            let parsed: unknown;
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
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // User cancelled — don't treat as error
          setIsStreaming(false);
          return;
        }
        callbacksRef.current.onError?.({
          message: err instanceof Error ? err.message : "Stream connection failed",
        });
        setIsStreaming(false);
      }
    },
    []
  );

  return { startStream, stop, isStreaming, progress, phase, message };
}
