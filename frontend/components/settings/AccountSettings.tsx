"use client";

/**
 * Account settings.
 *
 * Only what the app actually knows: the profile Google sent, how the account
 * signs in, and the plan. Nothing here is editable yet, and there is no
 * control pretending otherwise.
 *
 * Same world as the dashboard — it is one link away from it, and a theme
 * change between two screens of the same product reads as two products.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut } from "lucide-react";
import { BrandMark } from "@/components/dashboard/Brand";
import { ProfileAvatar } from "@/components/dashboard/ProfileAvatar";
import { SubscriptionSection } from "@/components/dashboard/SubscriptionSection";
import { useAuth } from "@/lib/auth-context";
import "@/components/dashboard/dashboard.css";

interface AccountSettingsProps {
  email: string;
  avatarUrl: string | null;
  fullName: string | null;
  provider: string;
  memberSince: string | null;
}

const MEMBER_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="db-def__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function AccountSettings({
  email,
  avatarUrl,
  fullName,
  provider,
  memberSince,
}: AccountSettingsProps) {
  const router = useRouter();
  const { signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.replace("/");
  };

  const displayName = fullName?.trim() || email || "Your account";
  const member = memberSince
    ? MEMBER_FORMAT.format(new Date(memberSince))
    : "Unknown";

  return (
    <div className="db">
      <header className="db-nav">
        <Link
          href="/dashboard"
          className="db-nav__logo"
          aria-label="CodeKAVI dashboard"
        >
          <BrandMark />
          <span>CodeKAVI</span>
        </Link>

        <span className="db-nav__sep" aria-hidden />
        <span className="db-nav__where">account</span>

        <button type="button" className="db-nav__out" onClick={handleSignOut}>
          <LogOut size={13} aria-hidden />
          Sign out
        </button>
      </header>

      <main className="db-main db-main--narrow">
        <Link href="/dashboard" className="db-back">
          <ArrowLeft size={14} aria-hidden />
          Back to dashboard
        </Link>

        <section className="db-account db-in">
          <ProfileAvatar avatarUrl={avatarUrl} name={displayName} size="sm" />
          <div className="db-id__text">
            <h1 className="db-id__name">{displayName}</h1>
            <p className="db-id__mail">{email || "No email on this account"}</p>
          </div>
        </section>

        <div className="db-grid db-grid--settings">
          <section className="db-win" aria-labelledby="account-heading">
            <div className="db-win__bar">
              <h2 id="account-heading">account</h2>
            </div>
            <dl className="db-def">
              <Row label="Email" value={email || "Not provided"} />
              <Row
                label="Signed in with"
                value={provider.charAt(0).toUpperCase() + provider.slice(1)}
              />
              <Row label="Member since" value={member} />
            </dl>
          </section>

          <div id="plan" className="db-anchor">
            <SubscriptionSection />
          </div>
        </div>
      </main>
    </div>
  );
}

export default AccountSettings;
