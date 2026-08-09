"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

/**
 * How long to wait for the initial session before assuming signed out.
 * Generous, because a spurious signed-out flash is worse than a slow one —
 * but finite, because `loading` gates the whole app.
 */
const AUTH_INIT_TIMEOUT_MS = 10_000;

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let settled = false;

    const settle = (s: Session | null) => {
      settled = true;
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    };

    // `getSession()` is not a local read: an expired token makes it refresh
    // over the network, so it can reject or hang when Supabase is slow or
    // unreachable. It previously had no `.catch()` and no deadline, which left
    // `loading` true forever — and every consumer that waits on `loading`
    // stalled with it, including the repo pages' "Loading repository data…".
    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => settle(s))
      .catch((e) => {
        console.warn("Auth session lookup failed; continuing signed out:", e);
        settle(null);
      });

    // Backstop for the hang case, which no `.catch()` can reach. Falling back
    // to signed-out is safe: if the session does arrive later,
    // `onAuthStateChange` settles again with the real value.
    const deadline = setTimeout(() => {
      if (!settled) {
        console.warn("Auth session lookup timed out; continuing signed out.");
        settle(null);
      }
    }, AUTH_INIT_TIMEOUT_MS);

    // Listen for auth state changes (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => settle(s));

    return () => {
      clearTimeout(deadline);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
