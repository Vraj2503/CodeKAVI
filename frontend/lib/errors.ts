/**
 * Backend failures, translated once, for humans.
 *
 * The Graph page used to render `Missing Authorization header.` in red as its
 * entire state (QA-003), and the visualization panel rendered whatever string
 * `err.message` happened to hold. Both are transport-layer facts. Neither tells
 * a user what happened or what to do, and the auth case — by far the most
 * common — has an obvious action nobody was offering.
 *
 * So failures are classified at the hook boundary and every consumer renders a
 * `HumanFailure`. The raw text survives on `detail` for the console; it never
 * reaches the screen.
 */

/** A non-2xx response. Carries the status, which the message alone loses. */
export class ApiError extends Error {
  readonly status: number;
  /** The backend's own `detail` string. For logs — never for the screen. */
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

/**
 * What the user can actually do about it.
 *
 * `none` exists for failures with no user-side fix — offering a button that
 * cannot work is worse than offering nothing.
 */
export type RecoveryAction = "sign-in" | "retry" | "reanalyze" | "none";

export interface HumanFailure {
  title: string;
  body: string;
  action: RecoveryAction;
  /** Original text, for `console.warn`. Not for rendering. */
  detail: string;
}

/** Our own deadline fired. `AbortSignal.timeout` produces exactly this shape. */
export function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}

/** The caller cancelled — a navigation, a newer request. Never an error state. */
export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function detailOf(err: unknown): string {
  if (err instanceof ApiError) return err.detail;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Map any thrown value to copy a user can act on.
 *
 * `subject` is a noun phrase that completes the sentence — "this graph",
 * "the architecture diagram" — so one taxonomy serves every surface without
 * each one inventing its own wording.
 */
export function describeFailure(
  err: unknown,
  subject = "this view",
): HumanFailure {
  const detail = detailOf(err);

  if (isTimeout(err)) {
    return {
      title: "This is taking too long",
      body: `The server accepted the request but never answered. It may be busy building ${subject} for a large repository.`,
      action: "retry",
      detail,
    };
  }

  // `fetch` rejects with a TypeError when it cannot reach the host at all —
  // DNS, CORS, offline, server down. There is no status to read.
  if (err instanceof TypeError) {
    return {
      title: "Can't reach the server",
      body: "The request never left the building. Check your connection, then try again.",
      action: "retry",
      detail,
    };
  }

  if (err instanceof ApiError) {
    const { status } = err;

    // 202 is not a failure — the backend is rebuilding the analysis from the
    // clone on disk. It only reaches here because a caller has nothing useful
    // to show meanwhile, so say what is happening rather than inventing a
    // fault. Retrying is exactly right: the next poll may well succeed.
    if (status === 202) {
      return {
        title: "Still analyzing this repository",
        body: `The cached analysis expired, so the server is rebuilding it from source. Large repositories take a minute. Try ${subject} again shortly.`,
        action: "retry",
        detail,
      };
    }

    if (status === 401 || status === 403) {
      return {
        title: "Sign in to continue",
        body: `This analysis is private to your account. Sign in and we'll bring you straight back to ${subject}.`,
        action: "sign-in",
        detail,
      };
    }

    if (status === 404) {
      return {
        title: "This analysis has expired",
        body: "Results are cached for a limited time and this one is gone. Re-analyze the repository to rebuild it.",
        action: "reanalyze",
        detail,
      };
    }

    if (status === 429) {
      return {
        title: "Too many requests",
        body: "You've hit this endpoint's rate limit. Wait about a minute, then try again.",
        action: "retry",
        detail,
      };
    }

    if (status === 402) {
      return {
        title: "Quota exhausted",
        body: "This account has no remaining allowance for that operation.",
        action: "none",
        detail,
      };
    }

    if (status >= 500) {
      return {
        title: "The server had a problem",
        body: `Nothing you did — the backend failed while building ${subject}. Trying again often works.`,
        action: "retry",
        detail,
      };
    }

    // Remaining 4xx: a malformed request. Retrying sends the same thing.
    return {
      title: `We couldn't build ${subject}`,
      body: "The server rejected the request. This is a bug on our side rather than something you can fix by retrying.",
      action: "none",
      detail,
    };
  }

  return {
    title: `We couldn't build ${subject}`,
    body: "Something failed unexpectedly. Trying again is worth one attempt.",
    action: "retry",
    detail,
  };
}
