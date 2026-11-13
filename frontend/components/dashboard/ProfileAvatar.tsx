"use client";

/**
 * The account photo, or a stand-in that still says who this is.
 *
 * Google's CDN is the only source for the photo, so it can 404, be blocked by a
 * network, or simply be absent for an account that never set one. Every one of
 * those falls back to initials rather than a broken-image glyph, which is why
 * the failure is tracked here instead of at each call site.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";

interface ProfileAvatarProps {
  avatarUrl: string | null;
  /** Used to derive initials when there is no photo. */
  name: string;
  /** `md` is the dashboard identity block; `sm` the settings header. */
  size?: "md" | "sm";
}

function initialsOf(source: string): string {
  const words = source
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function ProfileAvatar({
  avatarUrl,
  name,
  size = "md",
}: ProfileAvatarProps) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(avatarUrl) && !failed;

  return (
    <span className={cn("db-id__avatar", size === "sm" && "is-sm")}>
      {showPhoto ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={avatarUrl as string}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
    </span>
  );
}

export default ProfileAvatar;
