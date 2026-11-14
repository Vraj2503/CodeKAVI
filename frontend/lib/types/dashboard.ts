/**
 * Dashboard data models.
 *
 * `Session` is not redeclared here — repository history is the existing
 * `sessions` table and its type already lives with its query in
 * `lib/sessions.ts`.
 *
 * `Subscription` describes the shape billing will return. Nothing fetches it
 * yet: the dashboard renders `FREE_PLAN` from `lib/subscription.ts`, and the
 * type exists so the switch to real data is a change of source, not a rewrite.
 */

export type PlanName = "free" | "pro" | "enterprise";

export type SubscriptionStatus = "active" | "expired" | "trial" | "cancelled";

export interface SubscriptionUsage {
  repositoriesAnalyzed: number;
  repositoriesLimit: number;
  apiCallsUsed: number;
  apiCallsLimit: number;
}

export interface Subscription {
  id: string;
  userId: string;
  planName: PlanName;
  status: SubscriptionStatus;
  /** ISO 8601. Null on a free plan, which has no renewal. */
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  trialEndsAt: string | null;
  usage: SubscriptionUsage;
  createdAt: string;
  updatedAt: string;
}
