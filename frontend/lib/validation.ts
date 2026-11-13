/**
 * Repository input validation.
 *
 * Separate from `lib/repoUrl.ts`, which *rewrites* whatever someone types into
 * a URL the backend's `detect_source()` can parse. This module answers a
 * different question — is this input one of the shapes we advertise? — so the
 * field can refuse garbage before it spends a clone on it.
 *
 * Accepted:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 *   owner/repo
 *
 * All four normalise to `owner/repo`, which is what the sessions table stores
 * as separate `owner` / `repo_name` columns.
 */

/** The field's own ceiling. Longer input is refused before it is validated. */
export const REPO_INPUT_MAX_LENGTH = 2048;

const OWNER_PATTERN = "[A-Za-z0-9_-]{1,100}";
/** Repo names legitimately carry dots (`next.js`, `python-dateutil.git`). */
const REPO_PATTERN = "[A-Za-z0-9_.-]{1,100}";

const HTTPS_FORM = new RegExp(
  `^https://github\\.com/(${OWNER_PATTERN})/(${REPO_PATTERN})(?:\\.git)?/?$`,
  "i",
);
const SSH_FORM = new RegExp(
  `^git@github\\.com:(${OWNER_PATTERN})/(${REPO_PATTERN})(?:\\.git)?$`,
  "i",
);
const SHORT_FORM = new RegExp(`^(${OWNER_PATTERN})/(${REPO_PATTERN})$`);

export const REPO_ERROR_EMPTY = "Please enter a repository URL";
export const REPO_ERROR_INVALID =
  "Please enter a valid repository URL (e.g., owner/repo or https://github.com/owner/repo)";
export const REPO_ERROR_TOO_LONG = `Please keep the repository URL under ${REPO_INPUT_MAX_LENGTH} characters`;

export interface RepoUrlValidation {
  valid: boolean;
  /** `owner/repo` when valid, empty string otherwise. */
  normalized: string;
  error: string | null;
}

const invalid = (error: string): RepoUrlValidation => ({
  valid: false,
  normalized: "",
  error,
});

/**
 * Trim, match, normalise. Whitespace is stripped first so a pasted URL that
 * picked up a trailing space behaves exactly like a typed one.
 */
export function validateRepoUrl(input: string): RepoUrlValidation {
  const trimmed = (input ?? "").trim();

  if (!trimmed) return invalid(REPO_ERROR_EMPTY);
  if (trimmed.length > REPO_INPUT_MAX_LENGTH) return invalid(REPO_ERROR_TOO_LONG);

  for (const pattern of [HTTPS_FORM, SSH_FORM, SHORT_FORM]) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    const owner = match[1];
    // The pattern's optional `.git` is greedy against the repo group, so strip
    // the suffix here rather than trying to make the regex possessive.
    const repo = match[2].replace(/\.git$/i, "");
    if (!repo) return invalid(REPO_ERROR_INVALID);

    return { valid: true, normalized: `${owner}/${repo}`, error: null };
  }

  return invalid(REPO_ERROR_INVALID);
}
