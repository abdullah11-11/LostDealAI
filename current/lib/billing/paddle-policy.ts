import { PADDLE_PRICES, type PaidPlan } from "@/supabase/functions/_shared/paddle";
export { PADDLE_PRICES, type PaidPlan };
export function isPaidPlan(value: unknown): value is PaidPlan { return value === "STARTER" || value === "PRO"; }
export function planChangeRequest(current: unknown, target: PaidPlan) {
  if (!isPaidPlan(current) || current === target) throw new Error("INVALID_PLAN_CHANGE");
  return {
    items: [{ priceId: PADDLE_PRICES[target], quantity: 1 }],
    prorationBillingMode: target === "PRO" ? "prorated_immediately" as const : "prorated_next_billing_period" as const,
    onPaymentFailure: "prevent_change" as const,
  };
}
export function validatePaddleConfig(env: Record<string, string | undefined>) {
  if (env.PADDLE_ENVIRONMENT !== "sandbox" || env.PADDLE_STARTER_PRICE_ID !== PADDLE_PRICES.STARTER || env.PADDLE_PRO_PRICE_ID !== PADDLE_PRICES.PRO) throw new Error("BILLING_CONFIGURATION_REQUIRED");
}
export function safePortalUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "sandbox-customer-portal.paddle.com" || url.username || url.password) throw new Error("PORTAL_INVALID");
  return url.href;
}
