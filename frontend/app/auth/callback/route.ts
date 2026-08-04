import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

/**
 * GET /auth/callback
 *
 * Supabase redirects here after Google OAuth consent.
 * We exchange the `code` query param for a session using the server-side
 * Supabase client (which has access to the PKCE code verifier in cookies),
 * then redirect to "/".
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` arrives from the OAuth round trip, so it is attacker-influenceable:
  // accept only same-origin paths, never an absolute or protocol-relative URL.
  const requestedNext = searchParams.get("next");
  const next =
    requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    console.error("Auth callback error:", error.message);
  }

  // If something went wrong, redirect to login with an error flag
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
