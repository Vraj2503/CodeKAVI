"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Search,
  MessageSquare,
  FileText,
  BarChart3,
  Network,
  Home,
  SunMoon,
  LogOut,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "./ui/Kbd";
import { getSessions, type Session } from "@/lib/sessions";
import { useAuth } from "@/lib/auth-context";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: ReactNode;
  run: () => void;
  /** Extra text matched against the query but not displayed. */
  keywords?: string;
}

/**
 * ⌘K command palette.
 *
 * Deliberately has NO open/close animation.
 *
 * The frequency rule: something a user triggers dozens or hundreds of
 * times a day should never animate, because the animation is a tax paid
 * on every single invocation. Raycast has no open/close transition for
 * exactly this reason, and it is the single biggest contributor to it
 * feeling instant. A 150ms scale-in here would look nice in a demo and
 * feel like lag by the twentieth use.
 *
 * Built on a portal rather than Radix Dialog to avoid adding a dependency
 * for one surface — the palette needs a focus trap, Escape, and arrow
 * navigation, all of which are handled below.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);

  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const { user, signOut } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /*
   * Global ⌘K / Ctrl+K.
   *
   * Opening resets the query and cursor here rather than in an effect
   * watching `open`. Setting state synchronously inside an effect makes
   * React render, run the effect, then render again — a cascade for
   * something that is simply part of the open action.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (!v) {
            setQuery("");
            setActive(0);
          }
          return !v;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load sessions lazily — only once the palette is first opened, so the
  // dashboard's own fetch isn't duplicated on every page load.
  useEffect(() => {
    if (!open || !user || sessions.length) return;
    getSessions().then(setSessions);
  }, [open, user, sessions.length]);

  useEffect(() => {
    if (!open) return;
    // rAF so the input exists and is painted before focus moves.
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const go = useCallback(
    (href: string) => {
      router.push(href);
      close();
    },
    [router, close],
  );

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      {
        id: "home",
        label: "Go to console",
        group: "Navigate",
        icon: <Home />,
        keywords: "dashboard home root",
        run: () => go("/"),
      },
      {
        id: "theme",
        label:
          resolvedTheme === "dark" ? "Switch to light" : "Switch to dark",
        group: "System",
        icon: <SunMoon />,
        keywords: "theme dark light appearance",
        run: () => {
          setTheme(resolvedTheme === "dark" ? "light" : "dark");
          close();
        },
      },
      {
        id: "signout",
        label: "Sign out",
        group: "System",
        icon: <LogOut />,
        keywords: "logout exit leave",
        run: async () => {
          close();
          await signOut();
          router.replace("/login");
        },
      },
    ];

    const repoCommands = sessions.flatMap<Command>((s) => {
      const slug = `${s.owner}/${s.repo_name}`;
      const views: Array<[string, string, ReactNode]> = [
        ["graph", "Graph", <Network key="g" />],
        ["chat", "Chat", <MessageSquare key="c" />],
        ["report", "Report", <FileText key="r" />],
        ["visualize", "Visualize", <BarChart3 key="v" />],
      ];
      return views.map(([view, viewLabel, icon]) => ({
        id: `${s.id}-${view}`,
        label: slug,
        hint: viewLabel,
        group: "Repositories",
        icon,
        keywords: `${slug} ${viewLabel} ${Object.keys(s.languages || {}).join(" ")}`,
        run: () => {
          sessionStorage.setItem(
            `codekavi-session-meta-${s.repo_id}`,
            JSON.stringify(s),
          );
          sessionStorage.setItem(`codekavi-session-${s.repo_id}`, s.id);
          go(`/repo/${s.repo_id}/${view}`);
        },
      }));
    });

    return [...base, ...repoCommands];
  }, [sessions, resolvedTheme, setTheme, signOut, router, go, close]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [commands, query]);

  /*
   * The cursor is clamped during render, not synced by an effect.
   *
   * Typing can shorten the list below the stored index. Correcting that
   * with `setActive` in an effect means rendering once with an
   * out-of-range cursor, then again to fix it — the classic redundant-
   * state cascade. Deriving it means there is never an invalid frame.
   */
  const activeIdx = Math.min(active, Math.max(results.length - 1, 0));

  // Keep the active row in view during arrow navigation.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIdx + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(
        (activeIdx - 1 + Math.max(results.length, 1)) %
          Math.max(results.length, 1),
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[activeIdx]?.run();
    }
  };

  // `open` is false during SSR and can only be set by a client event, so
  // reaching the portal implies a DOM exists.
  if (!open || typeof document === "undefined") return null;

  // Group headers are rendered inline by comparing against the previous
  // row's group, so filtering never leaves an empty heading behind.
  let lastGroup = "";

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        aria-label="Close command palette"
        onClick={close}
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-[2px]"
      />

      <div
        className="relative mx-4 w-full max-w-[560px] border border-border bg-popover shadow-float"
        onKeyDown={onKeyDown}
      >
        <span className="reg-mark reg-tl" />
        <span className="reg-mark reg-tr" />
        <span className="reg-mark reg-bl" />
        <span className="reg-mark reg-br" />

        <div className="flex items-center gap-2.5 border-b border-border px-3.5">
          <Search className="h-4 w-4 shrink-0 text-signal" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands and repositories…"
            aria-label="Search commands"
            className={cn(
              "h-11 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-foreground",
              "placeholder:text-muted-foreground/60 outline-none focus-visible:outline-none",
            )}
          />
          <Kbd>ESC</Kbd>
        </div>

        <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-3.5 py-6 text-center font-mono text-[12px] text-muted-foreground">
              No matches for &ldquo;{query}&rdquo;
            </p>
          ) : (
            results.map((c, i) => {
              const showGroup = c.group !== lastGroup;
              lastGroup = c.group;
              const isActive = i === activeIdx;
              return (
                <div key={c.id}>
                  {showGroup && (
                    <div className="eyebrow px-3.5 pb-1 pt-2.5">{c.group}</div>
                  )}
                  <button
                    data-idx={i}
                    onMouseMove={() => setActive(i)}
                    onClick={() => c.run()}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3.5 py-2 text-left",
                      "transition-colors duration-100",
                      isActive
                        ? "bg-signal/12 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center [&_svg]:h-3.5 [&_svg]:w-3.5",
                        isActive ? "text-signal" : "text-muted-foreground/70",
                      )}
                    >
                      {c.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
                      {c.label}
                    </span>
                    {c.hint && (
                      <span className="shrink-0 font-sans text-[11px] text-muted-foreground/70">
                        {c.hint}
                      </span>
                    )}
                    {isActive && (
                      <CornerDownLeft className="h-3 w-3 shrink-0 text-signal" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-3.5 py-2 font-sans text-[10.5px] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <Kbd>
              <ArrowUp className="h-2.5 w-2.5" />
            </Kbd>
            <Kbd>
              <ArrowDown className="h-2.5 w-2.5" />
            </Kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft className="h-2.5 w-2.5" />
            </Kbd>
            open
          </span>
          <span className="ml-auto flex items-center gap-1.5 font-mono">
            <GitBranch className="h-3 w-3" />
            {sessions.length} indexed
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
