import type { PlanEntitlements, UsageMetric } from "@/lib/billing/plans";

export type BillingViewState = { plan: string | null; status: string | null; owner: boolean; sandbox: boolean; paddle?: boolean; scheduledAction: string | null; operationPending: boolean };
export function canSelectBillingPlan(state: BillingViewState, target: "STARTER" | "PRO") {
  if (!state.owner || state.operationPending || state.plan === "INTERNAL" || state.plan === "BUSINESS") return false;
  const synchronized = (state.paddle ?? state.sandbox) && state.status !== "canceled";
  return !synchronized || (state.status === "active" && !state.scheduledAction && state.plan !== target);
}
export function canCancelBillingPlan(state: BillingViewState) {
  return state.owner && (state.paddle ?? state.sandbox) && state.status === "active" && !state.scheduledAction && !state.operationPending;
}
export function formatPlanAllowance(plan: PlanEntitlements, metric: UsageMetric) {
  const allowance = plan.usage?.[metric];
  if (allowance === undefined) return "Not available";
  return typeof allowance === "number" ? `${allowance.toLocaleString("en-US")} / period` : "Unlimited";
}
