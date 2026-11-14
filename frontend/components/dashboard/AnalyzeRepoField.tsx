"use client";

/**
 * The one field the dashboard exists for: point it at a repository.
 *
 * Validation runs on submit and then live afterwards — refusing keystrokes
 * while someone is halfway through typing `pallets/flask` would be nagging, but
 * silently keeping a stale error after they fixed it would be worse.
 *
 * What it accepts and how each form normalises is in `lib/validation.ts`; this
 * component only decides when to ask and what to say.
 */

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Loader2 } from "lucide-react";
import { REPO_INPUT_MAX_LENGTH, validateRepoUrl } from "@/lib/validation";

interface AnalyzeRepoFieldProps {
  /** Receives `owner/repo`, already validated and normalised. */
  onAnalyze: (normalizedRepo: string) => void;
  /** True while an analysis is running elsewhere in the page. */
  loading?: boolean;
  /** A failure from the analysis itself, shown in the same slot. */
  error?: string | null;
  /** Called when typing should retire that outside error. */
  onDismissError?: () => void;
}

export function AnalyzeRepoField({
  onAnalyze,
  loading = false,
  error: externalError = null,
  onDismissError,
}: AnalyzeRepoFieldProps) {
  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // An analysis that failed while the overlay was up: put the cursor back where
  // the fix has to happen.
  useEffect(() => {
    if (externalError) inputRef.current?.focus();
  }, [externalError]);

  const shownError = localError ?? externalError ?? null;

  const handleChange = (next: string) => {
    setValue(next);
    if (externalError) onDismissError?.();

    if (!attempted) {
      setLocalError(null);
      return;
    }
    // Live from the first submission onward, so the message disappears the
    // moment the input becomes valid.
    const result = validateRepoUrl(next);
    setLocalError(result.valid ? null : result.error);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    setAttempted(true);
    const result = validateRepoUrl(value);

    if (!result.valid) {
      setLocalError(result.error);
      inputRef.current?.focus();
      return;
    }

    setLocalError(null);
    onAnalyze(result.normalized);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && shownError) {
      event.preventDefault();
      setLocalError(null);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor="analyze-repo" className="sr-only">
        Repository URL
      </label>

      <div className={shownError ? "db-field is-bad" : "db-field"}>
        <input
          id="analyze-repo"
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter repository URL"
          maxLength={REPO_INPUT_MAX_LENGTH}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          disabled={loading}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={shownError ? "analyze-repo-error" : "analyze-repo-hint"}
        />
        <button type="submit" className="db-btn" disabled={loading}>
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin" aria-hidden />
              <span>Analyzing</span>
            </>
          ) : (
            <span>Analyze</span>
          )}
        </button>
      </div>

      {shownError ? (
        <p id="analyze-repo-error" role="alert" className="db-err">
          {shownError}
        </p>
      ) : (
        <p id="analyze-repo-hint" className="db-hint">
          A GitHub URL, an SSH remote, or <code>owner/repo</code>.
        </p>
      )}
    </form>
  );
}

export default AnalyzeRepoField;
