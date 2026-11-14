/**
 * The plan every account is on.
 *
 * Billing does not exist yet — there is no subscriptions table, no checkout and
 * no webhook — so the dashboard reports one fixed plan rather than fetching a
 * row that would always be missing and rendering an error card in its place.
 *
 * This is the single place to change when the real system lands: swap the
 * constant for query results and the components below it need nothing else.
 * The numbers are the free plan's advertised allowance, which the app does not
 * currently enforce.
 */

import type { Subscription } from "@/lib/types/dashboard";

export const FREE_PLAN: Subscription = {
  id: "free",
  userId: "",
  planName: "free",
  status: "active",
  currentPeriodEnd: null,
  cancelledAt: null,
  trialEndsAt: null,
  usage: {
    repositoriesAnalyzed: 0,
    repositoriesLimit: 10,
    apiCallsUsed: 0,
    apiCallsLimit: 1000,
  },
  createdAt: "",
  updatedAt: "",
};
