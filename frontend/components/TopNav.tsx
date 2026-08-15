"use client";

import { useAuth } from "@/lib/auth-context";
import { LogOut } from "lucide-react";
import ThemeSwitch from "./ui/theme-switch";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";

export function TopNav() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <header className="flex h-14 flex-shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-5 backdrop-blur-xl">
      <Link
        href="/"
        className="group flex items-baseline gap-2.5 rounded-sm"
        aria-label="CodeKavi home"
      >
        {/*
          The mark was a generic book glyph in a rounded square with a
          box-shadow that pulsed forever. A wordmark set in the display
          serif is both more specific to this product and one less thing
          animating on every page. The devanagari is the actual root of
          the name — कवि, "poet" — and doubles as the only piece of the
          identity nobody else's dev tool has.
        */}
        <span className="font-display text-[19px] leading-none text-foreground transition-colors group-hover:text-primary">
          CodeKavi
        </span>
        <span
          className="font-display text-[13px] leading-none text-muted-foreground/70 transition-colors group-hover:text-primary/70"
          aria-hidden="true"
        >
          कवि
        </span>
      </Link>

      <div className="flex items-center gap-1.5">
        <ThemeSwitch />

        {user?.user_metadata?.avatar_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.user_metadata.avatar_url}
            alt={user.user_metadata.full_name || "Your avatar"}
            className="ml-1.5 h-7 w-7 rounded-full ring-1 ring-border"
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
