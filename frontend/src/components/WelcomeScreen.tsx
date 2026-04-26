import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { BookOpen, GitBranch, Loader2, Search, Sparkles, MessageSquare, Code2 } from "lucide-react";
import { cn } from "../lib/utils";
import { AnimatedInput } from "./ui/AnimatedInput";

interface WelcomeScreenProps {
  onAnalyze: (url: string) => void;
  isAnalyzing: boolean;
  error: string | null;
}

export function WelcomeScreen({ onAnalyze, isAnalyzing, error }: WelcomeScreenProps) {
  const [url, setUrl] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !isAnalyzing) {
      onAnalyze(url.trim());
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-bg-primary relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-accent/[0.03] blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-lg px-6"
      >
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center glow-pulse">
            <BookOpen className="w-8 h-8 text-accent" />
          </div>
        </div>

        {/* Title */}
        <h1 className="text-center text-2xl font-bold tracking-tight text-text-primary mb-2">
          Understand Any Repository
        </h1>
        <p className="text-center text-[14px] text-text-secondary mb-8 max-w-sm mx-auto leading-relaxed">
          Paste a GitHub URL and start asking questions about the codebase. 
          Answers are grounded in actual source code.
        </p>

        {/* Input */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <GitBranch className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <AnimatedInput
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              className="w-full pl-11 pr-4 py-3.5"
            />
          </div>
          <button
            type="submit"
            disabled={!url.trim() || isAnalyzing}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[14px] font-semibold",
              "bg-accent text-white",
              "hover:bg-accent-hover active:scale-[0.98]",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "transition-all duration-200"
            )}
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Cloning & Analyzing…
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                Analyze Repository
              </>
            )}
          </button>
          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[12px] text-error text-center"
            >
              {error}
            </motion.p>
          )}
        </form>

        {/* Feature cards */}
        <div className="mt-10 grid grid-cols-3 gap-3">
          {[
            {
              icon: MessageSquare,
              title: "Chat with Code",
              desc: "Ask questions, get grounded answers",
            },
            {
              icon: Sparkles,
              title: "AI Insights",
              desc: "Understand architecture instantly",
            },
            {
              icon: Code2,
              title: "Source Citations",
              desc: "Every answer links to real files",
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="bg-bg-card/60 border border-border rounded-xl p-3 text-center"
            >
              <feature.icon className="w-5 h-5 text-accent mx-auto mb-2" />
              <p className="text-[12px] font-medium text-text-primary mb-0.5">
                {feature.title}
              </p>
              <p className="text-[10px] text-text-muted leading-snug">{feature.desc}</p>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
