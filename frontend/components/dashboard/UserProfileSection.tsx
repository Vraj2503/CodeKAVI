"use client";

/**
 * Who is signed in, and the way in to account settings.
 *
 * In the landing page's world this is display type rather than a card: the
 * name is the loudest thing above the fold after the headline, set in the same
 * face as the marketing page's headings. 48px avatar on a phone, 96 from 860px
 * up — inside the 48–128 range Requirement 4.6 asks for, at both ends.
 */

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ProfileAvatar } from "./ProfileAvatar";

interface UserProfileSectionProps {
  email: string;
  avatarUrl: string | null;
  fullName: string | null;
}

export function UserProfileSection({
  email,
  avatarUrl,
  fullName,
}: UserProfileSectionProps) {
  const name = fullName?.trim() ?? "";
  const address = email?.trim() ?? "";
  const displayName = name || address;

  if (!displayName) {
    return (
      <div className="db-id">
        <ProfileAvatar avatarUrl={null} name="?" />
        <span className="db-id__text">
          <span className="db-err" role="alert">
            Profile information unavailable.
          </span>
        </span>
      </div>
    );
  }

  return (
    <Link href="/settings" className="db-id">
      <ProfileAvatar avatarUrl={avatarUrl} name={displayName} />

      <span className="db-id__text">
        <span className="db-id__name">{displayName}</span>
        <span className="db-id__mail">
          {name && address ? address : "Account settings"}
        </span>
        <span className="db-id__go">
          {name && address ? "Account settings" : "Open settings"}
          <ArrowUpRight size={12} aria-hidden />
        </span>
      </span>
    </Link>
  );
}

export default UserProfileSection;
