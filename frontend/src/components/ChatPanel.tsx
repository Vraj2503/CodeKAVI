import { useState, useRef, useEffect, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SendHorizontal, Sparkles, FileCode2, Bot, User } from "lucide-react";
import { cn } from "../lib/utils";
import {
  chatWithRepo,
  type AnalyzeResponse,
  type ChatMessage,
  type ChatSource,
} from "../lib/api";

interface ChatPanelProps {
  repoData: AnalyzeResponse;
}

export function ChatPanel({ repoData }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: `Hey! I've analyzed **${repoData.owner}/${repoData.repo_name}** and indexed ${repoData.total_files} source files. Ask me anything about how this codebase works — I'll answer with references to the actual source code.`,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [latestSources, setLatestSources] = useState<ChatSource[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
        setLatestSources(res.sources || []);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.error || "No relevant context found. Try rephrasing your question.",
            timestamp: Date.now(),
          },
        ]);
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ ${err.message || "Something went wrong"}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-6 py-3 border-b border-border flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-text-primary">
              Ask about {repoData.repo_name}
            </h2>
            <p className="text-[11px] text-text-muted">
              Powered by RAG — answers grounded in source code
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <AnimatePresence initial={false}>
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={cn(
                  "flex gap-3 max-w-[85%]",
                  msg.role === "user" && "ml-auto flex-row-reverse"
                )}
              >
                {/* Avatar */}
                <div
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                    msg.role === "assistant"
                      ? "bg-accent/20"
                      : "bg-bg-elevated border border-border"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <Bot className="w-4 h-4 text-accent" />
                  ) : (
                    <User className="w-3.5 h-3.5 text-text-secondary" />
                  )}
                </div>

                {/* Bubble */}
                <div
                  className={cn(
                    "rounded-xl px-4 py-3 text-[13.5px] leading-relaxed",
                    msg.role === "assistant"
                      ? "bg-bg-card border border-border text-text-primary"
                      : "bg-accent/10 border border-accent/20 text-text-primary"
                  )}
                >
                  <FormattedMessage content={msg.content} />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Typing indicator */}
          {isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3"
            >
              <div className="w-7 h-7 rounded-lg bg-accent/20 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-accent" />
              </div>
              <div className="bg-bg-card border border-border rounded-xl px-4 py-3 flex items-center gap-1.5">
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-text-muted" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-text-muted" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-text-muted" />
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t border-border bg-bg-secondary/50">
          <form onSubmit={handleSubmit} className="relative">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this codebase…"
              disabled={isLoading}
              className={cn(
                "w-full pl-4 pr-12 py-3 rounded-xl text-[13.5px]",
                "bg-bg-primary border border-border",
                "text-text-primary placeholder:text-text-muted",
                "focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10",
                "disabled:opacity-50",
                "transition-all duration-200"
              )}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2",
                "w-8 h-8 rounded-lg flex items-center justify-center",
                "bg-accent text-white",
                "hover:bg-accent-hover",
                "disabled:opacity-30 disabled:cursor-not-allowed",
                "transition-all duration-200"
              )}
            >
              <SendHorizontal className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Sources Panel */}
      <div className="w-72 border-l border-border bg-bg-secondary/60 overflow-y-auto flex-shrink-0 hidden lg:block">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-[12px] font-semibold text-text-primary flex items-center gap-1.5">
            <FileCode2 className="w-3.5 h-3.5 text-accent" />
            Retrieved Sources
          </h3>
          <p className="text-[10px] text-text-muted mt-0.5">
            Citations for the latest answer
          </p>
        </div>
        <div className="px-4 py-3 space-y-2">
          {latestSources.length > 0 ? (
            latestSources.map((src, i) => (
              <motion.div
                key={`${src.file_path}-${i}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-bg-card border border-border rounded-lg p-3"
              >
                <p className="text-[12px] font-mono text-accent break-all leading-relaxed">
                  {src.file_path}
                </p>
                <span className="inline-block mt-1.5 text-[10px] text-text-muted bg-bg-hover px-1.5 py-0.5 rounded font-mono">
                  score: {src.score?.toFixed(3) ?? "—"}
                </span>
              </motion.div>
            ))
          ) : (
            <p className="text-[11px] text-text-muted italic">
              No sources retrieved yet. Ask a question to see citations.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Simple markdown-ish formatter ──
function FormattedMessage({ content }: { content: string }) {
  // Handle bold, inline code, and newlines
  const parts = content.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g);

  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              className="px-1.5 py-0.5 rounded bg-bg-hover text-warning font-mono text-[12px]"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part === "\n") {
          return <br key={i} />;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
