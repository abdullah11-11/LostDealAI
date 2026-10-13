import "server-only";
import { Paddle, Environment, LogLevel } from "@paddle/paddle-node-sdk";
import { resolvePaddleBoundary, type PaddleBoundary } from "@/lib/billing/paddle-policy";
import { assertLiveProviderPrice } from "@/supabase/functions/_shared/paddle-live";
export function paddleServer(boundary: PaddleBoundary = resolvePaddleBoundary(process.env)) {
  const key = process.env.PADDLE_API_KEY;
  if (!key || !new RegExp(`^pdl_${boundary.environment === "sandbox" ? "sdbx" : "live"}_apikey_[a-z0-9]{26}_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{3}$`).test(key)) throw new Error("BILLING_CONFIGURATION_REQUIRED");
  return new Paddle(key, { environment: boundary.environment === "sandbox" ? Environment.sandbox : Environment.production, logLevel: LogLevel.none });
}
/** Read-only provider proof before Live checkout, plan change or reconciliation. */
export async function verifyLiveProviderCatalog(paddle: Paddle, boundary: PaddleBoundary) {
  if (boundary.environment !== "live") return;
  await Promise.all((["STARTER", "PRO"] as const).map(async plan => {
    const [price, product] = await Promise.all([
      boundedPaddleCall(paddle.prices.get(boundary.prices[plan])),
      boundedPaddleCall(paddle.products.get(boundary.catalog.products[plan])),
    ]);
    assertLiveProviderPrice(boundary.catalog, plan, price, product);
  }));
}
// Never retry mutations. A timed-out operation stays locked until a verified
// event or explicit reconciliation determines its outcome.
export async function boundedPaddleCall<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("PADDLE_TIMEOUT")), 10000); })]); }
  finally { clearTimeout(timer); }
}
