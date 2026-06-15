"use client";

import { useAuth } from "@/lib/auth-context";
import { BookOpen, LogOut } from "lucide-react";
import ThemeSwitch from "./ui/theme-switch";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function TopNav() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between px-6 border-b border-border/40 bg-card/40 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
          <div className="w-8 h-8 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center glow-pulse">
            <BookOpen className="w-4 h-4 text-primary" />
          </div>
          <h1 className="text-lg font-bold tracking-tight text-foreground">
            CodeKavi
          </h1>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <ThemeSwitch />
        
        {user?.user_metadata?.avatar_url && (
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
      </div>
    </header>
  );
}
