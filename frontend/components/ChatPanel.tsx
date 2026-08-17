"use client";

/**
 * Chat.
 *
 * Two structural changes from the old panel. First, the conversation is a
 * reading column (~46rem) instead of full-bleed: an answer that runs the width
 * of a 27" display is unreadable no matter how good it is. Second, citations
 * moved out of a permanent right-hand column and under the answer that
 * produced them — the old panel only ever held the *latest* answer's sources,
 * so scrolling up left the citations lying about which reply they belonged to.
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
  type ComponentProps,
} from "react";
import { ArrowUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { ScrollArea } from "./ui/ScrollArea";
import { Kbd } from "./ui/Kbd";
import { CodeBlockWithFile } from "./CodeRefCard";
import {
  chatWithRepo,
  type AnalyzeResponse,
  type ChatMessage,
  type ChatSource,
} from "@/lib/api";
import { getMessages, saveMessage } from "@/lib/sessions";

// ── Custom Markdown Components ──

/**
 * Parse the code fence info-string to extract language, file path, and line range.
 * Expected format: "python:codekavi/indexer.py:L1-L25"
 * Falls back gracefully if the format doesn't match.
 */
function parseCodeFenceInfo(infoString: string) {
  // Pattern: language:filepath:Lstart-Lend
  const match = infoString.match(/^([^:]+):(.+?):(L\d+-L\d+)$/);
  if (match) {
    return { language: match[1], filePath: match[2], lineRange: match[3] };
  }

  // Pattern: language:filepath (no line range)
  const match2 = infoString.match(/^([^:]+):(.+\..+)$/);
  if (match2) {
    return { language: match2[1], filePath: match2[2], lineRange: undefined };
  }

  // No file info — just a regular code block
  return null;
}

/** Custom `pre` renderer — delegates to CodeBlockWithFile when file info is present */
function MarkdownPre({ children, ...rest }: ComponentProps<"pre">) {
  // ReactMarkdown wraps <code> inside <pre>
  // Check if the child is a <code> element with a className like "language-python:path:lines"
  const child = Array.isArray(children) ? children[0] : children;

  if (
    child &&
    typeof child === "object" &&
    "props" in child &&
    child.props?.className
  ) {
    const className: string = child.props.className || "";
    // className looks like "language-python:codekavi/indexer.py:L1-L25"
    const langMatch = className.match(/^language-(.+)$/);
    if (langMatch) {
      const parsed = parseCodeFenceInfo(langMatch[1]);
      if (parsed) {
        // Extract the raw code text from the <code> children
        const codeText =
          typeof child.props.children === "string"
            ? child.props.children.replace(/\n$/, "")
            : String(child.props.children || "").replace(/\n$/, "");

        return (
          <CodeBlockWithFile
            code={codeText}
            language={parsed.language}
            filePath={parsed.filePath}
            lineRange={parsed.lineRange}
          />
        );
      }
    }
  }

  // Default: render as normal <pre>
  return <pre {...rest}>{children}</pre>;
}

const markdownComponents = { pre: MarkdownPre };

const PROSE = [
  "prose prose-sm dark:prose-invert max-w-none break-words",
  /*
   * Typography's own body colour is SLATE — a cool blue-grey. Against this
   * app's warm neutral palette it read as blue text, which is what made the
   * assistant's opening message look tinted. Point the plugin's variables at
   * the app's foreground instead of overriding element by element.
   */
  "[--tw-prose-body:hsl(var(--foreground)/0.84)]",
  "[--tw-prose-invert-body:hsl(var(--foreground)/0.84)]",
  "[--tw-prose-bullets:hsl(var(--muted-foreground))]",
  "[--tw-prose-invert-bullets:hsl(var(--muted-foreground))]",
  "[--tw-prose-counters:hsl(var(--muted-foreground))]",
  "[--tw-prose-invert-counters:hsl(var(--muted-foreground))]",
  "prose-p:my-2 prose-p:leading-relaxed",
  "prose-headings:text-foreground prose-headings:font-semibold prose-headings:tracking-[-0.01em]",
  "prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[13px] prose-code:before:content-none prose-code:after:content-none prose-code:break-words",
  "prose-pre:my-3 prose-pre:bg-card prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:max-w-full prose-pre:overflow-x-auto",
  "prose-strong:text-foreground prose-li:my-0.5",
  "prose-a:text-foreground prose-a:underline prose-a:decoration-border prose-a:underline-offset-2 prose-a:break-all",
].join(" ");

interface ChatPanelProps {
  repoData: AnalyzeResponse;
  sessionId: string | null;
}

