"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SpotlightBackground from "@/components/ui/spotlight-background";
import { LoginForm } from "@/components/ui/login-form";
import ThemeSwitch from "@/components/ui/theme-switch";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

/**
 * Where to land after signing in. Only same-origin paths are honoured —
 * anything else (`https://…`, `//evil.example`) would turn the login page into
 * an open redirect.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function LoginContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set when a protected page bounced the user here — send them back to it
  // rather than to the dashboard, which would lose the link they followed.
  const next = safeNext(searchParams.get("next"));

  // Show error toast if redirected with an error
  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "auth_callback_failed") {
      toast.error("Authentication failed. Please try again.");
    }
  }, [searchParams]);

  // Redirect onward if already authenticated
  useEffect(() => {
    if (!loading && user) {
      router.replace(next);
    }
  }, [user, loading, router, next]);

  // Show nothing while checking auth state (prevents flash)
  if (loading || user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        {/* Small and quick. A big slow spinner makes the wait feel longer
            than the same wait behind a small fast one. */}
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary [animation-duration:0.6s]" />
      </div>
    );
  }

  /*
   * Arrival is CSS (`.rise-in` + `--i`), not three nested framer-motion
   * blocks totalling 750ms before the button was usable. CSS animations
   * run off the main thread, so they stay smooth while the Supabase
   * client is still booting — which is exactly when this screen paints.
   */
  return (
    <SpotlightBackground>
      <div className="fixed right-5 top-5 z-50">
        <ThemeSwitch />
      </div>

      <div className="relative z-10 flex min-h-[86vh] w-full flex-col items-center justify-center px-4">
        {/* A single bordered plate, like a nameplate on an instrument. */}
        <div className="relative w-full max-w-[24rem] border border-border bg-card/70 backdrop-blur-xl">
          <span className="reg-mark reg-tl" />
          <span className="reg-mark reg-tr" />
          <span className="reg-mark reg-bl" />
          <span className="reg-mark reg-br" />

          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="eyebrow">authenticate</span>
            <span className="flex items-center gap-1.5">
              <span
                className="live-dot h-1.5 w-1.5 bg-signal"
                aria-hidden="true"
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                ready
              </span>
            </span>
          </div>

          <div className="px-6 py-8">
            <div
              className="rise-in flex items-baseline gap-2.5"
              style={{ "--i": 0 } as React.CSSProperties}
            >
              <h1 className="font-display text-[1.85rem] text-foreground">
                CODEKAVI
              </h1>
              <span
                className="font-mono text-base text-signal"
                aria-hidden="true"
              >
                कवि
              </span>
            </div>

            {/*
              "NotebookLM for GitHub" described the product by naming a
              different product. This says what it does.
            */}
            <p
              className="rise-in mb-8 mt-3 font-sans text-[13px] leading-relaxed text-muted-foreground"
              style={{ "--i": 1 } as React.CSSProperties}
            >
              Every repository explained in plain language, cited line by
              line.
            </p>

            <div
              className="rise-in"
              style={{ "--i": 2 } as React.CSSProperties}
            >
              <LoginForm next={next} />
            </div>
          </div>
        </div>
      </div>
    </SpotlightBackground>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen w-screen flex items-center justify-center bg-background">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
