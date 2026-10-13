import { BillingError, PADDLE_PRICES, boundedBody, normalizePaddleEvent, verifyPaddleSignature, type BillingEvent, type PaidPlan } from "./paddle.ts";

export type PaddleEnvironment = "sandbox" | "live";
export type LiveCatalog = Readonly<{
  revision: string;
  prices: Readonly<Record<PaidPlan, string>>;
  products: Readonly<Record<PaidPlan, string>>;
}>;
export type LiveBillingEvent = BillingEvent & { environment: "live"; catalog_revision: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function liveCatalog(env: Record<string, string | undefined>): LiveCatalog {
  const revision = env.PADDLE_LIVE_CATALOG_REVISION;
  const prices = { STARTER: env.PADDLE_STARTER_PRICE_ID, PRO: env.PADDLE_PRO_PRICE_ID };
  const products = { STARTER: env.PADDLE_LIVE_STARTER_PRODUCT_ID, PRO: env.PADDLE_LIVE_PRO_PRODUCT_ID };
  if (env.PADDLE_ENVIRONMENT !== "live" || !revision || !uuid.test(revision)
    || !Object.values(prices).every(value => typeof value === "string" && /^pri_[a-z0-9]{26}$/.test(value) && !Object.values(PADDLE_PRICES).some(price => price === value))
    || prices.STARTER === prices.PRO
    || !Object.values(products).every(value => typeof value === "string" && /^pro_[a-z0-9]{26}$/.test(value))) throw new BillingError("BILLING_CONFIGURATION_REQUIRED");
  return Object.freeze({ revision, prices: Object.freeze(prices as Record<PaidPlan, string>), products: Object.freeze(products as Record<PaidPlan, string>) });
}
export function assertLiveCatalogAuthority(catalog: LiveCatalog, value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BillingError("BILLING_CONFIGURATION_REQUIRED");
  const row = value as Record<string, unknown>;
  const prices = row.prices as Record<string, unknown> | undefined;
  const products = row.products as Record<string, unknown> | undefined;
  if (row.version !== 1 || row.environment !== "live" || row.revision !== catalog.revision
    || !prices || !products || Object.keys(prices).length !== 2 || Object.keys(products).length !== 2
    || prices.STARTER !== catalog.prices.STARTER || prices.PRO !== catalog.prices.PRO
    || products.STARTER !== catalog.products.STARTER || products.PRO !== catalog.products.PRO) throw new BillingError("BILLING_CONFIGURATION_REQUIRED");
}
/** Provider-returned SDK fields only. Never accepts checkout/customer/browser claims. */
export function assertLiveProviderPrice(catalog: LiveCatalog, plan: PaidPlan, price: {
  id: string; productId: string; status: string; type: string; billingCycle: { interval: string; frequency: number } | null;
  trialPeriod: unknown; unitPrice: { amount: string; currencyCode: string }; unitPriceOverrides: unknown[];
}, product: { id: string; status: string }): void {
  if (price.id !== catalog.prices[plan] || price.productId !== catalog.products[plan] || product.id !== price.productId
    || price.status !== "active" || product.status !== "active" || price.type !== "standard"
    || price.billingCycle?.interval !== "month" || price.billingCycle.frequency !== 1 || price.trialPeriod !== null
    || price.unitPrice.currencyCode !== "USD" || price.unitPrice.amount !== (plan === "STARTER" ? "1500" : "4500")
    || !Array.isArray(price.unitPriceOverrides) || price.unitPriceOverrides.length !== 0) throw new BillingError("LIVE_CATALOG_REJECTED");
}
export function normalizeLivePaddleEvent(value: unknown, catalog: LiveCatalog): LiveBillingEvent | null {
  const event = normalizePaddleEvent(value, { prices: catalog.prices, allowSimulatorIds: false });
  if (!event) return null;
  // The app owns its trial. Live catalog is recurring paid Starter/Pro only.
  if (event.status === "trialing") throw new BillingError("INVALID_STATUS");
  return { ...event, environment: "live", catalog_revision: catalog.revision };
}
/** Minimal DTO from the authenticated SDK transaction read, never browser data. */
export function normalizeLivePaymentTransaction(value: {
  id: string; customerId: string | null; subscriptionId: string | null; status: string; currencyCode: string; collectionMode: string; origin: string;
  items: { quantity: number; price: { id: string } | null }[]; customData: Record<string, unknown> | null;
}, expectedId: string, catalog: LiveCatalog) {
  const intent = value.customData?.lostdeal_checkout_intent_id;
  if (value.id !== expectedId || !/^txn_[a-z0-9]{26}$/.test(value.id) || !value.customerId || !/^ctm_[a-z0-9]{26}$/.test(value.customerId)
    || (value.subscriptionId !== null && !/^sub_[a-z0-9]{26}$/.test(value.subscriptionId))
    || !["ready", "billed", "past_due"].includes(value.status) || value.currencyCode !== "USD" || value.collectionMode !== "automatic"
    || !["web", "api", "subscription_recurring", "subscription_update", "subscription_payment_method_change"].includes(value.origin)
    || value.items.length !== 1 || value.items[0].quantity !== 1 || !Object.values(catalog.prices).includes(value.items[0].price?.id ?? "")
    || (intent !== undefined && intent !== null && (typeof intent !== "string" || !uuid.test(intent)))) throw new BillingError("PAYMENT_LINK_REJECTED");
  return { environment: "live", catalog_revision: catalog.revision, transaction_id: value.id, customer_id: value.customerId,
    subscription_id: value.subscriptionId, price_id: value.items[0].price!.id, intent_id: typeof intent === "string" ? intent : null,
    status: value.status, currency: value.currencyCode, collection_mode: value.collectionMode, origin: value.origin };
}
export function createLiveWebhookHandler(options: {
  environment: () => string | undefined; secret: () => string | undefined;
  catalog: () => LiveCatalog; synchronize: (event: LiveBillingEvent) => Promise<string>;
}) {
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, result: string) => Response.json({ result }, { status, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "POST") return reply(405, "METHOD_NOT_ALLOWED");
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply(415, "CONTENT_TYPE_INVALID");
    const signature = request.headers.get("Paddle-Signature");
    if (!signature) return reply(400, "INVALID_SIGNATURE");
    const secret = options.secret();
    if (options.environment() !== "live" || !secret) return reply(503, "BILLING_CONFIGURATION_REQUIRED");
    let raw: string;
    try { raw = await boundedBody(request); } catch { return reply(413, "BODY_INVALID"); }
    if (!await verifyPaddleSignature(raw, signature, secret)) return reply(400, "INVALID_SIGNATURE");
    let catalog: LiveCatalog;
    try { catalog = options.catalog(); } catch { return reply(503, "BILLING_CONFIGURATION_REQUIRED"); }
    let event: LiveBillingEvent | null;
    try { event = normalizeLivePaddleEvent(JSON.parse(raw), catalog); }
    catch (error) { return reply(400, error instanceof BillingError ? error.message : "INVALID_EVENT"); }
    if (!event) return reply(200, "IGNORED_EVENT");
    try { return reply(200, await options.synchronize(event)); } catch { return reply(503, "DATABASE_FAILURE"); }
  };
}
