"use client";

import { useAuth } from "@/lib/auth-context";
import { LogOut, Terminal, ChevronRight } from "lucide-react";
import ThemeSwitch from "./ui/theme-switch";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { Kbd } from "./ui/Kbd";
import { useRepo } from "./RepoProvider";

export function TopNav() {
  const { user, signOut } = useAuth();
  const { repoData } = useRepo();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <header className="flex h-12 flex-shrink-0 items-center gap-2.5 border-b border-border bg-card/70 px-4 backdrop-blur-xl">
      {/*
        The mark was a generic book glyph in a rounded square with a
        box-shadow that pulsed forever — motion with nothing to say,
        running on every frame of every page. A wordmark is more specific
        to this product and one less thing animating.
      */}
      <Link
        href="/"
        className="group flex items-center gap-2"
        aria-label="CodeKavi console"
      >
        <Terminal className="h-4 w-4 text-signal" />
        <span className="font-display text-[14px] text-foreground transition-colors group-hover:text-signal">
          CODEKAVI
        </span>
      </Link>

      {/* Breadcrumb — the repo under observation. This was previously
          only visible inside the sidebar, which collapses. */}
      {repoData && (
        <>
          <ChevronRight
            className="h-3.5 w-3.5 text-muted-foreground/40"
            aria-hidden="true"
          />
          <span className="min-w-0 truncate font-mono text-[12.5px]">
            <span className="text-muted-foreground/60">
              {repoData.owner}/
            </span>
            <span className="text-foreground">{repoData.repo_name}</span>
          </span>
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        <span className="hidden items-center gap-1 md:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>

        <ThemeSwitch />

        {user?.user_metadata?.avatar_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.user_metadata.avatar_url}
            alt={user.user_metadata.full_name || "Your avatar"}
            className="h-6 w-6 border border-border"
            referrerPolicy="no-referrer"
          />
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleSignOut}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut />
        </Button>
      </div>
    </header>
  );
}
