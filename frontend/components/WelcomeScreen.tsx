"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  GitBranch,
  Loader2,
  Search,
  Plus,
  MessageSquare,
  Clock,
  Code2,
  X,
  Sparkles,
  LogOut,
} from "lucide-react";
import { AnimatedInput } from "./ui/AnimatedInput";
import SpotlightBackground from "./ui/spotlight-background";
import { HeroShutterText } from "./ui/HeroShutterText";
import { Button } from "./ui/NeonButton";
import ThemeSwitch from "./ui/theme-switch";
import { cn } from "@/lib/utils";
import { analyzeRepo } from "@/lib/api";
import { createSession, getSessions, type Session } from "@/lib/sessions";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export function WelcomeScreen() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const [url, setUrl] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [showNewChat, setShowNewChat] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      getSessions().then((data) => {
        setSessions(data);
        setLoadingSessions(false);
      });
    }
  }, [user]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || isAnalyzing) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const data = await analyzeRepo(url.trim());
      const session = await createSession({
        repo_id: data.repo_id,
        repo_name: data.repo_name,
        owner: data.owner,
        github_url: data.github_url,
        total_files: data.total_files,
        total_size_formatted: data.total_size_formatted,
        languages: data.languages,
      });

      // Persist analysis data so RepoProvider can hydrate on the next page
      sessionStorage.setItem(`codekavi-repo-${data.repo_id}`, JSON.stringify(data));
      if (session) {
        sessionStorage.setItem(`codekavi-session-${data.repo_id}`, session.id);
      }

      // Navigate to the chat page for this repo
      router.push(`/repo/${data.repo_id}/chat`);
    } catch (err: any) {
      setError(err.message || "Analysis failed");
      toast.error(err.message || "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleResumeSession = (session: Session) => {
    // Store session metadata so RepoProvider can build a partial repoData
    sessionStorage.setItem(`codekavi-session-meta-${session.repo_id}`, JSON.stringify(session));
    sessionStorage.setItem(`codekavi-session-${session.repo_id}`, session.id);
    router.push(`/repo/${session.repo_id}/chat`);
  };

  // Format relative time
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  // Top languages as a short string
  const topLangs = (languages: Record<string, number>) => {
    const sorted = Object.entries(languages)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);
    return sorted.map(([lang]) => lang).join(" · ");
  };

  // Show loading spinner while checking auth
  if (authLoading || !user) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <SpotlightBackground>
      {/* Top bar — user info + theme toggle */}
      <div className="fixed top-6 right-6 z-50 flex items-center gap-3">
        {user.user_metadata?.avatar_url && (
          <img
            src={user.user_metadata.avatar_url}
            alt={user.user_metadata.full_name || "Avatar"}
            className="w-8 h-8 rounded-full border border-border/50"
            referrerPolicy="no-referrer"
          />
        )}
        <button
          onClick={handleSignOut}
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
        </button>
        <ThemeSwitch />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
        className="relative z-10 w-full max-w-4xl px-6 flex flex-col items-center"
      >
        {/* Title */}
        <HeroShutterText
          text="CodeKavi"
          className="text-4xl md:text-5xl lg:text-6xl text-foreground mb-4 tracking-tight text-center"
        />

        <p className="text-center text-base md:text-lg text-muted-foreground mb-12 max-w-lg leading-relaxed font-light">
          Analyze GitHub repositories and chat with your codebase. Answers are
          grounded in actual source code.
        </p>

        {/* Grid: "+ New chat" card + session cards */}
        <div className="w-full">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Recent Chats
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* "+ Create new chat" card */}
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              onClick={() => setShowNewChat(true)}
              className={cn(
                "text-left rounded-2xl p-5 h-40",
                "border-2 border-dashed border-border/50",
                "hover:border-primary/50 hover:bg-card/20",
                "transition-all duration-300 group cursor-pointer",
                "flex flex-col items-center justify-center gap-3"
              )}
            >
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-110 transition-all duration-300">
                <Plus className="w-6 h-6 text-primary" />
              </div>
              <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                Create new chat
              </span>
            </motion.button>

            {/* Loading skeletons */}
            {loadingSessions &&
              [1, 2].map((i) => (
                <div
                  key={i}
                  className="h-40 rounded-2xl bg-card/20 border border-border/30 animate-pulse"
                />
              ))}

            {/* Session cards */}
            <AnimatePresence>
              {sessions.map((session, i) => (
                <motion.button
                  key={session.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 + i * 0.05, duration: 0.3 }}
                  onClick={() => handleResumeSession(session)}
                  className={cn(
                    "text-left rounded-2xl p-5 h-40",
                    "bg-card/30 backdrop-blur-xl border border-border/40",
                    "hover:border-border hover:bg-card/50",
                    "transition-all duration-300 group cursor-pointer",
                    "flex flex-col justify-between"
                  )}
                >
                  <div>
                    <p className="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
                      {session.owner}/{session.repo_name}
                    </p>
                    {topLangs(session.languages) && (
                      <p className="text-xs text-muted-foreground mt-1.5 truncate">
                        {topLangs(session.languages)}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {timeAgo(session.updated_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" />
                      {session.message_count || 0}
                    </span>
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Feature cards */}
        <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
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
              <p className="text-xs text-muted-foreground leading-relaxed">
                {feature.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── "New Chat" Modal ── */}
      <AnimatePresence>
        {showNewChat && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !isAnalyzing && setShowNewChat(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="bg-card border border-border/60 rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                    <Code2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground">
                      New Chat
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Add a GitHub repository to analyze
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => !isAnalyzing && setShowNewChat(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Modal Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative group">
                  <GitBranch className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors z-10" />
                  <AnimatedInput
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://github.com/user/repo"
                    className="w-full pl-12 pr-4 py-4 text-base bg-background/50 border-border/50 text-foreground rounded-xl"
                    autoFocus
                  />
                </div>

                <Button
                  type="submit"
                  disabled={!url.trim() || isAnalyzing}
                  className="w-full h-12 rounded-xl text-sm font-semibold"
                  variant="solid"
                  neon={true}
                >
                  {isAnalyzing ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Cloning & Analyzing…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Search className="w-4 h-4" />
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </SpotlightBackground>
  );
}
