import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { GitBranch, Loader2, Search, Sparkles, MessageSquare, Code2 } from "lucide-react";
import { AnimatedInput } from "./ui/AnimatedInput";
import SpotlightBackground from "./ui/SpotlightBackground";
import { HeroShutterText } from "./ui/HeroShutterText";
import { Button } from "./ui/NeonButton";

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
    <SpotlightBackground>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
        className="relative z-10 w-full max-w-2xl px-6 flex flex-col items-center"
      >
        {/* Title */}
        <HeroShutterText 
          text="CodeKavi" 
          className="text-4xl md:text-5xl lg:text-6xl text-foreground mb-6 tracking-tight text-center"
        />
        
        <p className="text-center text-base md:text-lg text-muted-foreground mb-10 max-w-lg leading-relaxed font-light">
          Paste a GitHub URL and start asking questions about the codebase. 
          Answers are grounded in actual source code.
        </p>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="w-full max-w-lg space-y-4">
          <div className="relative group">
            <GitBranch className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors z-10" />
            <AnimatedInput
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              className="w-full pl-12 pr-4 py-4 text-base bg-card/40 backdrop-blur-md border-border/50 text-foreground rounded-2xl"
            />
          </div>
          
          <Button
            type="submit"
            disabled={!url.trim() || isAnalyzing}
            className="w-full mt-4 h-14 rounded-2xl text-base font-semibold"
            variant="solid"
            neon={true}
          >
            {isAnalyzing ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                Cloning & Analyzing…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Search className="w-5 h-5" />
                Analyze Repository
              </span>
            )}
          </Button>
          
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -5 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-destructive text-center bg-destructive/10 py-2 rounded-lg border border-destructive/20"
            >
              {error}
            </motion.p>
          )}
        </form>

        {/* Feature cards */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
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
          ].map((feature, i) => (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 + i * 0.1, duration: 0.5 }}
              key={feature.title}
              className="bg-card/30 backdrop-blur-xl border border-border/40 hover:border-border hover:bg-card/50 transition-all duration-300 rounded-2xl p-5 text-center group"
            >
              <div className="w-10 h-10 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300">
                <feature.icon className="w-5 h-5 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">
                {feature.title}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </SpotlightBackground>
  );
}
