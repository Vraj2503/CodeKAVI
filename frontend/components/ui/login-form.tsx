"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

/**
 * Sign-in.
 *
 * Previously this shipped a full WebGL fragment shader running an unbounded
 * `requestAnimationFrame` loop behind a glass card — a smoke simulation as the
 * backdrop to a single button. The button is the whole screen's job, so it is
 * now the only thing with weight on it.
 */
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
      options: { redirectTo: callback.toString() },
    });

    if (error) {
      setAuthError(error.message);
      setIsGoogleLoading(false);
    }
    // If no error, the browser redirects to Google — leave the button spinning.
  };

  return (
    <div className="w-full max-w-[22rem]">
      <h1 className="text-2xl font-semibold tracking-[-0.02em]">Sign in</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
        Analyses are saved to your account so you can pick a repository back up
        where you left it.
      </p>

      {authError && (
        <p
          role="alert"
          className="mt-5 rounded-md border border-destructive/25 bg-destructive/8 px-3 py-2 text-[13px] text-destructive"
        >
          {authError}
        </p>
      )}

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={isGoogleLoading}
        className={cn(
          "press mt-6 flex h-11 w-full items-center justify-center gap-3 rounded-lg",
          "bg-foreground text-[14px] font-medium text-background shadow-pop",
          "transition-colors duration-150 ease-out hover:bg-foreground/88",
          "disabled:opacity-50",
        )}
      >
        {isGoogleLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <GoogleGlyph />
            Continue with Google
          </>
        )}
      </button>

      <div className="mt-8 border-t border-border pt-4">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          By continuing you agree to the{" "}
          <a
            href="#"
            className="text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            href="#"
            className="text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
          >
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 48 48" aria-hidden>
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
