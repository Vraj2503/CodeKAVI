"use client";

/**
 * The dashboard.
 *
 * The old one buried its primary action — analyzing a repository — behind a
 * dashed "+ Create new chat" tile that opened a modal containing the only
 * input on the page. Three clicks and a layer of chrome to do the one thing
 * the product does. Here the input *is* the page: it sits under the headline,
 * autofocused, with the recent analyses as a dense index below it.
 */

import { useState, useEffect, useMemo, useRef, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Clock,
  CornerDownLeft,
  Loader2,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { AnalysisProgress } from "./AnalysisProgress";
import { Mark } from "./shell/AppRail";
import { normalizeRepoUrl } from "@/lib/repoUrl";
import Link from "next/link";
import { FigureCanvas } from "./report/viz/FigureCanvas";
import { addLayer, emptyModel } from "@/lib/viz/figureModel";
import { paletteById, SURFACES } from "@/lib/viz/palettes";
import { styleById } from "@/lib/viz/styles";
import ThemeSwitch from "./ui/theme-switch";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { type AnalyzeResponse } from "@/lib/api";
import {
  getSessions,
  deleteSession,
  persistAnalyzedRepo,
  type Session,
} from "@/lib/sessions";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

const EXAMPLES = ["pallets/flask", "vercel/swr", "tiangolo/fastapi"];

const CAPABILITIES = [
  {
    title: "Grounded answers",
    body: "Every reply is retrieved from the indexed source before it is written.",
  },
  {
    title: "Architecture at a glance",
    body: "Dependency, complexity and data-flow charts built from the real graph.",
  },
  {
    title: "Traceable claims",
    body: "Answers carry the file paths and line ranges they came from.",
  },
];

export function WelcomeScreen() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [showProgress, setShowProgress] = useState(false);
  const [progressUrl, setProgressUrl] = useState("");

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      getSessions().then((data) => {
        setSessions(data);
        setLoadingSessions(false);
      });
    }
  }, [user]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isAnalyzing) return;

    /*
     * Normalised, not `url.trim()`. The field renders `github.com/` as a
     * separate decorative span, so the submitted value is a bare
     * `owner/repo` — which reaches the backend with no hostname and comes
     * back as "Unsupported repository host", an error that reads as though
     * the host were wrong rather than missing. This also re-enables the
     * GitLab and Bitbucket support the backend already has.
     */
    setProgressUrl(normalizeRepoUrl(url));
    setShowProgress(true);
    setIsAnalyzing(true);
  };

  const handleAnalysisComplete = async (data: AnalyzeResponse) => {
    try {
      // Session row + the per-tab pointers RepoProvider hydrates from. Shared
      // with the re-analyze path in RepoStatePanel so the two cannot drift.
      await persistAnalyzedRepo(data);
      router.push(`/repo/${data.repo_id}/graph`);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create session",
      );
      setShowProgress(false);
      setIsAnalyzing(false);
    }
  };

  const handleAnalysisError = (errorMsg: string) => {
    toast.error(errorMsg);
    setShowProgress(false);
    setProgressUrl("");
    setIsAnalyzing(false);
  };

  const handleAnalysisCancel = () => {
    setShowProgress(false);
    setProgressUrl("");
    setIsAnalyzing(false);
  };

  const handleResumeSession = (session: Session) => {
    // Store session metadata so RepoProvider can build a partial repoData
    sessionStorage.setItem(
      `codekavi-session-meta-${session.repo_id}`,
      JSON.stringify(session),
    );
    sessionStorage.setItem(`codekavi-session-${session.repo_id}`, session.id);
    router.push(`/repo/${session.repo_id}/graph`);
  };

  const handleDeleteSession = async (
    sessionId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    try {
      const success = await deleteSession(sessionId);
      if (success) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        toast.success("Analysis removed");
      } else {
        toast.error("Failed to remove analysis");
      }
    } catch {
      toast.error("An error occurred");
    }
  };

  // Frozen at first render so relative times cannot differ between the server
  // and client passes.
  const [now] = useState(() => Date.now());
  const timeAgo = (dateStr: string) => {
    const diff = now - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  const topLangs = (languages: Record<string, number>) =>
    Object.entries(languages)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([lang]) => lang)
      .join(" · ");

  if (authLoading || !user) {
    return (
      <div className="grid h-dvh w-screen place-items-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      {showProgress && (
        <AnalysisProgress
          repoUrl={progressUrl}
          onComplete={handleAnalysisComplete}
          onError={handleAnalysisError}
          onCancel={handleAnalysisCancel}
        />
      )}

      <div className="canvas min-h-dvh">
        {/* ── Header ── */}
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-6">
            {/*
              A lockup, not three items on one gap.
              · Mark and wordmark sit in a tight pair (gap-2) so they read as
                one object; the tagline is pushed out and separated by a rule
                so it reads as metadata rather than part of the name.
              · The text pair is baseline-aligned. `items-center` was centring
                each span by its own BOX, and uppercase mono has no descenders
                — its ink sits high in the box, so box-centring floated it
                above the wordmark. Baselines are what the eye actually reads.
            */}
            <Link
              href="/"
              className="flex items-center gap-2"
              aria-label="Rune home"
            >
              <Mark />
              <span className="text-[17px] font-semibold leading-none tracking-[-0.025em] text-foreground">
                Rune
              </span>
            </Link>

            <span aria-hidden className="hidden h-4 w-px bg-border sm:block" />

            <span className="eyebrow hidden leading-none sm:inline">
              codebase intelligence
            </span>

            <div className="ml-auto flex items-center gap-2">
              <ThemeSwitch />
              {user.user_metadata?.avatar_url && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={user.user_metadata.avatar_url}
                  alt={user.user_metadata.full_name || "Account"}
                  referrerPolicy="no-referrer"
                  className="h-7 w-7 rounded-full border border-border"
                />
              )}
              <button
                onClick={async () => {
                  await signOut();
                  router.replace("/login");
                }}
                className="press rounded-md px-2 py-1 text-[13px] text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6">
          {/* ── Hero ── */}
          <section className="grid gap-10 py-16 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:py-24">
            <div className="animate-rise">
              <h1 className="max-w-xl text-[clamp(2.25rem,5vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
                Read any repository
                <br />
                <span className="text-muted-foreground">
                  like you wrote it.
                </span>
              </h1>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                Point Rune at a GitHub URL. It clones, parses and indexes the
                source, then answers questions with the files it read.
              </p>

              <Pipeline />
            </div>

            <dl className="hidden gap-6 md:flex">
              {[
                ["14", "file roles"],
                ["6", "chart types"],
                ["3", "cache tiers"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="tnum font-mono text-2xl leading-none">
                    {value}
                  </dt>
                  <dd className="eyebrow mt-2">{label}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* ── The one input ── */}
          <section className="animate-rise" style={{ animationDelay: "60ms" }}>
            <form onSubmit={handleSubmit}>
              <label htmlFor="repo-url" className="sr-only">
                GitHub repository URL
              </label>
              <div
                className={cn(
                  "group flex items-center gap-2 rounded-lg border border-border bg-card px-3",
                  "shadow-pop transition-[border-color,box-shadow] duration-200 ease-out",
                  "focus-within:border-signal/60 focus-within:ring-4 focus-within:ring-signal/10",
                )}
              >
                <span className="hidden select-none font-mono text-[13px] text-muted-foreground sm:inline">
                  github.com/
                </span>
                <input
                  id="repo-url"
                  ref={inputRef}
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="user/repository"
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus
                  className="h-14 min-w-0 flex-1 bg-transparent font-mono text-[15px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!url.trim() || isAnalyzing}
                  className={cn(
                    "press my-2 flex h-10 items-center gap-2 rounded-md px-4",
                    "bg-foreground text-[13px] font-medium text-background",
                    "transition-colors duration-150 ease-out hover:bg-foreground/88",
                    "disabled:opacity-30",
                  )}
                >
                  {isAnalyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Analyze
                      <CornerDownLeft className="h-3.5 w-3.5 opacity-60" />
                    </>
                  )}
                </button>
              </div>
            </form>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="eyebrow">try</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setUrl(example);
                    inputRef.current?.focus();
                  }}
                  className="press rounded-full border border-border bg-card/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors duration-150 ease-out hover:border-foreground/25 hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>

            <StudioPreview />
          </section>

          {/* ── Recent ── */}
          <section className="py-16">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="eyebrow">Recent analyses</h2>
              {!loadingSessions && sessions.length > 0 && (
                <span className="tnum font-mono text-[11px] text-muted-foreground">
                  {sessions.length}
                </span>
              )}
            </div>

            <div className="border-t border-border">
              {loadingSessions ? (
                [0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex h-[52px] items-center gap-4 border-b border-border px-1"
                  >
                    <span className="h-2.5 w-40 animate-pulse rounded bg-muted" />
                    <span className="h-2.5 w-24 animate-pulse rounded bg-muted" />
                  </div>
                ))
              ) : sessions.length === 0 ? (
                <p className="border-b border-border py-8 text-center text-[13px] text-muted-foreground">
                  Nothing analyzed yet — paste a repository above to start.
                </p>
              ) : (
                sessions.map((session, i) => (
                  <div
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleResumeSession(session)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleResumeSession(session);
                      }
                    }}
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                    className={cn(
                      "group animate-rise flex cursor-pointer items-center gap-4 border-b border-border px-1 py-3.5",
                      "transition-colors duration-150 ease-out hover:bg-accent/40",
                    )}
                  >
                    <span className="tnum hidden w-6 font-mono text-[11px] text-muted-foreground/70 sm:block">
                      {String(i + 1).padStart(2, "0")}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[13px]">
                        <span className="text-muted-foreground">
                          {session.owner}/
                        </span>
                        <span className="text-foreground">
                          {session.repo_name}
                        </span>
                      </span>
                      {topLangs(session.languages) && (
                        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                          {topLangs(session.languages)}
                        </span>
                      )}
                    </span>

                    <span className="hidden items-center gap-1.5 text-[12px] text-muted-foreground sm:flex">
                      <MessageSquare className="h-3 w-3" />
                      <span className="tnum">{session.message_count || 0}</span>
                    </span>

                    <span className="hidden w-20 items-center gap-1.5 text-[12px] text-muted-foreground md:flex">
                      <Clock className="h-3 w-3" />
                      {timeAgo(session.updated_at)}
                    </span>

                    <button
                      onClick={(e) => handleDeleteSession(session.id, e)}
                      aria-label={`Remove ${session.owner}/${session.repo_name}`}
                      className={cn(
                        "press grid h-7 w-7 place-items-center rounded-md text-muted-foreground",
                        "opacity-0 transition-[opacity,color,background-color] duration-150 ease-out",
                        "hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100",
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>

                    <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40 transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>
                ))
              )}
            </div>
          </section>

          {/* ── What it does ── */}
          <section className="grid gap-px border-t border-border bg-border pb-px sm:grid-cols-3">
            {CAPABILITIES.map((capability, i) => (
              <div key={capability.title} className="bg-background px-1 py-6">
                <span className="tnum font-mono text-[11px] text-signal">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-2 text-[14px] font-medium">
                  {capability.title}
                </h3>
                <p className="mt-1.5 max-w-[26ch] text-[13px] leading-relaxed text-muted-foreground">
                  {capability.body}
                </p>
              </div>
            ))}
          </section>

          <footer className="flex items-center justify-between py-8">
            <span className="eyebrow">Rune</span>
            <span className="eyebrow">
              {user.email ?? user.user_metadata?.full_name ?? ""}
            </span>
          </footer>
        </main>
      </div>
    </>
  );
}

