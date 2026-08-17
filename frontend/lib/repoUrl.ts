/**
 * Normalize whatever someone types into a repository field into a URL the
 * backend's `detect_source()` can parse.
 *
 * That parser reads the host off `urlparse(url).hostname` and accepts
 * exactly github.com, gitlab.com and bitbucket.org. A bare `owner/repo`
 * has no hostname at all, so it fails with "Unsupported repository host"
 * — which reads as though the host were wrong rather than missing.
 *
 * People paste all of these, and all of them should work:
 *
 *   https://github.com/owner/repo      → unchanged
 *   github.com/owner/repo              → scheme added
 *   gitlab.com/owner/repo              → scheme added, host preserved
 *   git@github.com:owner/repo.git      → rewritten to https
 *   owner/repo                         → assumed GitHub
 *   www.github.com/owner/repo          → `www.` stripped (hostname must
 *                                        match exactly, so it would fail)
 */

/** Hosts the backend's `detect_source()` recognises. */
export const SUPPORTED_HOSTS = [
  "github.com",
  "gitlab.com",
  "bitbucket.org",
] as const;

export function normalizeRepoUrl(raw: string): string {
  let value = raw.trim();
  if (!value) return value;

  // scp-style SSH remote — the form `git clone` prints and people copy.
  const ssh = value.match(/^git@([^:]+):(.+)$/);
  if (ssh) {
    value = `https://${ssh[1]}/${ssh[2]}`;
  }

  // Strip a leading `www.`, with or without a scheme. The backend compares
  // the hostname exactly, so `www.github.com` is rejected as unsupported.
  value = value.replace(/^(https?:\/\/)?www\./i, "$1");

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  if (hasScheme) return value;

  const bareHost = SUPPORTED_HOSTS.some(
    (h) => value === h || value.toLowerCase().startsWith(`${h}/`),
  );
  if (bareHost) return `https://${value}`;

  // Anything else that looks like `owner/repo` is assumed to be GitHub —
  // it is what the field's placeholder shows and by far the common case.
  if (/^[^/\s]+\/[^/\s]+\/?$/.test(value)) {
    return `https://github.com/${value.replace(/\/$/, "")}`;
  }

  // Give up and hand it over untouched; the backend owns the final say on
  // what is valid and will produce the accurate error.
  return value;
}
