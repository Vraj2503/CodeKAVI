"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Kbd } from "./ui/Kbd";

type Health = "checking" | "ok" | "down";

/**
 * The bottom status line — the instrument's own vitals.
 *
 * Every editor and terminal worth using has one, and it is the natural
 * home for facts that were previously either invisible (is the backend
 * reachable?) or shoved into a panel that had to earn its space (the
 * ⌘K hint). It costs 26px once, globally.
 *
 * The health poll is deliberately slow (60s) and pauses when the tab is
 * hidden: a status light nobody is looking at should not keep a request
 * loop alive.
 */
export function StatusBar({ className }: { className?: string }) {
  const [health, setHealth] = useState<Health>("checking");
  const [clock, setClock] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const check = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch("/api/health", { signal: controller.signal });
        if (!cancelled) setHealth(res.ok ? "ok" : "down");
      } catch {
        // An abort is us tearing down on purpose, never a health failure.
        if (!cancelled && !controller.signal.aborted) setHealth("down");
      }
    };

    check();
    const id = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  // Rendered client-side only (empty until first tick) so the server and
  // client markup cannot disagree about what time it is.
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const dot =
    health === "ok"
      ? "bg-ok"
      : health === "down"
        ? "bg-crit"
        : "bg-muted-foreground";

  return (
    <footer
      className={cn(
        "flex h-[26px] flex-shrink-0 items-center gap-4 border-t border-border",
        "bg-card/80 px-3 font-mono text-[10.5px] text-muted-foreground backdrop-blur-xl",
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            dot,
            health === "ok" && "live-dot",
          )}
          aria-hidden="true"
        />
        <span className="uppercase tracking-[0.12em]">
          {health === "ok" ? "online" : health === "down" ? "offline" : "…"}
        </span>
      </span>

      <span className="hidden items-center gap-1.5 sm:flex">
        <span className="text-muted-foreground/50">engine</span>
        <span className="text-foreground/80">groq · gemini</span>
      </span>

      <span className="ml-auto flex items-center gap-1.5">
        <Kbd>⌘</Kbd>
        <Kbd>K</Kbd>
        <span className="hidden text-muted-foreground/60 sm:inline">
          commands
        </span>
      </span>

      <span className="tabular hidden text-muted-foreground/60 md:inline">
        {clock}
      </span>
    </footer>
  );
}
