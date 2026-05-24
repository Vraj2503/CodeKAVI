"use client";

import {
  useState,
  useRef,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SendHorizontal, Sparkles, FileCode2, Bot, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";
import { ScrollArea } from "./ui/ScrollArea";
import ThemeSwitch from "./ui/theme-switch";
import {
  chatWithRepo,
  type AnalyzeResponse,
  type ChatMessage,
  type ChatSource,
} from "@/lib/api";
import { getMessages, saveMessage } from "@/lib/sessions";

interface ChatPanelProps {
  repoData: AnalyzeResponse;
  sessionId: string | null;
}

export function ChatPanel({ repoData, sessionId }: ChatPanelProps) {
  const welcomeMsg: ChatMessage = {
    role: "assistant",
    content: `Hey! I've analyzed **${repoData.owner}/${repoData.repo_name}** and indexed ${repoData.total_files} source files. Ask me anything about how this codebase works — I'll answer with references to the actual source code.`,
    timestamp: Date.now(),
  };

  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMsg]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [latestSources, setLatestSources] = useState<ChatSource[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load persisted messages from Supabase on mount
  useEffect(() => {
    if (!sessionId || sessionId === "dev-session") return;

    setIsLoadingHistory(true);
    getMessages(sessionId).then((persisted) => {
      if (persisted.length > 0) {
        setMessages([welcomeMsg, ...persisted]);
      } else {
        // No history — show welcome message but don't save it to the DB
        setMessages([welcomeMsg]);
      }
      setIsLoadingHistory(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: `⚠️ ${err.message || "Something went wrong"}`,
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
        {/* Header */}
        <div className="px-6 py-4 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center glow-pulse">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                Ask about {repoData.repo_name}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Powered by RAG — answers grounded in source code
              </p>
            </div>
          </div>
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
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                    className={cn(
                      "flex w-full",
                      msg.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    {/* Message Body */}
                    <div
                      className={cn(
                        "text-[15px] leading-relaxed",
                        msg.role === "assistant"
                          ? [
                              "w-full",
                              "text-foreground prose dark:prose-invert max-w-none",
                              // Paragraph spacing
                              "prose-p:my-1",
                              // Headings — force foreground color
                              "prose-headings:text-foreground",
                              // Inline code
                              "prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-sm prose-code:font-medium prose-code:before:content-none prose-code:after:content-none",
                              // Code blocks
                              "prose-pre:my-2 prose-pre:bg-background prose-pre:border prose-pre:border-border/30",
                              // Bold text
                              "prose-strong:text-foreground",
                              // Links
                              "prose-a:text-foreground prose-a:underline prose-a:underline-offset-2",
                            ].join(" ")
                          : "bg-muted/60 border border-border/40 rounded-2xl px-5 py-3.5 text-foreground shadow-sm max-w-[85%]"
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
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

        {/* Input */}
        <div className="px-6 py-4 border-t border-border bg-background/50">
          <form onSubmit={handleSubmit} className="relative">
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
              disabled={isLoading}
              rows={1}
              className={cn(
                "w-full pl-4 pr-12 py-3 bg-card border border-border rounded-xl",
                "text-sm text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20",
                "resize-none overflow-hidden",
                "transition-colors duration-200"
              )}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className={cn(
                "absolute right-2 bottom-3",
                "w-8 h-8 rounded-lg flex items-center justify-center",
                "bg-primary text-primary-foreground",
                "hover:bg-primary/90",
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
      <div className="w-72 border-l border-border/30 bg-card/30 flex flex-col flex-shrink-0 hidden lg:flex">
        <div className="px-4 py-4 border-b border-border/30 flex-shrink-0">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-primary" />
            Retrieved Sources
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Citations for the latest answer
          </p>
        </div>
        <ScrollArea className="flex-1">
          <div className="px-4 py-3 space-y-2">
            {latestSources.length > 0 ? (
              latestSources.map((src, i) => (
                <motion.div
                  key={`${src.file_path}-${i}`}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="bg-card/50 backdrop-blur-md border border-border/40 hover:border-border/80 transition-colors rounded-xl p-3 shadow-sm"
                >
                  <p className="text-xs font-mono text-primary break-all leading-relaxed">
                    {src.file_path}
                  </p>
                </motion.div>
              ))
            ) : (
              <p className="text-[11px] text-muted-foreground italic">
                No sources retrieved yet. Ask a question to see citations.
              </p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
