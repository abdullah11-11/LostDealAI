import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapPaymentLink, getPaymentLinkTransaction, PAYMENT_LINK_UNAVAILABLE } from "@/lib/billing/payment-link";
import { liveCatalog, normalizeLivePaymentTransaction } from "@/supabase/functions/_shared/paddle-live";
const id = `txn_${"t".repeat(26)}`;
const catalog = liveCatalog({ PADDLE_ENVIRONMENT: "live", PADDLE_LIVE_CATALOG_REVISION: "33333333-3333-4333-8333-333333333333",
  PADDLE_STARTER_PRICE_ID: `pri_${"l".repeat(26)}`, PADDLE_PRO_PRICE_ID: `pri_${"p".repeat(26)}`, PADDLE_LIVE_STARTER_PRODUCT_ID: `pro_${"l".repeat(26)}`, PADDLE_LIVE_PRO_PRODUCT_ID: `pro_${"p".repeat(26)}` });
const transaction = () => ({ id, customerId: `ctm_${"l".repeat(26)}`, subscriptionId: `sub_${"l".repeat(26)}`, status: "ready", currencyCode: "USD", collectionMode: "automatic", origin: "subscription_payment_method_change",
  items: [{ quantity: 1, price: { id: catalog.prices.STARTER } }], customData: null });
test("payment-link query requires one bounded exact transaction and ignores unrelated query", () => {
  assert.equal(getPaymentLinkTransaction("?plan=PRO"), null); assert.equal(getPaymentLinkTransaction(`?_ptxn=${id}&plan=PRO`), id);
  for (const search of ["?_ptxn=bad", `?_ptxn=${id}&_ptxn=${id}`, "?_ptxn=", "?_ptxn=" + "x".repeat(4096)]) assert.throws(() => getPaymentLinkTransaction(search), new RegExp(PAYMENT_LINK_UNAVAILABLE));
});
test("absent or malformed payment link never fetches or initializes Paddle", async () => {
  const options = { fetch: (async () => { throw new Error("MUST_NOT_FETCH"); }) as typeof fetch, initialize: async () => { throw new Error("MUST_NOT_INITIALIZE"); } };
  assert.equal(await bootstrapPaymentLink("", options), false); await assert.rejects(bootstrapPaymentLink("?_ptxn=bad", options), new RegExp(PAYMENT_LINK_UNAVAILABLE));
});
for (const [name, response] of Object.entries({ denied: { status: 403, data: {} }, wrongEnvironment: { status: 200, data: { environment: "sandbox", transactionId: id, clientToken: "test_synthetic" } }, wrongTransaction: { status: 200, data: { environment: "live", transactionId: `txn_${"x".repeat(26)}`, clientToken: "live_synthetic" } }, wrongToken: { status: 200, data: { environment: "live", transactionId: id, clientToken: "test_synthetic" } } })) test(`payment-link ${name} cannot initialize provider`, async () => {
  let calls = 0;
  await assert.rejects(bootstrapPaymentLink(`?_ptxn=${id}`, { fetch: (async () => Response.json(response.data, { status: response.status })) as typeof fetch, initialize: async () => { calls++; return {}; } }), new RegExp(PAYMENT_LINK_UNAVAILABLE));
  assert.equal(calls, 0);
});
test("verified payment bootstrap initializes once and cannot open items or grant entitlements", async () => {
  let fetches = 0, initialized = 0;
  assert.equal(await bootstrapPaymentLink(`?_ptxn=${id}`, { fetch: (async (url, options) => {
    fetches++; assert.equal(url, "/api/billing/payment-link"); assert.equal(options?.method, "POST"); assert.equal(options?.body, JSON.stringify({ transactionId: id }));
    return Response.json({ environment: "live", transactionId: id, clientToken: "live_synthetic" });
  }) as typeof fetch, initialize: async (token, environment) => { initialized++; assert.equal(token, "live_synthetic"); assert.equal(environment, "live"); return {}; } }), true);
  assert.equal(fetches, 1); assert.equal(initialized, 1);
});
test("SDK transaction DTO retains only authority fields and supports genuine zero-value method-update origin", () => {
  const proof = normalizeLivePaymentTransaction({ ...transaction(), extra: "private" } as ReturnType<typeof transaction>, id, catalog);
  assert.equal(proof.origin, "subscription_payment_method_change"); assert.equal(proof.price_id, catalog.prices.STARTER); assert.doesNotMatch(JSON.stringify(proof), /extra|private|items|payments|address/);
});
for (const [name, changed] of Object.entries({ paid: { status: "completed" }, missingCustomer: { customerId: null }, wrongCurrency: { currencyCode: "EUR" }, invoice: { collectionMode: "manual" }, unknownOrigin: { origin: "unapproved" }, badSubscription: { subscriptionId: "bad" }, wrongPrice: { items: [{ quantity: 1, price: { id: "pri_01m2mqgrjazqnz7wyex9p7dyt8" } }] }, wrongQuantity: { items: [{ quantity: 2, price: { id: catalog.prices.STARTER } }] }, multipleItems: { items: [{ quantity: 1, price: { id: catalog.prices.STARTER } }, { quantity: 1, price: { id: catalog.prices.PRO } }] } })) test(`provider transaction ${name} fails closed before database proof`, () => {
  assert.throws(() => normalizeLivePaymentTransaction({ ...transaction(), ...changed }, id, catalog), /PAYMENT_LINK_REJECTED/);
});
