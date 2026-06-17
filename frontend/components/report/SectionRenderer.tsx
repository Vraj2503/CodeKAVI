/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import ReactMarkdown from "react-markdown";
import { VizContainer } from "@/components/report/viz/VizContainer";

interface CodeSnippet {
  file_path: string;
  line_start?: number;
  line_end?: number;
  code: string;
}

export interface SectionData {
  name: string;
  title: string;
  content: string;
  code_snippets?: CodeSnippet[];
  visualization_type?: string;
  visualization_data?: unknown;
}

interface SectionRendererProps {
  section: SectionData;
}

export function SectionRenderer({ section }: SectionRendererProps) {
  const hasSnippets =
    section.code_snippets && section.code_snippets.length > 0;

  return (
    <div className="bg-card rounded-xl border border-border p-6 mb-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT COLUMN */}
        <div className={hasSnippets ? "lg:col-span-3" : "lg:col-span-5"}>
          {/* Title bar */}
          <div className="border-l-4 border-foreground pl-3 mb-4">
            <h2 className="text-xl font-bold text-foreground">
              {section.title}
            </h2>
          </div>

          {/* Markdown content */}
          {(
            <ReactMarkdown
              components={{
              h2: ({ node, ...props }: any) => (
                <h2 className="text-foreground font-semibold text-lg mt-6 mb-2" {...props} />
              ),
              h3: ({ node, ...props }: any) => (
                <h3 className="text-foreground font-semibold text-base mt-6 mb-2" {...props} />
              ),
              p: ({ node, ...props }: any) => (
                <p className="text-foreground/85 leading-relaxed mb-3" {...props} />
              ),
              a: ({ node, ...props }: any) => (
                <a
                  className="text-foreground underline underline-offset-2 hover:text-foreground/70"
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                />
              ),
              ul: ({ node, ...props }: any) => (
                <ul className="text-foreground/85 ml-6 space-y-1 list-disc mb-3" {...props} />
              ),
              ol: ({ node, ...props }: any) => (
                <ol className="text-foreground/85 ml-6 space-y-1 list-decimal mb-3" {...props} />
              ),
              li: ({ node, ...props }: any) => (
                <li className="text-foreground/85" {...props} />
              ),
              code: ({ node, className, ...props }: any) => {
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return (
                    <code
                      className={`font-mono text-foreground text-sm ${className || ""}`}
                      {...props}
                    />
                  );
                }
                return (
                  <code className="bg-muted text-foreground px-1.5 py-0.5 rounded text-sm font-mono" {...props} />
                );
              },
              pre: ({ node, ...props }: any) => (
                <pre className="bg-background rounded-lg p-4 overflow-x-auto border border-border mb-3" {...props} />
              ),
            }}
          >
              {section.content}
            </ReactMarkdown>
          ) as any}

          {/* Visualization */}
          {section.visualization_type && section.visualization_data && (
            <VizContainer
              visualizationType={section.visualization_type}
              visualizationData={section.visualization_data}
            />
          )}
        </div>

        {/* RIGHT COLUMN — code snippets */}
        {hasSnippets && (
          <div className="lg:col-span-2 sticky top-4 max-h-[80vh] overflow-y-auto pr-2">
            <p className="text-sm font-semibold text-muted-foreground mb-3">
              📄 Referenced Code
            </p>
            {section.code_snippets!.map((snippet, i) => (
              <div
                key={`${snippet.file_path}-${i}`}
                className="bg-background rounded-lg border border-border mb-3 overflow-hidden"
              >
                {/* Snippet header */}
                <div className="bg-muted px-3 py-2 flex justify-between items-center">
                  <span className="text-foreground font-mono text-xs truncate">
                    {snippet.file_path}
                  </span>
                  {snippet.line_start != null && snippet.line_end != null && (
                    <span className="text-muted-foreground text-xs flex-shrink-0 ml-2">
                      L{snippet.line_start}-{snippet.line_end}
                    </span>
                  )}
                </div>
                {/* Snippet code */}
                <pre className="p-3 overflow-x-auto text-sm">
                  <code className="font-mono text-foreground whitespace-pre">
                    {snippet.code}
                  </code>
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
