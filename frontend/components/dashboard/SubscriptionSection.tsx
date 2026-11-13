"use client";

/**
 * The plan, and how much of its allowance the history has used.
 *
 * Billing does not exist yet, so this reads `FREE_PLAN` rather than an
 * endpoint — a card that is always "Free / Active" is the truth right now, and
 * a failed request would only ever turn that truth into an error box.
 *
 * The one figure that is real is the count, and it comes from the history
 * beside it. There is deliberately no progress bar: nothing enforces the free
 * plan's allowance, so a bar filling toward a limit that cannot be reached or
 * refused would be a claim the product does not honour. A number is a fact; a
 * bar is a promise.
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { FREE_PLAN } from "@/lib/subscription";

interface SubscriptionSectionProps {
  /**
   * Real count from the history list; the plan itself is fixed. Omitted where
   * the count is not known — settings does not load the history, and a zero
   * would read as "nothing analyzed" rather than "not counted here".
   */
  repositoriesAnalyzed?: number;
}

function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function SubscriptionSection({
  repositoriesAnalyzed,
}: SubscriptionSectionProps) {
  // Even the labels come from the fixed definition, so the card cannot drift
  // from the plan it is describing when the real system replaces it.
  const planLabel = capitalised(FREE_PLAN.planName);
  const statusLabel = capitalised(FREE_PLAN.status);

  return (
    <section className="db-plan" aria-labelledby="plan-heading">
      <div className="db-plan__head">
        <h2 id="plan-heading" className="db-plan__label">
          your plan
        </h2>
        <span className="db-badge">
          <i aria-hidden />
          {statusLabel}
        </span>
      </div>

      <p className="db-plan__name">{planLabel}</p>
      <p className="db-plan__note">
        Billing isn&apos;t live yet — every account is on the free plan.
      </p>

      {typeof repositoriesAnalyzed === "number" && (
        <div className="db-plan__block">
          <div className="db-plan__use">
            <span>In your history</span>
            <b>{Math.max(0, repositoriesAnalyzed)}</b>
          </div>
        </div>
      )}

      <Link href="/settings#plan" className="db-plan__link">
        Plan details
        <ChevronRight size={14} aria-hidden />
      </Link>
    </section>
  );
}

export default SubscriptionSection;
