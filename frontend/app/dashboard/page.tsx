import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

/**
 * The dashboard's entry point.
 *
 * Authentication is verified here, on the server, before any client code runs.
 * `proxy.ts` refreshes the session cookie on every request but does not decide
 * access, and the old page redirected from inside an effect — which meant a
 * signed-out visitor got the whole dashboard shell, and a flash of it, before
 * being sent away. A server `redirect` sends nothing.
 *
 * Access state is kept in `?next=`, matching what the login page and the OAuth
 * callback already honour, so a bounced visitor lands back here afterwards.
 */

export const metadata: Metadata = {
  title: "Dashboard — Rune",
  description:
    "Your analyzed repositories, your plan, and a field to point Rune at the next one.",
};

/** Per-user content: never prerendered, never shared. */
export const dynamic = "force-dynamic";

// The dashboard has no light mode: it is the landing page's dark world.
export const viewport: Viewport = {
  themeColor: "#0C1519",
  colorScheme: "dark",
};

type SearchParams = Promise<{
  firstTime?: string | string[];
  analyze?: string | string[];
}>;

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  let user = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.warn("Dashboard auth check failed:", error.message);
    }
    user = data.user;
  } catch (error) {
    // A missing env var or an unreachable auth server lands here. Sending the
    // visitor to sign in is the only recovery that can work, and it is also
    // what a genuinely signed-out visitor needs.
    console.error("Dashboard could not verify the session:", error);
  }

  if (!user) {
    /*
     * The bounce carries `?analyze=` with it. The landing page hands a
     * repository over in that parameter, and a signed-out visitor who came
     * from there would otherwise have to type the URL again after signing in —
     * the one thing the handoff exists to avoid. `next` is honoured by both the
     * login page and `/auth/callback`, and both only accept same-origin paths.
     */
    const analyze = firstValue(params.analyze);
    const target = analyze
      ? `/dashboard?analyze=${encodeURIComponent(analyze)}`
      : "/dashboard";
    redirect(`/login?next=${encodeURIComponent(target)}`);
  }

  const metadata = user.user_metadata ?? {};

  return (
    <DashboardClient
      userId={user.id}
      userEmail={user.email ?? ""}
      userAvatarUrl={
        typeof metadata.avatar_url === "string" ? metadata.avatar_url : null
      }
      userFullName={
        typeof metadata.full_name === "string" ? metadata.full_name : null
      }
      isFirstTime={firstValue(params.firstTime) === "true"}
      initialAnalyzeUrl={firstValue(params.analyze)}
    />
  );
}
