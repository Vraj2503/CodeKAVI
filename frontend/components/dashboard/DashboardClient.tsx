"use client";

/**
 * The dashboard.
 *
 * Same world as the landing page — deep teal ink, bone text, clay accent,
 * Bricolage over Hanken over JetBrains Mono, pill controls, the window panel —
 * at working density rather than marketing scale. What carries over is the
 * palette, the faces, the radii and the two signature objects: the floating
 * pill header and the mono-topped panel.
 *
 * Four things a returning user needs, in the order they need them: who they
 * are, a field to point at the next repository, what they have already read,
 * and what their account allows. Profile and the field sit above the fold
 * because they are the only things here that start work.
 *
 * Each section owns its own load and its own failure. A history query having a
 * bad minute must not take the plan card with it, which is why there are two
 * independent error slots rather than one page-level one.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { AnalysisProgress } from "@/components/AnalysisProgress";
import { useAuth } from "@/lib/auth-context";
import {
  getSessionsStrict,
  persistAnalyzedRepo,
  type Session,
} from "@/lib/sessions";
import { describeFailure } from "@/lib/errors";
import { normalizeRepoUrl } from "@/lib/repoUrl";
import { validateRepoUrl } from "@/lib/validation";
import { useSessionVerification } from "@/hooks/useSessionVerification";
import type { AnalyzeResponse } from "@/lib/api";

import { AnalyzeRepoField } from "./AnalyzeRepoField";
import { BrandMark } from "./Brand";
import { ErrorBoundary } from "./ErrorBoundary";
import { RepositoryHistory } from "./RepositoryHistory";
import { SubscriptionSection } from "./SubscriptionSection";
import { UserProfileSection } from "./UserProfileSection";
import "./dashboard.css";

interface DashboardClientProps {
  userId: string;
  userEmail: string;
  userAvatarUrl: string | null;
  userFullName: string | null;
  isFirstTime: boolean;
  /** `?analyze=owner/repo` — handed over by the landing page. */
  initialAnalyzeUrl?: string | null;
}

/**
 * The backend's failure text reaches the field only through this. Requirement
 * 5.9 asks for one sentence when a repository cannot be read; anything else is
 * the server's own explanation, which is more useful than a guess.
 */
function describeAnalysisError(message: string): string {
  if (/not found|404|could not be found|does not exist/i.test(message)) {
    return "That repository could not be found or accessed. Check the URL and that the repository is public.";
  }
  return message;
}

export function DashboardClient({
  userEmail,
  userAvatarUrl,
  userFullName,
  isFirstTime,
  initialAnalyzeUrl,
}: DashboardClientProps) {
  const router = useRouter();
  const { signOut } = useAuth();

  useSessionVerification();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [showOnboarding, setShowOnboarding] = useState(isFirstTime);

  /*
   * A URL handed over from the landing page starts its analysis on arrival
   * rather than filling the field and waiting for a second click: the person
   * already pressed Analyze there. Resolved through `useState`'s initialiser so
   * it cannot re-fire on every render.
   */
  const [analysisUrl, setAnalysisUrl] = useState<string | null>(() => {
    if (!initialAnalyzeUrl) return null;
    const result = validateRepoUrl(initialAnalyzeUrl);
    return result.valid ? normalizeRepoUrl(result.normalized) : null;
  });
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Reloads on a counter so the retry button and the first load share one path.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getSessionsStrict()
      .then((rows) => {
        if (cancelled) return;
        setSessions(rows);
        setSessionsError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // The raw error is for the console. What reaches the screen is the
        // app's own taxonomy, so a database message never becomes the copy a
        // reader has to interpret.
        console.error("Repository history failed:", err);
        setSessionsError(describeFailure(err, "your repository history").body);
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reload]);

  const retrySessions = () => {
    setSessionsLoading(true);
    setSessionsError(null);
    setReload((n) => n + 1);
  };

  const handleAnalyze = (normalizedRepo: string) => {
    setAnalyzeError(null);
    setAnalysisUrl(normalizeRepoUrl(normalizedRepo));
  };

  const handleAnalysisComplete = async (data: AnalyzeResponse) => {
    try {
      // Session row plus the per-tab pointers `RepoProvider` hydrates from.
      await persistAnalyzedRepo(data);
      router.push(`/repo/${data.repo_id}/graph`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save this analysis";
      toast.error(message);
      setAnalyzeError(message);
      setAnalysisUrl(null);
    }
  };

  const handleAnalysisError = (message: string) => {
    setAnalysisUrl(null);
    setAnalyzeError(describeAnalysisError(message));
  };

  const handleOpenSession = (session: Session) => {
    // `RepoProvider` reads these to rebuild the repo without re-cloning when
    // the tab has no in-memory record of it.
    sessionStorage.setItem(
      `codekavi-session-meta-${session.repo_id}`,
      JSON.stringify(session),
    );
    sessionStorage.setItem(`codekavi-session-${session.repo_id}`, session.id);
    router.push(`/repo/${session.repo_id}/graph`);
  };

  const handleSignOut = async () => {
    await signOut();
    // Requirement 8.4: out means out to the public page, not to the door.
    router.replace("/");
  };

  return (
    <div className="db">
      {analysisUrl && (
        <AnalysisProgress
          repoUrl={analysisUrl}
          onComplete={handleAnalysisComplete}
          onError={handleAnalysisError}
          onCancel={() => setAnalysisUrl(null)}
        />
      )}

      <header className="db-nav">
        <Link
          href="/dashboard"
          className="db-nav__logo"
          aria-label="CodeKAVI dashboard"
        >
          <BrandMark />
          <span>CodeKAVI</span>
        </Link>

        <span className="db-nav__sep" aria-hidden />
        <span className="db-nav__where">dashboard</span>

        <button type="button" className="db-nav__out" onClick={handleSignOut}>
          <LogOut size={13} aria-hidden />
          Sign out
        </button>
      </header>

      <main className="db-main">
        <section className="db-top db-in">
          <ErrorBoundary subject="Your profile">
            <UserProfileSection
              email={userEmail}
              avatarUrl={userAvatarUrl}
              fullName={userFullName}
            />
          </ErrorBoundary>

          <div className="db-action">
            <h1 className="db-action__lead">Point Rune at a repository.</h1>
            <AnalyzeRepoField
              onAnalyze={handleAnalyze}
              loading={analysisUrl !== null}
              error={analyzeError}
              onDismissError={() => setAnalyzeError(null)}
            />
          </div>
        </section>

        {showOnboarding && (
          <div className="db-note db-in" role="status">
            <Sparkles size={16} aria-hidden style={{ color: "var(--acc)" }} />
            <div className="db-note__body">
              <p className="db-note__t">Welcome to Rune</p>
              <p className="db-note__b">
                Paste a public repository URL above. Its analysis lands in the
                list below.
              </p>
            </div>
            <button
              type="button"
              className="db-note__x"
              onClick={() => setShowOnboarding(false)}
              aria-label="Dismiss welcome"
            >
              <X size={15} aria-hidden />
            </button>
          </div>
        )}

        <div className="db-grid">
          <ErrorBoundary subject="Your repository history">
            <RepositoryHistory
              sessions={sessions}
              loading={sessionsLoading}
              error={sessionsError}
              onRetry={retrySessions}
              onOpen={handleOpenSession}
            />
          </ErrorBoundary>

          <ErrorBoundary subject="Your plan">
            <SubscriptionSection repositoriesAnalyzed={sessions.length} />
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

export default DashboardClient;
