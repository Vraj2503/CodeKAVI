"use client";

/**
 * The one screen every classified failure renders.
 *
 * Before this, each surface improvised: the Graph page printed the backend's
 * `detail` string in red with no action at all (QA-003), and the visualization
 * panel printed `err.message` under a fixed "Generation Failed" heading. Both
 * showed transport facts and neither offered the fix — even for the auth case,
 * where the fix is a single button.
 *
 * The rule: title says what happened, body says why, and the action is whatever
 * `describeFailure` decided actually helps. `none` renders no button rather
 * than a button that cannot work.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertCircle, LogIn, RefreshCw, Search } from "lucide-react";
import type { HumanFailure } from "@/lib/errors";

const BTN =
  "inline-flex items-center gap-2 rounded-xl border border-border bg-muted px-6 py-3 " +
  "text-sm font-semibold transition-colors hover:bg-muted/80 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function FailureState({
  failure,
  onRetry,
}: {
  failure: HumanFailure;
  onRetry?: () => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams().toString();

  // Come back to exactly this chart after signing in. `/auth/callback` already
  // honours `next`; T17 is what started sending it.
  const next = encodeURIComponent(search ? `${pathname}?${search}` : pathname);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-10 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle size={40} aria-hidden="true" />
      </div>
      <h3 className="mb-3 text-xl font-bold text-foreground">{failure.title}</h3>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        {failure.body}
      </p>

      <div className="mt-8">
        {failure.action === "sign-in" && (
          <Link href={`/login?next=${next}`} className={BTN}>
            <LogIn size={16} aria-hidden="true" />
            Sign in
          </Link>
        )}

        {failure.action === "reanalyze" && (
          <Link href="/" className={BTN}>
            <Search size={16} aria-hidden="true" />
            Analyze it again
          </Link>
        )}

        {failure.action === "retry" && onRetry && (
          <button type="button" onClick={onRetry} className={BTN}>
            <RefreshCw size={16} aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
