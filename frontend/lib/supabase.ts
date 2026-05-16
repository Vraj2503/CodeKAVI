import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Lazily initialize the Supabase client.
 * This avoids crashing during SSR/build when env vars aren't set.
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
    _client = createClient(
      "https://placeholder.supabase.co",
      "placeholder-key"
    );
    return _client;
  }

  _client = createClient(url, key);
  return _client;
}

/** Convenience export — lazy accessor */
export const supabase = new Proxy({} as SupabaseClient, {
  get: (_target, prop) => {
    const client = getSupabase();
    return (client as any)[prop];
  },
});
