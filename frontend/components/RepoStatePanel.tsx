"use client";

/**
 * What a repo page shows before — or instead of — its data.
 *
 * Every one of these states used to render the same "Loading repository data…"
 * line, including the ones that were never going to finish loading. A cold tab
 * on a shared or bookmarked link carries no `sessionStorage` metadata, so the
 * provider ran out of branches and left the spinner up permanently (QA-002).
 *
 * The rule here: each terminal reason gets copy that says what happened and one
 * button that fixes it. No state renders a spinner that cannot end.
 */

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LogIn, RefreshCw, WifiOff } from "lucide-react";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { useRepo } from "@/components/RepoProvider";
import { persistAnalyzedRepo } from "@/lib/sessions";
import type { AnalyzeResponse } from "@/lib/api";
import { toast } from "sonner";

/** How long a load may run before we admit it is taking unusually long. */
const SLOW_LOAD_MS = 8000;

export function RepoStatePanel() {
  const { unavailable, retryLoad, isReanalyzing } = useRepo();
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const [reanalyzing, setReanalyzing] = useState(false);

  const repoId = (params?.repoId as string) ?? "";
  // `/repo/<id>/visualize` → come back to the same view once there is data.
  const view = pathname?.split("/")[3] || "graph";

  const handleComplete = async (data: AnalyzeResponse) => {
    try {
      await persistAnalyzedRepo(data);
    } catch (err: unknown) {
      // The analysis itself succeeded; a session row is not worth losing it over.
      console.warn("Failed to persist re-analyzed repo:", err);
    }
    if (data.repo_id === repoId) {
      // Same id, warm cache now — just resolve again.
      setReanalyzing(false);
      retryLoad();
    } else {
      // A fresh clone gets a fresh id, so the URL that failed is now stale.
      // Landing the user back on it would rebuild the dead end immediately.
      router.replace(`/repo/${data.repo_id}/${view}`);
    }
  };

  if (reanalyzing && unavailable?.githubUrl) {
    return (
      <AnalysisProgress
        repoUrl={unavailable.githubUrl}
        onComplete={handleComplete}
        onError={(msg) => {
          toast.error(msg);
          setReanalyzing(false);
        }}
        onCancel={() => setReanalyzing(false)}
      />
    );
  }

  if (!unavailable) return <ResolvingState reanalyzing={isReanalyzing} />;

  const repoLabel = unavailable.repoLabel;

  if (unavailable.reason === "unauthenticated") {
    const next = encodeURIComponent(pathname || "/");
    return (
      <StatePanel
        title="Sign in to open this analysis"
        body={
          repoLabel
            ? `This link points to the analysis of ${repoLabel} in a Rune account. Sign in to open it.`
            : "This link points to an analysis in a Rune account. Sign in to open it."
        }
        primary={
          <Link href={`/login?next=${next}`} className={PRIMARY_BUTTON}>
            <LogIn size={16} />
            Sign in
          </Link>
        }
      />
    );
  }

  if (unavailable.reason === "unreachable") {
    return (
      <StatePanel
        title="Can't reach the analysis service"
        body="The server didn't respond in time. Check your connection, then try again."
        primary={
          <button onClick={retryLoad} className={PRIMARY_BUTTON}>
            <WifiOff size={16} />
            Try again
          </button>
        }
      />
    );
  }

  // Expired — the cache chain has nothing left. Re-analysis is the only fix,
  // and it needs the repository URL, which is why the provider goes looking
  // for the session behind an opaque repo id before landing here.
  if (unavailable.githubUrl) {
    return (
      <StatePanel
        title="This analysis has expired"
        body={`Cached analyses are cleared after a period of inactivity. Re-analyze ${
          repoLabel ?? "this repository"
        } to bring it back.`}
        primary={
          <button onClick={() => setReanalyzing(true)} className={PRIMARY_BUTTON}>
            <RefreshCw size={16} />
            Re-analyze repository
          </button>
        }
      />
    );
  }

  return (
    <StatePanel
      title="This analysis isn't available"
      body="It has expired, and this account has no record of the repository it came from. Analyze the repository again from the dashboard to get a fresh link."
    />
  );
}

/**
 * The honest spinner: it still says "loading", but it admits when the wait has
 * stopped being normal. Every path behind it terminates within the restore
 * timeout, so this can no longer be the last thing a user sees.
 */
function ResolvingState({ reanalyzing }: { reanalyzing: boolean }) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/25 border-t-foreground" />
      {/* When the backend answers 202 we know exactly what the wait is for,
          so say it. A generic "loading" during a two-minute rebuild is what
          made this look like a hang. */}
      <p className="text-[13px]">
        {reanalyzing
          ? "Rebuilding this analysis…"
          : "Loading repository data…"}
      </p>
      {reanalyzing ? (
        <p className="max-w-xs text-center text-[12px] text-muted-foreground/70">
          The cached analysis expired, so the server is re-reading the
          repository from source. This can take a minute on a large codebase.
        </p>
      ) : (
        slow && (
          <p className="text-[12px] text-muted-foreground/70">
            Still working — this is taking longer than usual.
          </p>
        )
      )}
    </div>
  );
}

const PRIMARY_BUTTON =
  "press inline-flex items-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-[13px] font-medium text-background shadow-pop transition-colors duration-150 ease-out hover:bg-foreground/88";

function StatePanel({
  title,
  body,
  primary,
}: {
  title: string;
  body: string;
  primary?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <span className="eyebrow mb-4">Repository</span>
      <h2 className="mb-2 max-w-md text-xl font-semibold tracking-[-0.02em] text-foreground">
        {title}
      </h2>
      <p className="mb-7 max-w-md text-[14px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {primary}
        <Link
          href="/"
          className="press inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-[13px] font-medium text-foreground transition-colors duration-150 ease-out hover:bg-accent"
        >
          <ArrowLeft size={16} />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
