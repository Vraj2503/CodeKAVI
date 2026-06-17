"use client";

import { FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeBlockWithFileProps {
  /** The raw code string (may contain "N | " line-number prefixes) */
  code: string;
  /** Language for syntax display, e.g. "python" */
  language: string;
  /** File path, e.g. "codekavi/indexer.py" */
  filePath: string;
  /** Optional line range (legacy fallback, e.g. "L100-L130") */
  lineRange?: string;
}

/** Pattern to detect line-number prefix: "54 | code here" */
const LINE_PREFIX_RE = /^(\d+) \| (.*)$/;

interface ParsedLine {
  lineNum: number | null;
  content: string;
}

/**
 * Parse code lines to extract embedded line numbers.
 * If lines have "N | " prefixes, extracts the number and strips the prefix.
 * Falls back to sequential numbering if no prefixes are found.
 */
function parseLines(code: string, fallbackStart: number): ParsedLine[] {
  const rawLines = code.split("\n");

  // First pass: check if lines have the "N | " prefix
  const parsed = rawLines.map((line) => {
    const match = line.match(LINE_PREFIX_RE);
    if (match) {
      return { lineNum: parseInt(match[1], 10), content: match[2] };
    }
    return { lineNum: null, content: line };
  });

  // If at least half the lines have real prefixes, use them
  const prefixedCount = parsed.filter((l) => l.lineNum !== null).length;
  if (prefixedCount > 0 && prefixedCount >= rawLines.length / 2) {
    // Fill in gaps (e.g. blank lines without prefix) using neighbors
    return parsed.map((line, i) => {
      if (line.lineNum !== null) return line;
      // Estimate from previous line
      const prev = parsed[i - 1];
      const num = prev?.lineNum != null ? prev.lineNum + 1 : fallbackStart + i;
      return { lineNum: num, content: line.content };
    });
  }

  // No prefixes found — use fallback sequential numbering
  return rawLines.map((line, i) => ({
    lineNum: fallbackStart + i,
    content: line,
  }));
}

export function CodeBlockWithFile({
  code,
  filePath,
  lineRange,
}: CodeBlockWithFileProps) {
  // Parse fallback start from lineRange prop (e.g. "L30-L35" → 30)
  let fallbackStart = 1;
  if (lineRange) {
    const match = lineRange.match(/L(\d+)/);
    if (match) fallbackStart = parseInt(match[1], 10);
  }

  const lines = parseLines(code, fallbackStart);

  // Width needed for the largest line number (for consistent gutter alignment)
  const maxLineNum = Math.max(...lines.map((l) => l.lineNum || 1));
  const gutterWidth = String(maxLineNum).length;

  return (
    <div className="not-prose my-3 rounded-xl overflow-hidden border border-border/40 shadow-sm">
      {/* File header bar */}
      <div
        className={cn(
          "flex items-center gap-2",
          "px-4 py-2",
          "bg-muted/60 border-b border-border/30",
          "border-l-[3px] border-l-primary"
        )}
      >
        <FileCode2 className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span
          className="text-xs font-mono font-medium text-primary truncate"
          title={filePath}
        >
          {filePath}
        </span>
      </div>

      {/* Code content with line numbers */}
      <div className="overflow-x-auto bg-background/80">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="leading-relaxed">
                {/* Line number gutter */}
                <td
                  className={cn(
                    "select-none text-right align-top",
                    "pr-4 pl-4 py-0",
                    "text-[13px] font-mono",
                    "text-muted-foreground/40",
                    "border-r border-border/20",
                    i === 0 && "pt-3",
                    i === lines.length - 1 && "pb-3"
                  )}
                  style={{ minWidth: `${gutterWidth + 2}ch` }}
                >
                  {line.lineNum}
                </td>
                {/* Code line */}
                <td
                  className={cn(
                    "pl-4 pr-4 py-0",
                    "text-[13px] font-mono text-foreground whitespace-pre",
                    i === 0 && "pt-3",
                    i === lines.length - 1 && "pb-3"
                  )}
                >
                  {line.content}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
