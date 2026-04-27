import { useState, useRef, useEffect, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SendHorizontal, Sparkles, FileCode2, Bot, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "../lib/utils";
import { ScrollArea } from "./ui/ScrollArea";
import { AnimatedInput } from "./ui/AnimatedInput";
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
        const uniqueSources = Array.from(
          new Map((res.sources || []).map((s: ChatSource) => [s.file_path, s])).values()
        );
        setLatestSources(uniqueSources);
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
        <div className="px-6 py-4 border-b border-border/30 flex items-center gap-3">
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

        {/* Messages */}
        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-4">
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
                    "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5",
                    msg.role === "assistant"
                      ? "bg-primary/20 border border-primary/30 shadow-lg shadow-primary/10"
                      : "bg-card border border-border/50"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <Bot className="w-4 h-4 text-primary" />
                  ) : (
                    <User className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>

                {/* Bubble */}
                <div
                  className={cn(
                    "rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed shadow-md",
                    msg.role === "assistant"
                      ? "bg-card/60 backdrop-blur-md border border-border/50 text-foreground prose prose-invert max-w-none prose-p:my-1 prose-pre:my-2 prose-pre:bg-background prose-pre:border prose-pre:border-border/30"
                      : "bg-primary/10 border border-primary/20 text-foreground"
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

          {/* Typing indicator */}
          {isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-3"
            >
              <div className="w-8 h-8 rounded-xl bg-primary/20 border border-primary/30 shadow-lg flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="bg-card/60 backdrop-blur-md border border-border/50 rounded-2xl px-5 py-4 flex items-center gap-1.5 shadow-md">
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
            <AnimatedInput
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this codebase…"
              disabled={isLoading}
              className="w-full pl-4 pr-12 py-3 bg-card border border-border"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2",
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

