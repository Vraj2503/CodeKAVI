"use client";

/**
 * Keep the dashboard honest about who is signed in.
 *
 * `AuthContext` settles once and then only reacts to `onAuthStateChange`, which
 * fires on sign-out and token refresh but *not* when a token is simply rejected
 * elsewhere. Requirement 8.6 asks for a check every five minutes, so this asks
 * the auth server rather than reading local state: `getUser()` validates the
 * JWT with Supabase, where reading `user` from context only reports what the
 * tab last believed.
 *
 * A failed check is treated as signed out. The cost of being wrong is a
 * re-login; the cost of the opposite is a dashboard rendering one user's rows
 * to nobody.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

export const SESSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** Where a bounced dashboard visit should return to. */
export const DASHBOARD_LOGIN_PATH = "/login?next=/dashboard";

export function useSessionVerification() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    // Nothing to verify if the context already knows the session is gone.
    if (!user) {
      router.replace(DASHBOARD_LOGIN_PATH);
      return;
    }

    let cancelled = false;

    const verify = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (cancelled) return;
        if (error || !data.user) {
          router.replace(DASHBOARD_LOGIN_PATH);
        }
      } catch {
        // A network failure is not proof of an expired session — `fetch` can
        // fail while the cookie is perfectly valid. Leave the user where they
        // are and let the next tick decide.
      }
    };

    const interval = setInterval(verify, SESSION_CHECK_INTERVAL_MS);

    // Coming back to a tab after it was suspended is the most likely moment for
    // the session to have expired, and waiting up to five minutes to notice
    // would leave a dead dashboard on screen.
    const onVisible = () => {
      if (document.visibilityState === "visible") void verify();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, loading, router]);
}
