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
        <div className="rise-in mb-1 flex items-baseline gap-3" style={{ "--i": 0 } as React.CSSProperties}>
          <h1 className="font-display text-[2.9rem] leading-none tracking-[-0.03em] text-foreground">
            CodeKavi
          </h1>
          <span
            className="font-display text-xl leading-none text-primary/70"
            aria-hidden="true"
          >
            कवि
          </span>
        </div>

        {/*
          "NotebookLM for GitHub" described the product by naming a
          different product. This says what it does — and `kavi` means
          poet, which is the actual origin of the name and worth telling
          someone on the one screen where they have time to read it.
        */}
        <p
          className="rise-in mb-11 max-w-[20rem] text-center font-sans text-[13.5px] leading-relaxed text-muted-foreground"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          Every repository explained in plain language, cited line by line.
        </p>

        <div className="rise-in w-full max-w-[22rem]" style={{ "--i": 2 } as React.CSSProperties}>
          <LoginForm next={next} />
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