/**
 * Secondary-product teaser for the neural network editor.
 *
 * Sized deliberately small. The landing page is for the codebase analyzer;
 * the editor is a different product that happens to live in the same app, so
 * it gets a compact card with a thumbnail — not a full-bleed hero that
 * out-shouts the thing this page exists to sell.
 *
 * The thumbnail is a live `FigureCanvas`, not a screenshot: it is the same
 * renderer the editor and exporter use, so it cannot go stale as the figure
 * engine changes, and it costs no asset pipeline.
 */
function StudioPreview() {
  const model = useMemo(() => {
    let m = emptyModel("Net");
    for (const c of ["embedding", "attention", "dense"]) {
      m = addLayer(m, c).model;
    }
    return m;
  }, []);

  /*
   * The thumbnail's MATERIAL follows the theme, not just its background.
   *
   * Neon cannot simply be handed a white ground: emissive hued edges are the
   * entire idea of that style and they do not register without something
   * dark to glow against. So light mode gets `3d` — flat solids and crisp
   * keylines, the style that reads best on paper and at this size — and dark
   * mode keeps neon.
   *
   * `resolvedTheme` is undefined on the first client render, matching SSR,
   * so reading it directly is hydration-safe and simply corrects on the next
   * frame. That avoids a `mounted` flag, which would mean setting state in an
   * effect purely to paint a decorative thumbnail.
   */
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const style = styleById(isDark ? "neon" : "3d");
  const surface = {
    ...SURFACES[isDark ? "slide" : "paper"],
    ...(style.surface ?? {}),
    // Neutral near-black. Neon's own ground carries a blue cast (hue 218)
    // which read as navy against the app's dark surface rather than black.
    ...(isDark ? { bg: "#0A0A0B" } : {}),
  };

  const THUMB = 200;

  return (
    <Link
      href="/studio"
      className={cn(
        "press group mt-8 flex items-center gap-5 rounded-xl border border-border",
        "bg-card p-4",
        "transition-[border-color] duration-200 ease-out hover:border-signal/50",
      )}
    >
      {/* Hidden on small screens — below ~640px it would crowd the copy it
          exists to illustrate. */}
      <div
        aria-hidden
        className="hidden shrink-0 overflow-hidden rounded-lg sm:block"
        style={{ background: surface.bg, width: THUMB }}
      >
        <div className="pointer-events-none">
          <FigureCanvas
            model={model}
            palette={paletteById("scientific")}
            surface={surface}
            style={style}
            uid="landing-thumb"
            showHeader={false}
            showLegend={false}
            fitWidth={THUMB}
            // Opt out of the anti-runaway floor: at 200px the default 0.45
            // clamp left the figure wider than its frame, so the last block
            // was clipped by `overflow-hidden`.
            minFit={0.05}
          />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium tracking-[-0.01em] text-foreground">
          Try our neural network editor
        </p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
          Draw an architecture by hand and export it for a paper or a deck. No
          repository needed.
        </p>
      </div>

      <ArrowRight
        className={cn(
          "h-4 w-4 flex-shrink-0 text-muted-foreground",
          "transition-transform duration-200 ease-out",
          "group-hover:translate-x-0.5 group-hover:text-signal",
        )}
      />
    </Link>
  );
}

