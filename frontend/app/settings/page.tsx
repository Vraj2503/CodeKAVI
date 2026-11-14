import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { AccountSettings } from "@/components/settings/AccountSettings";

/**
 * Account settings — the destination of the dashboard's profile and plan links.
 *
 * Deliberately small: the dashboard is where work happens, and this page exists
 * so a click on your own name goes somewhere true rather than to a 404. It
 * reads the same profile the dashboard already has, and the plan card reads
 * the same fixed free plan, so the two screens cannot disagree.
 */

export const metadata: Metadata = {
  title: "Account — Rune",
};

export const viewport: Viewport = {
  themeColor: "#0C1519",
  colorScheme: "dark",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let user = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) console.warn("Settings auth check failed:", error.message);
    user = data.user;
  } catch (error) {
    console.error("Settings could not verify the session:", error);
  }

  if (!user) redirect("/login?next=/settings");

  const metadata = user.user_metadata ?? {};
  const provider =
    typeof user.app_metadata?.provider === "string"
      ? user.app_metadata.provider
      : "google";

  return (
    <AccountSettings
      email={user.email ?? ""}
      avatarUrl={
        typeof metadata.avatar_url === "string" ? metadata.avatar_url : null
      }
      fullName={
        typeof metadata.full_name === "string" ? metadata.full_name : null
      }
      provider={provider}
      memberSince={user.created_at ?? null}
    />
  );
}
