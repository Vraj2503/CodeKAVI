import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Creates a Supabase client for use in Client Components.
 * Uses @supabase/ssr's createBrowserClient which stores the PKCE
 * code verifier in cookies (accessible to the server callback route).
 */
export function getSupabase(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (!url || !key) {
    console.warn(
      "⚠️ Supabase env vars not set. Session persistence will be disabled."
    );
    // Return a dummy client that won't crash but won't persist anything
    _client = createBrowserClient(
      "https://placeholder.supabase.co",
      "placeholder-key"
    );
    return _client;
  }

  _client = createBrowserClient(url, key);
  return _client;
}

/** Convenience export — lazy accessor */
export const supabase = new Proxy({} as SupabaseClient, {
  get: (_target, prop) => {
    const client = getSupabase();
    return (client as unknown)[prop];
  },
});
