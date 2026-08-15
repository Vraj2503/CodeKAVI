"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  ArrowRight,
  MessageSquare,
  Clock,
  LogOut,
  Trash2,
} from "lucide-react";
import SpotlightBackground from "./ui/spotlight-background";
import { Button } from "./ui/button";
import ThemeSwitch from "./ui/theme-switch";
import { AnalysisProgress } from "./AnalysisProgress";
import { cn } from "@/lib/utils";
import { normalizeRepoUrl } from "@/lib/repoUrl";
import { type AnalyzeResponse } from "@/lib/api";
import {
  getSessions,
  deleteSession,
  persistAnalyzedRepo,
  type Session,
} from "@/lib/sessions";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export function WelcomeScreen() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isAnalyzing) return;

    // Show the full-screen progress component instead of navigating immediately
    setProgressUrl(normalizeRepoUrl(url));
    setShowProgress(true);
    setIsAnalyzing(true);
  };

  const handleAnalysisComplete = async (data: AnalyzeResponse) => {
    try {
      // Session row + the per-tab pointers RepoProvider hydrates from. Shared
      // with the re-analyze path in RepoStatePanel so the two cannot drift.
      await persistAnalyzedRepo(data);

      // Navigate to the graph page for this repo
      router.push(`/repo/${data.repo_id}/graph`);
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create session",
      );
      setShowProgress(false);
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

  // Format relative time
  const [now] = useState(() => Date.now());
  const timeAgo = (dateStr: string) => {
    const diff = now - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  // Top languages as a short string
  const topLangs = (languages: Record<string, number>) => {
    const sorted = Object.entries(languages)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);
    return sorted.map(([lang]) => lang).join(" · ");
  };

  // Show loading spinner while checking auth
  if (authLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary [animation-duration:0.6s]" />
      </div>
    );
  }

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  const handleDeleteSession = async (
    sessionId: string,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation(); // prevent card click
    try {
      const success = await deleteSession(sessionId);
      if (success) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        toast.success("Chat deleted successfully");
      } else {
        toast.error("Failed to delete chat");
      }
    } catch {
      toast.error("An error occurred");
    }
  };

  return (
    <>
      {/* Full-screen analysis progress overlay */}
      <AnimatePresence>
        {showProgress && (
          <AnalysisProgress
            repoUrl={progressUrl}
            onComplete={handleAnalysisComplete}
            onError={handleAnalysisError}
            onCancel={handleAnalysisCancel}
          />
        )}
      </AnimatePresence>

      <SpotlightBackground>
        <div className="mx-auto w-full max-w-3xl px-6">
          {/* ── Masthead ─────────────────────────────────────────────
              Left-aligned, like the top of a page rather than the
              centre of a landing page. The account controls sit on the
              same baseline instead of floating in a fixed corner. */}
          <header className="mb-16 flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-2.5">
              <span className="font-display text-[21px] leading-none text-foreground">
                CodeKavi
              </span>
              <span
                className="font-display text-sm leading-none text-muted-foreground/70"
                aria-hidden="true"
              >
                कवि
              </span>
            </div>

            <div className="flex items-center gap-1.5 self-center">
              <ThemeSwitch />
              {user.user_metadata?.avatar_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.user_metadata.avatar_url}
                  alt={user.user_metadata.full_name || "Your avatar"}
                  className="ml-1.5 h-7 w-7 rounded-full ring-1 ring-border"
                  referrerPolicy="no-referrer"
                />
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleSignOut}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut />
              </Button>
            </div>
          </header>

          {/* ── The ask ──────────────────────────────────────────────
              The repo field used to live behind a "+ New chat" card
              that opened a modal — two clicks and a layer of chrome in
              front of the one thing this page exists to do. It is now
              the first interactive element on the page. */}
          <section className="mb-20">
            <h1 className="font-display text-[2.6rem] leading-[1.08] tracking-[-0.025em] text-foreground sm:text-[3.4rem]">
              Read any codebase
              <br />
              <span className="text-muted-foreground/55">
                like it was written for you.
              </span>
            </h1>

            <p className="mt-5 max-w-md font-sans text-[15px] leading-relaxed text-muted-foreground">
              Point CodeKavi at a GitHub repository. Every answer it gives
              is grounded in the actual source, and cites the file it came
              from.
            </p>

            <form onSubmit={handleSubmit} className="mt-9">
              {/*
                No fixed `github.com/` prefix in front of this field.
                It made the typed value a bare `owner/repo`, which reaches
                the backend with no hostname and comes back as
                "Unsupported repository host" — and it hid the fact that
                GitLab and Bitbucket are supported too. `normalizeRepoUrl`
                now accepts every reasonable form instead.
              */}
              <div
                className={cn(
                  "group flex items-center gap-2 rounded-xl border border-border bg-card/60 p-1.5 pl-4",
                  "shadow-raise backdrop-blur-xl",
                  "transition-[border-color,box-shadow] duration-200 ease-swift",
                  "focus-within:border-primary/50 focus-within:shadow-lift",
                )}
              >
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="github.com/owner/repo"
                  aria-label="Repository URL"
                  autoFocus
                  className={cn(
                    "min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground",
                    "placeholder:text-muted-foreground/45",
                    "outline-none focus-visible:outline-none",
                  )}
                />
                <Button
                  type="submit"
                  disabled={!url.trim() || isAnalyzing}
                  className="shrink-0"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Analyzing
                    </>
                  ) : (
                    <>
                      Analyze
                      <ArrowRight />
                    </>
                  )}
                </Button>
              </div>
            </form>
          </section>

          {/*
            The three "Chat with Code / AI Insights / Source Citations"
            feature cards that used to sit here were marketing copy on a
            page you can only reach by signing in. Whoever is reading it
            has already bought the product; the space now goes to their
            actual work.
          */}

          {/* ── Recent ───────────────────────────────────────────── */}
          <section className="pb-8">
            <div className="mb-5 flex items-center gap-4">
              <h2 className="eyebrow">Recent</h2>
              <hr className="rule-fade flex-1" />
              {!loadingSessions && sessions.length > 0 && (
                <span className="tabular text-[11px] text-muted-foreground/70">
                  {sessions.length}
                </span>
              )}
            </div>

            {loadingSessions ? (
              <div className="space-y-px">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex h-[58px] animate-pulse items-center gap-4 px-1"
                    style={{ animationDelay: `${i * 90}ms` }}
                  >
                    <div className="h-3.5 w-48 rounded bg-muted" />
                    <div className="h-3 w-24 rounded bg-muted/60" />
                  </div>
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <p className="py-8 font-sans text-sm text-muted-foreground/70">
                Nothing yet — analyze a repository above and it will show
                up here.
              </p>
            ) : (
              /*
                A list, not a grid of 160px cards. These rows are ordered
                by recency and the thing you scan for is the repo name,
                so they want to be a single left-aligned column with the
                names stacked in one place. The dividing hairlines do the
                separating that eight rounded borders were doing before.
              */
              <ul className="-mx-3">
                <AnimatePresence initial={false}>
                  {sessions.map((session, i) => (
                    <motion.li
                      key={session.id}
                      layout
                      /*
                       * `transform` as a string rather than framer's `y`
                       * shorthand: the shorthand animates on the main
                       * thread via rAF and drops frames while the session
                       * list is still fetching. The full transform string
                       * gets composited.
                       *
                       * Exit still animates height — that is a layout
                       * property and normally forbidden, but collapsing
                       * the gap is the whole point of a row removal, and
                       * it only runs on one row at a time.
                       */
                      initial={{ opacity: 0, transform: "translateY(6px)" }}
                      animate={{ opacity: 1, transform: "translateY(0px)" }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{
                        duration: 0.24,
                        ease: [0.23, 1, 0.32, 1],
                        delay: Math.min(i * 0.03, 0.24),
                      }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleResumeSession(session)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleResumeSession(session);
                          }
                        }}
                        className={cn(
                          "group relative flex cursor-pointer items-center gap-4 rounded-lg px-3 py-3.5",
                          "transition-colors duration-150 ease-swift",
                          "hover:bg-accent/50",
                        )}
                      >
                        {/* Accent marker — appears only on the row you
                            are pointing at, so exactly one thing on the
                            page is amber at a time.

                            Grows via scaleY, not height: height would
                            trigger layout on every frame of the hover.
                            Fixed 24px box, scaled from the centre. */}
                        <span
                          className={cn(
                            "absolute left-0 top-1/2 h-6 w-[2px] -translate-y-1/2 rounded-full bg-primary",
                            "origin-center scale-y-0 transition-transform duration-200 ease-out",
                            "[@media(hover:hover)]:group-hover:scale-y-100",
                          )}
                          aria-hidden="true"
                        />

                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-[13.5px] text-foreground">
                            <span className="text-muted-foreground/60">
                              {session.owner}/
                            </span>
                            {session.repo_name}
                          </p>
                          {topLangs(session.languages) && (
                            <p className="mt-1 truncate font-sans text-xs text-muted-foreground/75">
                              {topLangs(session.languages)}
                            </p>
                          )}
                        </div>

                        <div className="hidden shrink-0 items-center gap-4 font-sans text-xs text-muted-foreground/70 sm:flex">
                          <span className="flex items-center gap-1.5">
                            <MessageSquare className="h-3 w-3" />
                            <span className="tabular">
                              {session.message_count || 0}
                            </span>
                          </span>
                          <span className="flex w-16 items-center gap-1.5">
                            <Clock className="h-3 w-3" />
                            {timeAgo(session.updated_at)}
                          </span>
                        </div>

                        <button
                          onClick={(e) => handleDeleteSession(session.id, e)}
                          className={cn(
                            "shrink-0 rounded-md p-1.5 text-muted-foreground/60",
                            "opacity-0 transition-all duration-150",
                            "hover:bg-destructive/10 hover:text-destructive",
                            "focus-visible:opacity-100 group-hover:opacity-100",
                          )}
                          title={`Delete ${session.owner}/${session.repo_name}`}
                          aria-label={`Delete ${session.owner}/${session.repo_name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <hr className="rule-fade mx-3 opacity-60" />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </section>
        </div>
      </SpotlightBackground>
    </>
  );
}
