"use client";

/**
 * Everything this account has already had analyzed.
 *
 * Presented as the landing page's window panel — a mono title strip over a
 * paper body — because that is the page's most characteristic container and it
 * does real work here: it names the list and carries its count in one strip
 * instead of a heading plus a badge.
 *
 * Rows rather than cards: repository paths are the content, they are mono and
 * they line up down one edge. Forty cards would be forty borders competing
 * with forty names.
 *
 * 20 per page. Requirements 1.1 and 10.5 both name 20, and 2.1's ceiling of 50
 * per page is satisfied by any page below it.
 */

import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  RotateCw,
} from "lucide-react";
import type { Session } from "@/lib/sessions";
import { RepositoryListSkeleton } from "./skeletons";

export const ITEMS_PER_PAGE = 20;

interface RepositoryHistoryProps {
  /** Newest first — `getSessions` already orders by `updated_at` descending. */
  sessions: Session[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpen: (session: Session) => void;
}

function topLanguages(languages: Record<string, number> | null): string {
  if (!languages) return "";
  return Object.entries(languages)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([language]) => language)
    .join(" · ");
}

export function RepositoryHistory({
  sessions,
  loading,
  error,
  onRetry,
  onOpen,
}: RepositoryHistoryProps) {
  const [rawPage, setRawPage] = useState(1);

  // Frozen at first render: a relative timestamp computed during the server
  // pass and again on the client would differ by a second and hydrate wrong.
  const [now] = useState(() => Date.now());

  const totalPages = Math.max(1, Math.ceil(sessions.length / ITEMS_PER_PAGE));
  const page = Math.min(rawPage, totalPages);
  const start = (page - 1) * ITEMS_PER_PAGE;
  const visible = sessions.slice(start, start + ITEMS_PER_PAGE);

  const relativeTime = (iso: string) => {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return "unknown";
    const minutes = Math.floor((now - then) / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  };

  const absoluteTime = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  };

  return (
    <section className="db-win" aria-labelledby="history-heading">
      <div className="db-win__bar">
        <h2 id="history-heading">recent analyses</h2>
        {!loading && !error && sessions.length > 0 && (
          <em>{sessions.length}</em>
        )}
      </div>

      {loading ? (
        <RepositoryListSkeleton />
      ) : error ? (
        <div className="db-fail" role="alert">
          <p className="db-fail__t">Repository history unavailable.</p>
          <p className="db-fail__b">{error}</p>
          <button type="button" className="db-sbtn" onClick={onRetry}>
            <RotateCw size={13} aria-hidden />
            Try again
          </button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="db-empty">
          <p className="db-empty__t">No repositories analyzed yet</p>
          <p className="db-empty__b">
            Paste a repository above. The analysis lands here, and stays until
            you remove it.
          </p>
        </div>
      ) : (
        <>
          <div className="db-rows">
            {visible.map((session, index) => {
              const languages = topLanguages(session.languages);
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onOpen(session)}
                  style={
                    { "--i": Math.min(index, 8) } as React.CSSProperties
                  }
                  className="db-row"
                >
                  <span className="db-row__n">
                    {String(start + index + 1).padStart(2, "0")}
                  </span>

                  <span className="db-row__stack">
                    <span className="db-row__repo">
                      <span>{session.owner}/</span>
                      {session.repo_name}
                    </span>
                    {languages && (
                      <span className="db-row__langs">{languages}</span>
                    )}
                  </span>

                  <span className="db-row__aside">
                    <span className="db-row__msgs">
                      <MessageSquare size={12} aria-hidden />
                      {session.message_count ?? 0}
                    </span>
                    <time
                      className="db-row__time"
                      dateTime={session.updated_at}
                      title={absoluteTime(session.updated_at)}
                      aria-label={`Last analyzed ${absoluteTime(session.updated_at)}`}
                    >
                      {relativeTime(session.updated_at)}
                    </time>
                    <ChevronRight
                      size={14}
                      className="db-row__go"
                      aria-hidden
                    />
                  </span>
                </button>
              );
            })}
          </div>

          {totalPages > 1 && (
            <nav className="db-pager" aria-label="Repository history pages">
              <span>
                {start + 1}–{Math.min(start + ITEMS_PER_PAGE, sessions.length)}{" "}
                of {sessions.length}
              </span>
              <span className="db-pager__btns">
                <button
                  type="button"
                  className="db-sbtn"
                  onClick={() => setRawPage(Math.max(1, page - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={14} aria-hidden />
                </button>
                <span>
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="db-sbtn"
                  onClick={() => setRawPage(Math.min(totalPages, page + 1))}
                  disabled={page === totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight size={14} aria-hidden />
                </button>
              </span>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

export default RepositoryHistory;
