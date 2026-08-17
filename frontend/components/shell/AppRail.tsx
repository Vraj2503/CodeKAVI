"use client";

/**
 * The rail — the app's one fixed piece of furniture.
 *
 * Navigation used to live in a 2×2 grid of text tabs inside the same panel
 * that held the repo form, the stats and the file tree, so "where am I" and
 * "what is this repo" competed for the same 320px. The rail separates them:
 * 56px that only ever answers "where am I", always in the same place, never
 * scrolling away.
 *
 * The active marker is a single absolutely-positioned bar translated to the
 * live item rather than one bar per item cross-fading. It is one compositor
 * property, it survives interruption mid-travel, and it reads as the marker
 * *moving* — which is the actual mental model of switching views.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  MessagesSquare,
  FileText,
  ChartScatter,
  Waypoints,
  Plus,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import ThemeSwitch from "@/components/ui/theme-switch";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/Tooltip";

/** Item box (40px) + gap (8px). The marker's travel is a multiple of this. */
const ITEM_STRIDE = 48;

export function AppRail({ repoId }: { repoId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const views = [
    { key: "chat", label: "Chat", icon: MessagesSquare },
    { key: "report", label: "Report", icon: FileText },
    { key: "visualize", label: "Visualize", icon: ChartScatter },
    { key: "graph", label: "Graph", icon: Waypoints },
  ] as const;

  const activeIndex = Math.max(
    0,
    views.findIndex((v) => pathname.includes(`/${v.key}`)),
  );

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={300}>
      <nav
        aria-label="Views"
        className="z-30 flex w-14 flex-shrink-0 flex-col items-center border-r border-border bg-card/60 py-3"
      >
        <Link
          href="/"
          aria-label="Rune home"
          className="press mb-4 grid h-9 w-9 place-items-center rounded-md border border-border bg-background"
        >
          <Mark />
        </Link>

        <div className="relative flex flex-col gap-2">
          {/* The marker. One element, translated. */}
          <span
            aria-hidden
            className="absolute left-0 h-10 w-[2px] rounded-full bg-signal transition-transform duration-[220ms] ease-out"
            style={{ transform: `translateY(${activeIndex * ITEM_STRIDE}px)` }}
          />

          {views.map((view) => {
            const isActive = pathname.includes(`/${view.key}`);
            return (
              <Tooltip key={view.key}>
                <TooltipTrigger asChild>
                  <Link
                    href={`/repo/${repoId}/${view.key}`}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "press grid h-10 w-10 place-items-center rounded-md",
                      "transition-colors duration-150 ease-out",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )}
                  >
                    <view.icon size={18} strokeWidth={1.75} />
                    <span className="sr-only">{view.label}</span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{view.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/"
                className="press grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent/60 hover:text-foreground"
              >
                <Plus size={18} strokeWidth={1.75} />
                <span className="sr-only">Analyze another repository</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">New analysis</TooltipContent>
          </Tooltip>

          <ThemeSwitch />

          {user?.user_metadata?.avatar_url && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={user.user_metadata.avatar_url}
              alt={user.user_metadata.full_name || "Account"}
              referrerPolicy="no-referrer"
              className="h-7 w-7 rounded-full border border-border"
            />
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleSignOut}
                className="press grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent/60 hover:text-foreground"
              >
                <LogOut size={16} strokeWidth={1.75} />
                <span className="sr-only">Sign out</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </TooltipProvider>
  );
}

/**
 * The wordmark glyph: a bracket around a caret — "something inside the code".
 * Drawn rather than imported so it inherits `currentColor` in both themes.
 */
export function Mark({ className }: { className?: string }) {
  /*
   * ᚱ — Raidō, the rune for "journey".
   *
   * Drawn as a path rather than set as the character: the glyph has to hold
   * at 18px in a rail, and no shipped font renders Elder Futhark with stroke
   * weights that match the UI. Drawing it also lets the descending leg carry
   * the signal colour, so the mark states the product's one idea — a path
   * traced through unfamiliar ground — instead of being a decorative letter.
   */
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className={cn("h-[18px] w-[18px] text-foreground", className)}
    >
      {/* Stave */}
      <path
        d="M5.5 3.4v13.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      {/* Bow */}
      <path
        d="M5.5 3.4h5.2a3.3 3.3 0 0 1 0 6.6H5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Leg — the path travelled */}
      <path
        d="m9.1 10 5.4 6.6"
        stroke="hsl(var(--signal))"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
