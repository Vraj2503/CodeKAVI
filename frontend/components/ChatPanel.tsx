"use client";

import {
  useState,
  useRef,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
  type ComponentProps,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SendHorizontal, FileCode2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { ScrollArea } from "./ui/ScrollArea";
import ThemeSwitch from "./ui/theme-switch";
import { Button } from "./ui/button";
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

const markdownComponents = {
  pre: MarkdownPre,
};

interface ChatPanelProps {
  repoData: AnalyzeResponse;
  sessionId: string | null;
}

export function ChatPanel({ repoData, sessionId }: ChatPanelProps) {
  const getWelcomeMsg = (): ChatMessage => ({
    role: "assistant",
    content: `Hey! I've analyzed **${repoData.owner}/${repoData.repo_name}** and indexed ${repoData.total_files} source files. Ask me anything about how this codebase works — I'll answer with references to the actual source code.`,
    timestamp: Date.now(),
  });

  const [messages, setMessages] = useState<ChatMessage[]>(() => [getWelcomeMsg()]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [latestSources, setLatestSources] = useState<ChatSource[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load persisted messages from Supabase on mount
  useEffect(() => {
    if (!sessionId || sessionId === "dev-session") return;

    let ignore = false;
    const loadHistory = async () => {
      setIsLoadingHistory(true);
      const persisted = await getMessages(sessionId);
      if (ignore) return;
      if (persisted.length > 0) {
        setMessages([getWelcomeMsg(), ...persisted]);
      } else {
        setMessages([getWelcomeMsg()]);
      }
      setIsLoadingHistory(false);
    };
    
    loadHistory();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /*
   * Jump on the first paint, glide afterwards.
   *
   * This was unconditionally `behavior: "smooth"`, so loading a session
   * with history animated a scroll through every message that had ever
   * been sent before landing at the bottom. Restoring a conversation
   * should look like it was always there; only messages that arrive
   * while you are watching earn the animated scroll.
   */
  const hasScrolledOnce = useRef(false);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: hasScrolledOnce.current ? "smooth" : "auto",
      block: "end",
    });
    hasScrolledOnce.current = true;
  }, [messages]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const query = input.trim();
    if (!query || isLoading) return;

    const userMsg: ChatMessage = {
      role: "user",
      content: query,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    // Persist user message
    if (sessionId && sessionId !== "dev-session") {
      saveMessage(sessionId, userMsg);
    }

    try {
      const res = await chatWithRepo(repoData.repo_id, query);
      if (res.success) {
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: res.answer,
          sources: res.sources,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // Persist assistant message
        if (sessionId && sessionId !== "dev-session") {
          saveMessage(sessionId, assistantMsg);
        }

        const uniqueSources = Array.from(
          new Map(
            (res.sources || []).map((s: ChatSource) => [s.file_path, s])
          ).values()
        );
        setLatestSources(uniqueSources);
      } else {
        const errorMsg: ChatMessage = {
          role: "assistant",
          content:
            res.error ||
            "No relevant context found. Try rephrasing your question.",
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        if (sessionId && sessionId !== "dev-session") {
          saveMessage(sessionId, errorMsg);
        }
      }
    } catch (err: unknown) {
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: `⚠️ ${err instanceof Error ? err.message : "Something went wrong"}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      if (sessionId && sessionId !== "dev-session") {
        saveMessage(sessionId, errorMsg);
      }
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/*
          Header. The subtitle used to read "Powered by RAG — answers
          grounded in source code": an implementation detail, permanently
          occupying the second line of every chat. The retrieved-sources
          panel demonstrates the same claim with evidence.
        */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border bg-card/50 px-5 py-2.5">
          <h2 className="min-w-0 truncate font-sans text-[13px] text-muted-foreground">
            Asking{" "}
            <span className="font-mono text-foreground">
              {repoData.owner}/{repoData.repo_name}
            </span>
          </h2>
          <ThemeSwitch />
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-4">
            {isLoadingHistory ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                  Loading chat history…
                </div>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {messages.map((msg, i) => (
                  /*
                    Only the question gets a bubble. The answer is the
                    document you came to read, so it runs as body copy at
                    full width — bubbling both sides makes a long
                    architectural explanation look like a text message.
                  */
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, transform: "translateY(8px)" }}
                    animate={{ opacity: 1, transform: "translateY(0px)" }}
                    transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    className={cn(
                      "flex w-full min-w-0",
                      msg.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        msg.role === "assistant"
                          ? [
                              "w-full max-w-full break-words",
                              // `.prose` supplies the serif face, size and
                              // rhythm; the plugin supplies list/table
                              // styling. No max-width here on purpose —
                              // answers carry code blocks.
                              "prose dark:prose-invert",
                              "prose-headings:text-foreground",
                              "prose-strong:text-foreground",
                              "prose-a:text-signal prose-a:underline prose-a:underline-offset-2 prose-a:break-all",
                              "prose-pre:max-w-full prose-pre:overflow-x-auto",
                            ].join(" ")
                          : [
                              "max-w-[80%] break-words border border-signal/35 bg-signal/[0.08] px-4 py-2.5",
                              "font-sans text-[14px] leading-relaxed text-foreground",
                            ].join(" "),
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <ReactMarkdown components={markdownComponents}>
                          {msg.content}
                        </ReactMarkdown>
                      ) : (
                        msg.content
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}

            {/* Typing indicator */}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex w-full justify-start"
              >
                <div className="py-2 flex items-center gap-1.5">
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                  <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Composer */}
        <div className="flex-shrink-0 border-t border-border bg-card/50 px-5 py-3">
          {/*
            The send button is anchored to the bottom of a flex row rather
            than absolutely positioned against the textarea. With
            auto-grow, `absolute bottom-3` drifted away from the last line
            as the box expanded toward its 160px cap.
          */}
          <form
            onSubmit={handleSubmit}
            className={cn(
              "flex items-end gap-2 border border-border bg-card p-2 pl-3.5",
              "transition-[border-color] duration-150 ease-out",
              "focus-within:border-signal",
            )}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Auto-resize: reset then grow to content
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              }}
              onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as unknown as FormEvent);
                  // Reset height after send
                  if (inputRef.current) {
                    inputRef.current.style.height = "auto";
                  }
                }
              }}
              placeholder="Ask about this codebase…"
              aria-label="Ask about this codebase"
              disabled={isLoading}
              rows={1}
              className={cn(
                "min-w-0 flex-1 resize-none overflow-hidden bg-transparent py-1.5",
                "font-sans text-[14px] leading-relaxed text-foreground",
                "placeholder:text-muted-foreground/60",
                "outline-none focus-visible:outline-none",
              )}
            />
            <Button
              type="submit"
              size="icon-sm"
              disabled={!input.trim() || isLoading}
              aria-label="Send message"
              className="mb-0.5"
            >
              <SendHorizontal />
            </Button>
          </form>
          <p className="mt-2 px-1 font-sans text-[10.5px] text-muted-foreground/60">
            <kbd className="font-mono">Enter</kbd> to send ·{" "}
            <kbd className="font-mono">Shift</kbd>+
            <kbd className="font-mono">Enter</kbd> for a new line
          </p>
        </div>
      </div>

      {/* Retrieved sources — the evidence for the answer on the left. */}
      <div className="hidden w-64 flex-shrink-0 flex-col border-l border-border bg-sidebar lg:flex">
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="eyebrow">Sources</h3>
          {latestSources.length > 0 && (
            <span className="tabular ml-auto text-[11px] text-muted-foreground">
              {latestSources.length}
            </span>
          )}
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {latestSources.length > 0 ? (
              latestSources.map((src, i) => {
                // Split so the filename reads at full contrast and the
                // directory recedes — a column of full paths in one weight
                // is unscannable once they share a prefix.
                const parts = src.file_path.split("/");
                const name = parts.pop();
                const dir = parts.join("/");
                return (
                  <motion.div
                    key={`${src.file_path}-${i}`}
                    initial={{ opacity: 0, transform: "translateX(6px)" }}
                    animate={{ opacity: 1, transform: "translateX(0px)" }}
                    transition={{
                      duration: 0.2,
                      ease: [0.23, 1, 0.32, 1],
                      delay: Math.min(i * 0.035, 0.28),
                    }}
                    className={cn(
                      "border-l-2 border-transparent px-2.5 py-2 transition-colors duration-100",
                      "[@media(hover:hover)]:hover:border-signal [@media(hover:hover)]:hover:bg-signal/[0.06]",
                    )}
                    title={src.file_path}
                  >
                    {dir && (
                      <p className="truncate font-mono text-[10.5px] leading-tight text-muted-foreground/65">
                        {dir}/
                      </p>
                    )}
                    <p className="break-all font-mono text-[11.5px] leading-snug text-foreground">
                      {name}
                    </p>
                  </motion.div>
                );
              })
            ) : (
              <p className="px-2.5 py-3 font-sans text-[11.5px] leading-relaxed text-muted-foreground/70">
                Citations for each answer appear here.
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
