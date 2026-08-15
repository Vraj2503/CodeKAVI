"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/*
 * This file also held `SmokeyBackground` — ~150 lines of WebGL running a
 * fragment shader behind a login form. Nothing imported it. It also had a
 * live defect: `mousePosition` was in the effect's dependency array while
 * the cleanup never called `cancelAnimationFrame`, so every mouse move
 * would have started an additional, permanent `requestAnimationFrame`
 * loop. Deleted rather than fixed — the lamplight backdrop already
 * carries this screen, and it costs no GPU.
 */

/** Google's mark. Fixed brand colours by definition — not themed. */
function GoogleMark() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039L38.802 8.841C34.553 4.806 29.613 2.5 24 2.5C11.983 2.5 2.5 11.983 2.5 24s9.483 21.5 21.5 21.5S45.5 36.017 45.5 24c0-1.538-.135-3.022-.389-4.417z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12.5 24 12.5c3.059 0 5.842 1.154 7.961 3.039l5.839-5.841C34.553 4.806 29.613 2.5 24 2.5C16.318 2.5 9.642 6.723 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 45.5c5.613 0 10.553-2.306 14.802-6.341l-5.839-5.841C30.842 35.846 27.059 38 24 38c-5.039 0-9.345-2.608-11.124-6.481l-6.571 4.819C9.642 41.277 16.318 45.5 24 45.5z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l5.839 5.841C44.196 35.123 45.5 29.837 45.5 24c0-1.538-.135-3.022-.389-4.417z"
      />
    </svg>
  );
}

export function LoginForm({ next }: { next?: string } = {}) {
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    setAuthError(null);

    // `/auth/callback` already honours `?next=` — this is what finally passes
    // it, so someone who followed a repo link lands back on that link.
    const callback = new URL("/auth/callback", window.location.origin);
    if (next && next !== "/") callback.searchParams.set("next", next);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
      },
    });

    if (error) {
      setAuthError(error.message);
      setIsGoogleLoading(false);
    }
    // If no error, the browser will redirect to Google — no need to reset loading
  };

  return (
    <div className="w-full">
      {authError && (
        <div
          role="alert"
          className="mb-4 border border-crit/40 bg-crit/10 px-3 py-2.5 text-center font-mono text-[12px] text-crit"
        >
          {authError}
        </div>
      )}

      {/*
        One button, no card. The form used to sit in a translucent panel
        with a heading reading "Welcome Back" over "Sign in to continue" —
        two lines saying the same nothing, wrapped in a box that framed a
        single control. The page around it is the frame.
      */}
      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isGoogleLoading}
        className={cn(
          "group flex w-full items-center justify-center gap-3 px-4 py-3",
          "border border-border bg-background/60 font-sans text-[13.5px] font-medium text-foreground",
          "transition-[transform,border-color,background-color] duration-150 ease-out",
          "[@media(hover:hover)]:hover:border-signal/60 [@media(hover:hover)]:hover:bg-signal/[0.07]",
          "active:scale-[0.985] active:duration-100",
          "disabled:pointer-events-none disabled:opacity-60",
        )}
      >
        {isGoogleLoading ? (
          <>
            <Loader2 className="h-[18px] w-[18px] animate-spin" />
            Redirecting to Google
          </>
        ) : (
          <>
            <GoogleMark />
            Continue with Google
          </>
        )}
      </button>

      <p className="mt-6 text-center font-sans text-[11.5px] leading-relaxed text-muted-foreground/75">
        By continuing you agree to the{" "}
        <a
          href="#"
          className="text-muted-foreground underline decoration-border underline-offset-[3px] transition-colors hover:text-foreground hover:decoration-foreground/40"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="#"
          className="text-muted-foreground underline decoration-border underline-offset-[3px] transition-colors hover:text-foreground hover:decoration-foreground/40"
        >
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