export function ChatPanel({ repoData, sessionId }: ChatPanelProps) {
  const getWelcomeMsg = (): ChatMessage => ({
    role: "assistant",
    content: `I've read **${repoData.owner}/${repoData.repo_name}** — ${repoData.total_files} source files, indexed. Ask how any part of it works and I'll answer from the files themselves.`,
    timestamp: Date.now(),
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    getWelcomeMsg(),
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const starters = [
    "What does this repository do?",
    "Walk me through the entry point",
    "Where is state managed?",
  ];

  // Load persisted messages from Supabase on mount
  useEffect(() => {
    if (!sessionId || sessionId === "dev-session") return;

    let ignore = false;
    const loadHistory = async () => {
      setIsLoadingHistory(true);
      const persisted = await getMessages(sessionId);
      if (ignore) return;
      setMessages(
        persisted.length > 0
          ? [getWelcomeMsg(), ...persisted]
          : [getWelcomeMsg()],
      );
      setIsLoadingHistory(false);
    };

    loadHistory();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const ask = useCallback(async (query: string) => {
    if (!query || isLoading) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: query,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);

    if (sessionId && sessionId !== "dev-session") {
      saveMessage(sessionId, userMsg);
    }

    const push = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      if (sessionId && sessionId !== "dev-session") saveMessage(sessionId, msg);
    };

    try {
      const res = await chatWithRepo(repoData.repo_id, query);
      if (res.success) {
        push({
          role: "assistant",
          content: res.answer,
          sources: res.sources,
          timestamp: Date.now(),
        });
      } else {
        push({
          role: "assistant",
          content:
            res.error ||
            "No relevant context found. Try rephrasing your question.",
          timestamp: Date.now(),
        });
      }
    } catch (err: unknown) {
      push({
        role: "assistant",
        content: `⚠️ ${err instanceof Error ? err.message : "Something went wrong"}`,
        timestamp: Date.now(),
      });
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [isLoading, repoData.repo_id, sessionId]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input.trim());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-[46rem] px-6 py-8">
          {isLoadingHistory ? (
            <p className="py-12 text-center text-[13px] text-muted-foreground">
              Loading conversation…
            </p>
          ) : (
            <div className="space-y-7">
              {messages.map((msg, i) =>
                msg.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="max-w-[85%] rounded-xl rounded-br-sm border border-border bg-muted px-4 py-2.5 text-[14px] leading-relaxed">
                      {msg.content}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="animate-rise">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-signal" />
                      <span className="eyebrow">Rune</span>
                    </div>
                    <div className={cn("text-[14px]", PROSE)}>
                      <ReactMarkdown components={markdownComponents}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                    <Citations sources={msg.sources} />
                  </div>
                ),
              )}

              {isLoading && (
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-foreground" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-foreground" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-foreground" />
                </div>
              )}
            </div>
          )}

          {/* Starters — only while the conversation is still empty. */}
          {!isLoadingHistory && messages.length === 1 && !isLoading && (
            <div className="mt-8 flex flex-wrap gap-2">
              {starters.map((starter, i) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => ask(starter)}
                  style={{ animationDelay: `${i * 40}ms` }}
                  className="press animate-rise rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors duration-150 ease-out hover:border-foreground/25 hover:text-foreground"
                >
                  {starter}
                </button>
              ))}
            </div>
          )}

          <div ref={messagesEndRef} className="h-2" />
        </div>
      </ScrollArea>

      {/* ── Composer ── */}
      <div className="flex-shrink-0 border-t border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto w-full max-w-[46rem] px-6 py-4">
          <form
            onSubmit={handleSubmit}
            className={cn(
              "relative rounded-lg border border-border bg-card",
              "transition-[border-color,box-shadow] duration-200 ease-out",
              "focus-within:border-signal/50 focus-within:ring-4 focus-within:ring-signal/10",
            )}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Auto-resize: reset then grow to content
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
              }}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(input.trim());
                }
              }}
              placeholder={`Ask about ${repoData.repo_name}…`}
              disabled={isLoading}
              rows={1}
              className="w-full resize-none overflow-hidden bg-transparent py-3 pl-3.5 pr-12 text-[14px] leading-relaxed placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              aria-label="Send"
              className={cn(
                "press absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-md",
                "bg-foreground text-background transition-[background-color,opacity] duration-150 ease-out",
                "hover:bg-foreground/88 disabled:opacity-25",
              )}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.25} />
            </button>
          </form>

          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Kbd>↵</Kbd> to send
            <span className="text-border">·</span>
            <Kbd>⇧↵</Kbd> for a new line
            <span className="ml-auto hidden sm:inline">
              Answers are retrieved from source, not recalled.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

/** The files behind one answer, attached to that answer. */
function Citations({ sources }: { sources?: ChatSource[] }) {
  if (!sources?.length) return null;

  const unique = Array.from(
    new Map(sources.map((s) => [s.file_path, s])).values(),
  );

  return (
    <div className="mt-3.5 border-t border-border pt-3">
      <span className="eyebrow">
        {unique.length} source{unique.length === 1 ? "" : "s"}
      </span>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {unique.map((source) => (
          <li key={source.file_path}>
            <span
              title={source.file_path}
              className="inline-block max-w-[22rem] truncate rounded border border-border bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground"
            >
              {source.file_path}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