/**
 * The analyzer, shown working — one scene per pipeline stage.
 *
 * The hero sentence claims four things happen. Rather than assert that in
 * prose, each stage gets its own motion: files stream in, edges draw between
 * them, a vector grid fills, an answer types with citations. Four scenes on
 * one 16s timeline, offset by `--s`, which is what keeps them in lockstep
 * with the stage labels without a single JS timer.
 *
 * Everything is type, rules and CSS keyframes — no illustration, no video.
 * It stays true as the pipeline changes, weighs nothing, and the global
 * reduced-motion rule stills it for anyone who asks. The roles and stages
 * shown are the classifier's real vocabulary, not invented labels.
 */
function Pipeline() {
  const STAGES = ["clone", "parse", "index", "answer"];
  // Positions and edges for the parse scene, in the svg's 320×104 viewBox.
  const NODES: Array<[number, number, string]> = [
    [34, 22, "app"],
    [34, 78, "cli"],
    [152, 50, "ctx"],
    [278, 24, "blueprints"],
    [278, 76, "helpers"],
  ];
  const EDGES = [
    "M40 24 L146 48",
    "M40 76 L146 52",
    "M158 48 L272 26",
    "M158 52 L272 74",
  ];

  const FILES = [
    { f: "app.py", r: "entry-point", w: "88%" },
    { f: "blueprints.py", r: "routing", w: "62%" },
    { f: "ctx.py", r: "core-logic", w: "74%" },
    { f: "cli.py", r: "tooling", w: "38%" },
  ];

  return (
    <div
      aria-hidden
      className="mt-8 overflow-hidden rounded-xl border border-border bg-card"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-signal" />
        <span className="eyebrow leading-none">reading</span>
        <span className="font-mono text-[11.5px] leading-none text-muted-foreground">
          pallets/flask
        </span>
      </div>

      {/* Fixed height: the scenes are stacked, so the panel must not resize
          as they swap or the whole page would jump every four seconds. */}
      <div className="relative h-[132px] overflow-hidden px-4">
        {/* 1 · clone — files stream in and are weighed */}
        <div
          className="scene absolute inset-x-4 top-4 space-y-2.5"
          style={{ "--s": 0 } as React.CSSProperties}
        >
          {FILES.map((x, i) => (
            <div
              key={x.f}
              className="clone-row flex items-center gap-3"
              style={{ "--i": i } as React.CSSProperties}
            >
              <span className="w-[104px] shrink-0 truncate font-mono text-[11.5px] text-foreground">
                {x.f}
              </span>
              <span className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="clone-fill block h-full rounded-full bg-signal/70"
                  style={{ width: x.w, "--i": i } as React.CSSProperties}
                />
              </span>
              <span className="w-[74px] shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
                {x.r}
              </span>
            </div>
          ))}
        </div>

        {/* 2 · parse — the dependency graph assembling */}
        <div
          className="scene absolute inset-4"
          style={{ "--s": 1 } as React.CSSProperties}
        >
          <svg
            viewBox="0 0 320 104"
            className="h-full w-full"
            preserveAspectRatio="xMidYMid meet"
          >
            {EDGES.map((d, i) => (
              <g key={i}>
                <path
                  d={d}
                  className="edge-draw"
                  style={{ "--i": i } as React.CSSProperties}
                  fill="none"
                  stroke="hsl(var(--signal))"
                  strokeOpacity="0.7"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                {/* Packet riding the path via `offset-path` — the graph being
                    walked, not just drawn. */}
                <circle
                  r="2.6"
                  className="edge-pulse"
                  style={
                    {
                      "--i": i,
                      offsetPath: `path("${d}")`,
                    } as React.CSSProperties
                  }
                  fill="hsl(var(--signal))"
                />
              </g>
            ))}
            {NODES.map(([cx, cy, label], i) => (
              <g
                key={label as string}
                className="node-pop"
                style={{ "--i": i } as React.CSSProperties}
              >
                <circle
                  cx={cx as number}
                  cy={cy as number}
                  r="6"
                  fill="hsl(var(--card))"
                  stroke="hsl(var(--foreground))"
                  strokeWidth="1.5"
                />
                <text
                  x={cx as number}
                  y={(cy as number) + 17}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono"
                  style={{ fontSize: 8 }}
                >
                  {label as string}
                </text>
              </g>
            ))}
          </svg>
        </div>

        {/* 3 · index — chunks resolving into a vector field */}
        <div
          className="scene absolute inset-x-4 top-6"
          style={{ "--s": 2 } as React.CSSProperties}
        >
          {/*
            FIXED cell size, not `1fr` + aspect-square. Fractional columns
            sized each cell to the pane — ~50px on a wide screen — so four
            rows overflowed the fixed-height panel and collided with the
            caption and the stage row beneath it.
          */}
          <div className="grid grid-cols-[repeat(40,8px)] gap-[3px]">
            {Array.from({ length: 160 }).map((_, i) => {
              // Diagonal wave: delay from (col + row), not flat index. A
              // row-major stagger reads as a progress bar; a diagonal reads
              // as a surface being covered.
              const col = i % 40;
              const row = Math.floor(i / 40);
              return (
                <span
                  key={i}
                  className="cell-fill h-[8px] w-[8px] rounded-[2px] bg-signal"
                  style={{ "--i": col + row * 3 } as React.CSSProperties}
                />
              );
            })}
          </div>
          <p className="mt-3 font-mono text-[10.5px] text-muted-foreground">
            1,284 chunks · 768-dim
          </p>
        </div>

        {/* 4 · answer — a real grounded reply, typed, then cited */}
        <div
          className="scene absolute inset-x-4 top-5"
          style={{ "--s": 3 } as React.CSSProperties}
        >
          <p className="font-mono text-[11px] text-muted-foreground">
            <span className="text-signal">?</span> where are routes registered
          </p>
          {/* Showing an actual answer with a real file:line is the product's
              whole claim. Three grey placeholder bars said nothing. */}
          <p className="answer-type mt-2.5 whitespace-nowrap font-sans text-[13px] leading-relaxed text-foreground">
            Blueprints attach in{" "}
            <span className="font-mono text-[12px]">
              app.register_blueprint
            </span>
            <span className="answer-caret ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] bg-signal" />
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {["src/app.py:412", "src/blueprints.py:88"].map((c, i) => (
              <span
                key={c}
                className="cite-in rounded-full border border-signal/40 bg-signal/10 px-2 py-0.5 font-mono text-[10px] text-signal"
                style={{ "--i": i } as React.CSSProperties}
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 border-t border-border px-4 py-2.5">
        {STAGES.map((stage, i) => (
          <span key={stage} className="flex items-center gap-1">
            {i > 0 && (
              <span className="mx-1 font-mono text-[10px] text-muted-foreground/40">
                →
              </span>
            )}
            <span
              className="stage-lit eyebrow leading-none"
              style={{ "--s": i } as React.CSSProperties}
            >
              {stage}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
