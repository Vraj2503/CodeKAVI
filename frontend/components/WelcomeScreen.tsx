"use client";

import { useState, useEffect, type FormEvent, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  ArrowRight,
  MessageSquare,
  LogOut,
  Trash2,
  Terminal,
  Layers,
  Database,
  Activity,
} from "lucide-react";
import { Button } from "./ui/button";
import { Kbd } from "./ui/Kbd";
import ThemeSwitch from "./ui/theme-switch";
import { StatusBar } from "./StatusBar";
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
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    return new Date(dateStr).toLocaleDateString();
  };

  const topLangs = (languages: Record<string, number>) => {
    const sorted = Object.entries(languages)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);
    return sorted.map(([lang]) => lang).join(" · ");
  };

  // Aggregate readouts across every indexed repository.
  const totals = sessions.reduce(
    (acc, s) => {
      acc.messages += s.message_count || 0;
      Object.keys(s.languages || {}).forEach((l) => acc.langs.add(l));
      return acc;
    },
    { messages: 0, langs: new Set<string>() },
  );

  // Show loading spinner while checking auth
  if (authLoading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-signal/25 border-t-signal [animation-duration:0.6s]" />
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

      {/* Full-bleed app shell: header / scrolling console / status line. */}
      <div className="flex h-dvh w-full flex-col overflow-hidden">
        {/* ── Header rail ──────────────────────────────────────────── */}
        <header className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-border bg-card/70 px-4 backdrop-blur-xl">
          <Terminal className="h-4 w-4 text-signal" />
          <span className="font-display text-[15px] text-foreground">
            CODEKAVI
          </span>
          <span
            className="font-mono text-[11px] text-signal/70"
            aria-hidden="true"
          >
            कवि
          </span>

          <span className="ml-3 hidden font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/60 sm:inline">
            codebase intelligence
          </span>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">
              {user.email}
            </span>
            <ThemeSwitch />
            {user.user_metadata?.avatar_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.user_metadata.avatar_url}
                alt={user.user_metadata.full_name || "Your avatar"}
                className="h-6 w-6 border border-border"
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

        {/* ── Console ──────────────────────────────────────────────── */}
        <main className="grid-field flex-1 overflow-y-auto">
          <div className="relative z-10 mx-auto w-full max-w-[1180px] px-5 py-10">
            {/* Masthead — asymmetric. The statement sits left across two
                thirds; the readouts stack right. */}
            <section className="mb-10 grid gap-8 lg:grid-cols-[1.55fr_1fr]">
              <div>
                <div className="eyebrow mb-4 flex items-center gap-2">
                  <span className="h-1.5 w-1.5 bg-signal" />
                  console
                </div>

                <h1 className="font-display text-[clamp(2rem,5.2vw,3.4rem)] text-foreground">
                  READ
                  <br />
                  THE MACHINE
                </h1>

                <p className="mt-5 max-w-md font-sans text-[14px] leading-relaxed text-muted-foreground">
                  Point CodeKavi at a repository. It clones, parses the
                  dependency graph, classifies every file by role and indexes
                  the source for retrieval — then answers in plain language,
                  citing the file each claim came from.
                </p>
              </div>

              {/* Readout stack */}
              <div className="grid grid-cols-3 gap-px border border-border bg-border lg:self-start">
                <Readout
                  icon={<Layers />}
                  label="repos"
                  value={loadingSessions ? "—" : sessions.length}
                  i={0}
                />
                <Readout
                  icon={<MessageSquare />}
                  label="queries"
                  value={loadingSessions ? "—" : totals.messages}
                  i={1}
                />
                <Readout
                  icon={<Database />}
                  label="langs"
                  value={loadingSessions ? "—" : totals.langs.size}
                  i={2}
                />
              </div>
            </section>

            {/* ── Intake ──────────────────────────────────────────────
                The repo field used to live behind a "+ New chat" card that
                opened a modal — two clicks and a layer of chrome in front
                of the one thing this page exists to do. */}
            <section className="relative mb-12 border border-border bg-card/70 backdrop-blur-xl">
              <span className="reg-mark reg-tl" />
              <span className="reg-mark reg-tr" />
              <span className="reg-mark reg-bl" />
              <span className="reg-mark reg-br" />

              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <span className="eyebrow">intake</span>
                <span className="font-mono text-[10.5px] text-muted-foreground/60">
                  github · gitlab · bitbucket
                </span>
              </div>

              <form
                onSubmit={handleSubmit}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
              >
                <span
                  className="hidden select-none font-mono text-[13px] text-signal sm:inline"
                  aria-hidden="true"
                >
                  &gt;
                </span>
                <input
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="github.com/owner/repo"
                  aria-label="Repository URL"
                  autoFocus
                  className={cn(
                    "min-w-0 flex-1 bg-transparent font-mono text-[15px] text-foreground",
                    "placeholder:text-muted-foreground/40",
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
                      ANALYZING
                    </>
                  ) : (
                    <>
                      ANALYZE
                      <ArrowRight />
                    </>
                  )}
                </Button>
              </form>
            </section>

            {/* ── Index ───────────────────────────────────────────── */}
            <section className="pb-6">
              <div className="mb-3 flex items-center gap-3">
                <h2 className="eyebrow">index</h2>
                <hr className="rule-fade flex-1" />
                <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/70">
                  <Activity className="h-3 w-3" />
                  {loadingSessions ? "scanning…" : `${sessions.length} indexed`}
                </span>
              </div>

              {loadingSessions ? (
                <div className="border border-border">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="flex h-12 animate-pulse items-center gap-4 border-b border-border px-3 last:border-b-0"
                      style={{ animationDelay: `${i * 90}ms` }}
                    >
                      <div className="h-3 w-52 bg-muted" />
                      <div className="ml-auto h-3 w-16 bg-muted/60" />
                    </div>
                  ))}
                </div>
              ) : sessions.length === 0 ? (
                <div className="hatch border border-border px-4 py-10 text-center">
                  <p className="font-mono text-[12.5px] text-muted-foreground">
                    no repositories indexed
                  </p>
                  <p className="mt-1.5 font-sans text-[12px] text-muted-foreground/60">
                    Analyze one above to populate the index.
                  </p>
                </div>
              ) : (
                /*
                  A table, not a grid of cards. These rows are ordered by
                  recency and the thing you scan for is the repo name, so
                  they want to be one left-aligned column with the names
                  stacked in the same place — and columns that line up.
                */
                <div className="border border-border">
                  <div className="hidden items-center gap-4 border-b border-border bg-muted/40 px-3 py-1.5 sm:flex">
                    <span className="eyebrow flex-1">repository</span>
                    <span className="eyebrow w-32">stack</span>
                    <span className="eyebrow w-14 text-right">msgs</span>
                    <span className="eyebrow w-14 text-right">age</span>
                    <span className="w-7" />
                  </div>

                  <AnimatePresence initial={false}>
                    {sessions.map((session, i) => (
                      <motion.div
                        key={session.id}
                        layout
                        /* `transform` as a string rather than framer's `y`
                           shorthand: the shorthand animates on the main
                           thread via rAF and drops frames while the list is
                           still fetching. The full string composites. */
                        initial={{ opacity: 0, transform: "translateY(5px)" }}
                        animate={{ opacity: 1, transform: "translateY(0px)" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{
                          duration: 0.2,
                          ease: [0.23, 1, 0.32, 1],
                          delay: Math.min(i * 0.025, 0.2),
                        }}
                        className="overflow-hidden border-b border-border last:border-b-0"
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
                            "group relative flex cursor-pointer items-center gap-4 px-3 py-2.5",
                            "transition-colors duration-100",
                            "[@media(hover:hover)]:hover:bg-signal/[0.07]",
                          )}
                        >
                          {/* Selection marker. Grows via scaleY, not
                              height — height would trigger layout on every
                              frame of the hover. */}
                          <span
                            className={cn(
                              "absolute left-0 top-0 h-full w-[2px] origin-center scale-y-0 bg-signal",
                              "transition-transform duration-150 ease-out",
                              "[@media(hover:hover)]:group-hover:scale-y-100",
                            )}
                            aria-hidden="true"
                          />

                          <p className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground">
                            <span className="text-muted-foreground/55">
                              {session.owner}/
                            </span>
                            {session.repo_name}
                          </p>

                          <span className="hidden w-32 truncate font-sans text-[11.5px] text-muted-foreground/75 sm:block">
                            {topLangs(session.languages) || "—"}
                          </span>
                          <span className="tabular hidden w-14 text-right text-[11.5px] text-muted-foreground sm:block">
                            {session.message_count || 0}
                          </span>
                          <span className="tabular hidden w-14 text-right text-[11.5px] text-muted-foreground/70 sm:block">
                            {timeAgo(session.updated_at)}
                          </span>

                          <button
                            onClick={(e) =>
                              handleDeleteSession(session.id, e)
                            }
                            className={cn(
                              "w-7 shrink-0 p-1.5 text-muted-foreground/50",
                              "opacity-0 transition-all duration-100",
                              "[@media(hover:hover)]:hover:text-crit",
                              "focus-visible:opacity-100 group-hover:opacity-100",
                            )}
                            title={`Delete ${session.owner}/${session.repo_name}`}
                            aria-label={`Delete ${session.owner}/${session.repo_name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}

              <p className="mt-3 flex items-center gap-1.5 font-sans text-[11.5px] text-muted-foreground/60">
                Press <Kbd>⌘</Kbd>
                <Kbd>K</Kbd> to jump to any repository or view.
              </p>
            </section>
          </div>
        </main>

        <StatusBar />
      </div>
    </>
  );
}

/** A gauge cell in the readout stack. */
function Readout({
  icon,
  label,
  value,
  i,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  i: number;
}) {
  return (
    <div
      className="wipe-in bg-card px-3 py-3.5"
      style={{ "--i": i } as CSSProperties}
    >
      <div className="mb-2 flex items-center gap-1.5 text-muted-foreground/60 [&_svg]:h-3 [&_svg]:w-3">
        {icon}
        <span className="eyebrow">{label}</span>
      </div>
      <p className="readout text-[26px] text-foreground">{value}</p>
    </div>
  );
}
