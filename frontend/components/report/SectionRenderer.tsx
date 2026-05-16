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
  visualization_data?: any;
}

interface SectionRendererProps {
  section: SectionData;
}

export function SectionRenderer({ section }: SectionRendererProps) {
  const hasSnippets =
    section.code_snippets && section.code_snippets.length > 0;

  return (
    <div className="bg-[#161b22] rounded-xl border border-[#30363d] p-6 mb-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* LEFT COLUMN */}
        <div className={hasSnippets ? "lg:col-span-3" : "lg:col-span-5"}>
          {/* Title bar */}
          <div className="border-l-4 border-[#58a6ff] pl-3 mb-4">
            <h2 className="text-xl font-bold text-[#e6edf3]">
              {section.title}
            </h2>
          </div>

          {/* Markdown content */}
          <ReactMarkdown
            components={{
              h2: ({ children }) => (
                <h2 className="text-[#e6edf3] font-semibold text-lg mt-6 mb-2">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-[#e6edf3] font-semibold text-base mt-6 mb-2">
                  {children}
                </h3>
              ),
              p: ({ children }) => (
                <p className="text-[#c9d1d9] leading-relaxed mb-3">
                  {children}
                </p>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  className="text-[#58a6ff] hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              ),
              ul: ({ children }) => (
                <ul className="text-[#c9d1d9] ml-6 space-y-1 list-disc mb-3">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="text-[#c9d1d9] ml-6 space-y-1 list-decimal mb-3">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="text-[#c9d1d9]">{children}</li>
              ),
              code: ({ className, children, ...props }) => {
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return (
                    <code
                      className={`font-mono text-[#e6edf3] text-sm ${className || ""}`}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <code className="bg-[#21262d] text-[#f0883e] px-1.5 py-0.5 rounded text-sm font-mono">
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="bg-[#0d1117] rounded-lg p-4 overflow-x-auto border border-[#30363d] mb-3">
                  {children}
                </pre>
              ),
            }}
          >
            {section.content}
          </ReactMarkdown>

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
            <p className="text-sm font-semibold text-[#8b949e] mb-3">
              📄 Referenced Code
            </p>
            {section.code_snippets!.map((snippet, i) => (
              <div
                key={`${snippet.file_path}-${i}`}
                className="bg-[#0d1117] rounded-lg border border-[#30363d] mb-3 overflow-hidden"
              >
                {/* Snippet header */}
                <div className="bg-[#21262d] px-3 py-2 flex justify-between items-center">
                  <span className="text-[#58a6ff] font-mono text-xs truncate">
                    {snippet.file_path}
                  </span>
                  {snippet.line_start != null && snippet.line_end != null && (
                    <span className="text-[#8b949e] text-xs flex-shrink-0 ml-2">
                      L{snippet.line_start}-{snippet.line_end}
                    </span>
                  )}
                </div>
                {/* Snippet code */}
                <pre className="p-3 overflow-x-auto text-sm">
                  <code className="font-mono text-[#e6edf3] whitespace-pre">
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
