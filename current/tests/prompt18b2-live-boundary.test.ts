import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { assertLiveCatalogAuthority, assertLiveProviderPrice, createLiveWebhookHandler, liveCatalog, normalizeLivePaddleEvent } from "@/supabase/functions/_shared/paddle-live";
import { PADDLE_PRICES, createWebhookHandler, normalizePaddleEvent } from "@/supabase/functions/_shared/paddle";
import { planChangeRequest, resolvePaddleBoundary, safePortalUrl, validatePaddleClientToken } from "@/lib/billing/paddle-policy";
import { canCancelBillingPlan, canSelectBillingPlan } from "@/lib/billing/presentation";
import { isPaddleProvider } from "@/lib/billing/provider";
import { applySecurityHeaders } from "@/lib/security/headers";

// Synthetic IDs and signatures only. No provider account, credentials or network.
export const liveEnvironment = { PADDLE_ENVIRONMENT: "live", PADDLE_LIVE_CATALOG_REVISION: "33333333-3333-4333-8333-333333333333",
  PADDLE_STARTER_PRICE_ID: `pri_${"l".repeat(26)}`, PADDLE_PRO_PRICE_ID: `pri_${"p".repeat(26)}`,
  PADDLE_LIVE_STARTER_PRODUCT_ID: `pro_${"l".repeat(26)}`, PADDLE_LIVE_PRO_PRODUCT_ID: `pro_${"p".repeat(26)}` };
const catalog = liveCatalog(liveEnvironment);
const payload = (price = catalog.prices.STARTER) => ({ event_id: `evt_${"a".repeat(26)}`, event_type: "subscription.created", occurred_at: new Date().toISOString(), data: {
  id: `sub_${"a".repeat(26)}`, customer_id: `ctm_${"a".repeat(26)}`, status: "active", items: [{ quantity: 1, price: { id: price } }],
  current_billing_period: { starts_at: "2026-10-01T00:00:00.123456Z", ends_at: "2026-11-01T00:00:00.123457Z" },
  custom_data: { lostdeal_checkout_intent_id: "44444444-4444-4444-8444-444444444444" }, scheduled_change: null,
} });
const secret = "synthetic-live-destination-secret";
const sign = (raw: string, key = secret, seconds = Math.floor(Date.now() / 1000)) => `ts=${seconds};h1=${createHmac("sha256", key).update(`${seconds}:${raw}`).digest("hex")}`;
const request = (raw: string, signature = sign(raw)) => new Request("https://fixture.invalid/live-webhook", { method: "POST", headers: { "content-type": "application/json", "Paddle-Signature": signature }, body: raw });

