/**
 * Loading placeholder for the history panel.
 *
 * It mirrors the real rows — same height, same three columns, same hairlines —
 * so the panel does not jump when data lands. A skeleton that only roughly
 * matches promises a layout and then breaks it.
 */

const WIDTHS = ["42%", "56%", "34%", "48%", "62%", "38%"];

export function RepositoryListSkeleton({ count = 20 }: { count?: number }) {
  return (
    <div
      className="db-rows"
      role="status"
      aria-label="Loading repository history"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="db-row" aria-hidden>
          <span className="db-row__n">
            {String(i + 1).padStart(2, "0")}
          </span>
          <span className="db-row__stack">
            <span
              className="db-skel"
              style={{ height: 10, width: WIDTHS[i % WIDTHS.length] }}
            />
            <span className="db-skel" style={{ height: 8, width: "22%" }} />
          </span>
          <span className="db-row__aside">
            <span className="db-skel" style={{ height: 8, width: 42 }} />
          </span>
        </div>
      ))}
    </div>
  );
}
