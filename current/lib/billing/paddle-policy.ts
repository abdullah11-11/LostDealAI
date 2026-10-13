import { PADDLE_PRICES, type PaidPlan } from "@/supabase/functions/_shared/paddle";
import { liveCatalog, type LiveCatalog, type PaddleEnvironment } from "@/supabase/functions/_shared/paddle-live";
export { PADDLE_PRICES, type PaidPlan };
export function isPaidPlan(value: unknown): value is PaidPlan { return value === "STARTER" || value === "PRO"; }
export function planChangeRequest(current: unknown, target: PaidPlan, prices: Readonly<Record<PaidPlan, string>> = PADDLE_PRICES) {
  if (!isPaidPlan(current) || current === target) throw new Error("INVALID_PLAN_CHANGE");
  return {
    items: [{ priceId: prices[target], quantity: 1 }],
    prorationBillingMode: target === "PRO" ? "prorated_immediately" as const : "prorated_next_billing_period" as const,
    onPaymentFailure: "prevent_change" as const,
  };
}
export function validatePaddleConfig(env: Record<string, string | undefined>) {
  if (env.PADDLE_ENVIRONMENT !== "sandbox" || env.PADDLE_STARTER_PRICE_ID !== PADDLE_PRICES.STARTER || env.PADDLE_PRO_PRICE_ID !== PADDLE_PRICES.PRO) throw new Error("BILLING_CONFIGURATION_REQUIRED");
}
export type PaddleBoundary = { environment: "sandbox"; prices: typeof PADDLE_PRICES; catalog: null } | { environment: "live"; prices: LiveCatalog["prices"]; catalog: LiveCatalog };
export function resolvePaddleBoundary(env: Record<string, string | undefined>): PaddleBoundary {
  if (env.PADDLE_ENVIRONMENT === "live") { const catalog = liveCatalog(env); return { environment: "live", prices: catalog.prices, catalog }; }
  validatePaddleConfig(env);
  return { environment: "sandbox", prices: PADDLE_PRICES, catalog: null };
}
export function validatePaddleClientToken(token: unknown, environment: PaddleEnvironment): asserts token is string {
  if (typeof token !== "string" || !new RegExp(`^${environment === "sandbox" ? "test" : "live"}_[a-zA-Z0-9]+$`).test(token)) throw new Error("BILLING_CONFIGURATION_REQUIRED");
}
export function safePortalUrl(value: string, environment: PaddleEnvironment = "sandbox"): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== (environment === "sandbox" ? "sandbox-customer-portal.paddle.com" : "customer-portal.paddle.com") || url.port || url.username || url.password) throw new Error("PORTAL_INVALID");
  return url.href;
}