test("Live catalog requires explicit environment and distinct exact approved pairs", () => {
  assert.equal(resolvePaddleBoundary(liveEnvironment).environment, "live");
  assert.deepEqual(resolvePaddleBoundary({ PADDLE_ENVIRONMENT: "sandbox", PADDLE_STARTER_PRICE_ID: PADDLE_PRICES.STARTER, PADDLE_PRO_PRICE_ID: PADDLE_PRICES.PRO }).prices, PADDLE_PRICES);
});
for (const [key, value] of Object.entries({ PADDLE_ENVIRONMENT: "production", PADDLE_LIVE_CATALOG_REVISION: "", PADDLE_STARTER_PRICE_ID: PADDLE_PRICES.STARTER,
  PADDLE_PRO_PRICE_ID: liveEnvironment.PADDLE_STARTER_PRICE_ID, PADDLE_LIVE_STARTER_PRODUCT_ID: "wrong", PADDLE_LIVE_PRO_PRODUCT_ID: undefined })) {
  test(`Live config rejects invalid ${key}`, () => assert.throws(() => resolvePaddleBoundary({ ...liveEnvironment, [key]: value }), /BILLING_CONFIGURATION_REQUIRED/));
}
test("database capability binds exact catalog despite JSON key order", () => {
  const proof = { version: 1, environment: "live", revision: catalog.revision, prices: { PRO: catalog.prices.PRO, STARTER: catalog.prices.STARTER }, products: catalog.products };
  assert.doesNotThrow(() => assertLiveCatalogAuthority(catalog, proof));
  for (const changed of [null, { ...proof, version: 0 }, { ...proof, environment: "sandbox" }, { ...proof, revision: crypto.randomUUID() }, { ...proof, prices: PADDLE_PRICES }, { ...proof, products: {} }]) assert.throws(() => assertLiveCatalogAuthority(catalog, changed));
});
const price = () => ({ id: catalog.prices.STARTER, productId: catalog.products.STARTER, status: "active", type: "standard", billingCycle: { interval: "month", frequency: 1 }, trialPeriod: null, unitPrice: { amount: "1500", currencyCode: "USD" }, unitPriceOverrides: [] });
for (const [name, changes] of Object.entries({ id: { id: PADDLE_PRICES.STARTER }, product: { productId: catalog.products.PRO }, status: { status: "archived" }, custom: { type: "custom" }, oneTime: { billingCycle: null }, yearly: { billingCycle: { interval: "year", frequency: 1 } }, cadence: { billingCycle: { interval: "month", frequency: 2 } }, trial: { trialPeriod: {} }, amount: { unitPrice: { amount: "15", currencyCode: "USD" } }, currency: { unitPrice: { amount: "1500", currencyCode: "EUR" } }, override: { unitPriceOverrides: [{}] } })) {
  test(`provider metadata ${name} mismatch cannot authorize Live catalog`, () => assert.throws(() => assertLiveProviderPrice(catalog, "STARTER", { ...price(), ...changes }, { id: catalog.products.STARTER, status: "active" })));
}
test("both exact live prices pass provider metadata; archived product fails", () => {
  assert.doesNotThrow(() => assertLiveProviderPrice(catalog, "STARTER", price(), { id: catalog.products.STARTER, status: "active" }));
  assert.doesNotThrow(() => assertLiveProviderPrice(catalog, "PRO", { ...price(), id: catalog.prices.PRO, productId: catalog.products.PRO, unitPrice: { amount: "4500", currencyCode: "USD" } }, { id: catalog.products.PRO, status: "active" }));
  assert.throws(() => assertLiveProviderPrice(catalog, "STARTER", price(), { id: catalog.products.STARTER, status: "archived" }));
});
test("normalization separates catalogs, preserves microseconds and strips customer/payment fields", () => {
  const event = payload();
  const normalized = normalizeLivePaddleEvent({ ...event, data: { ...event.data, payment_method: "private", address: "private" } }, catalog)!;
  assert.equal(normalized.environment, "live"); assert.equal(normalized.catalog_revision, catalog.revision);
  assert.equal(normalized.period_start, "2026-10-01T00:00:00.123456Z");
  assert.doesNotMatch(JSON.stringify(normalized), /payment_method|address|private/);
  assert.throws(() => normalizePaddleEvent(event), /UNKNOWN_PRICE/);
  assert.throws(() => normalizeLivePaddleEvent(payload(PADDLE_PRICES.STARTER), catalog), /UNKNOWN_PRICE/);
  assert.throws(() => normalizeLivePaddleEvent({ ...event, event_id: `ntfsimevt_${"a".repeat(26)}` }, catalog), /INVALID_EVENT/);
  assert.throws(() => normalizeLivePaddleEvent({ ...event, data: { ...event.data, status: "trialing" } }, catalog), /INVALID_STATUS/);
});
test("signed Live event requires correct destination secret before synchronization", async () => {
  let calls = 0;
  const handler = createLiveWebhookHandler({ environment: () => "live", secret: () => secret, catalog: () => catalog, synchronize: async event => { calls++; assert.equal(event.environment, "live"); return "APPLIED"; } });
  const raw = JSON.stringify(payload(), null, 2);
  for (const signature of [sign(raw, "synthetic-sandbox-secret"), sign(raw, secret, Math.floor(Date.now() / 1000) - 10), sign(raw, secret, Math.floor(Date.now() / 1000) + 10), sign(raw) + ";ts=1", "bad"]) assert.equal((await handler(request(raw, signature))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await handler(request(JSON.stringify(JSON.parse(raw)), sign(raw)))).status, 400);
  assert.equal((await handler(request(raw))).status, 200); assert.equal(calls, 1);
});
test("Sandbox and Live receivers reject each other's environment/catalog", async () => {
  let calls = 0;
  const live = createLiveWebhookHandler({ environment: () => "sandbox", secret: () => secret, catalog: () => catalog, synchronize: async () => { calls++; return "APPLIED"; } });
  assert.equal((await live(request(JSON.stringify(payload())))).status, 503);
  const sandbox = createWebhookHandler({ environment: () => "sandbox", secret: () => secret, synchronize: async () => { calls++; return "APPLIED"; } });
  assert.equal((await sandbox(request(JSON.stringify(payload())))).status, 400); assert.equal(calls, 0);
});
test("Live malformed, oversized, missing-secret and database failures expose no private content", async () => {
  const handler = createLiveWebhookHandler({ environment: () => "live", secret: () => secret, catalog: () => catalog, synchronize: async () => { throw new Error("private database details"); } });
  assert.equal((await handler(request("{"))).status, 400);
  assert.equal((await handler(request("x".repeat(262145)))).status, 413);
  const response = await handler(request(JSON.stringify(payload())));
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { result: "DATABASE_FAILURE" });
  const missing = createLiveWebhookHandler({ environment: () => "live", secret: () => undefined, catalog: () => catalog, synchronize: async () => "MUST_NOT_CALL" });
  assert.equal((await missing(request("{}"))).status, 503);
});
test("browser tokens cannot cross environments or use API keys", () => {
  validatePaddleClientToken("test_synthetic", "sandbox"); validatePaddleClientToken("live_synthetic", "live");
  for (const [token, environment] of [["live_synthetic", "sandbox"], ["test_synthetic", "live"], ["pdl_synthetic", "live"], ["", "live"]] as const) assert.throws(() => validatePaddleClientToken(token, environment));
});
test("Live portal allowlist rejects Sandbox, unrelated hosts, ports and credentials", () => {
  assert.equal(safePortalUrl("https://customer-portal.paddle.com/path", "live"), "https://customer-portal.paddle.com/path");
  for (const url of ["https://sandbox-customer-portal.paddle.com/", "https://customer-portal.paddle.com.evil.invalid/", "http://customer-portal.paddle.com/", "https://customer-portal.paddle.com:444/", "https://user@customer-portal.paddle.com/"]) assert.throws(() => safePortalUrl(url, "live"));
});
test("Live account CSP is exact and never permits Sandbox hosts or other routes", () => {
  const csp = applySecurityHeaders(new Response(), "/account", "https:", "live").headers.get("content-security-policy")!;
  assert.match(csp, /https:\/\/buy\.paddle\.com/); assert.match(csp, /https:\/\/api\.paddle\.com/); assert.doesNotMatch(csp, /sandbox|\*\.paddle/);
  assert.doesNotMatch(applySecurityHeaders(new Response(), "/deals", "https:", "live").headers.get("content-security-policy")!, /paddle/);
});
test("Live plan changes preserve existing proration and prevent-change policy", () => {
  assert.deepEqual(planChangeRequest("STARTER", "PRO", catalog.prices), { items: [{ priceId: catalog.prices.PRO, quantity: 1 }], prorationBillingMode: "prorated_immediately", onPaymentFailure: "prevent_change" });
  assert.equal(planChangeRequest("PRO", "STARTER", catalog.prices).prorationBillingMode, "prorated_next_billing_period");
});
for (const status of ["active", "canceled", "past_due", "paused", "incomplete"]) test(`Live ${status} billing presentation preserves lifecycle restrictions`, () => {
  const state = { plan: "STARTER", status, owner: true, sandbox: false, paddle: true, operationPending: false, scheduledAction: null };
  assert.equal(canSelectBillingPlan(state, "PRO"), status === "active" || status === "canceled");
  assert.equal(canCancelBillingPlan(state), status === "active");
  assert.equal(canSelectBillingPlan({ ...state, owner: false }, "PRO"), false);
  assert.equal(canSelectBillingPlan({ ...state, operationPending: true }, "PRO"), false);
});
test("both Paddle providers force provider-backed guards; null Internal remains unclassified", () => {
  assert.equal(isPaddleProvider("paddle_sandbox"), true); assert.equal(isPaddleProvider("paddle_live"), true);
  assert.equal(isPaddleProvider(null), false); assert.equal(isPaddleProvider("INTERNAL"), false);
});
test("actual Site configuration rejects Live authority reuse and malformed keys", () => {
  const code = ts.transpileModule(readFileSync(new URL("../lib/billing/config.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  function configured(live: string, usage: string) {
    const exports: { getLiveBillingAuthoritySecret?: () => string | null } = {};
    new Script(code).runInNewContext({ exports, require: (name: string) => { assert.equal(name, "server-only"); return {}; }, process: { env: { PADDLE_LIVE_BILLING_AUTHORITY_SECRET: live, BILLING_USAGE_AUTHORITY_SECRET: usage } } });
    return exports.getLiveBillingAuthoritySecret!();
  }
  assert.equal(configured("c".repeat(64), "c".repeat(64)), null);
  assert.equal(configured(" " + "C".repeat(64) + " ", "c".repeat(64)), null);
  assert.equal(configured("malformed", "a".repeat(64)), null);
  assert.equal(configured("c".repeat(64), "a".repeat(64)), "c".repeat(64));
});
