import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { postgresFixture, fixtureSecret, orgA, orgB, userA, userB } from "./helpers/postgres-fixture";
import { serverHarness } from "./helpers/prompt18b-server-harness";
import { billingHarness } from "./helpers/prompt18b2-billing-harness";

// Entirely in-memory PostgreSQL; draft is never a persistent migration.
// PGlite queues one connection: Promise races below are duplicate-call behavior,
// not independent-session lock/deadlock or actual provider-delivery proof.
const authority = "c".repeat(64);
const revision = "33333333-3333-4333-8333-333333333333";
const prices = { STARTER: `pri_${"l".repeat(26)}`, PRO: `pri_${"p".repeat(26)}` };
const subscription = `sub_${"l".repeat(26)}`, customer = `ctm_${"l".repeat(26)}`;
let originalFunctions: Record<string, unknown>[] = [];
const ready = (async () => {
  const db = await postgresFixture();
  await db.exec("reset role");
  await db.exec("create or replace function private.assert_billing_authority(secret text) returns void language plpgsql security definer set search_path='' as $$ begin if secret is distinct from 'prompt17-fixture-authority' then raise exception 'AUTHORITY_REJECTED' using errcode='42501'; end if; end $$;");
  originalFunctions = (await db.query<Record<string, unknown>>("select n.nspname||'.'||p.proname as name,pg_get_functiondef(p.oid) as body,p.proacl::text as acl,p.proowner::int as owner,p.proconfig::text as config,p.prosecdef as definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.prokind='f'")).rows;
  await db.exec(readFileSync(new URL("../docs/live-activation/authority-review-draft.sql", import.meta.url), "utf8"));
  await db.query("update private.paddle_live_settings set enabled=true,authority_sha256=encode(extensions.digest($1,'sha256'),'hex'),catalog_revision=$2", [authority, revision]);
  await db.query("insert into private.paddle_live_catalog(revision,plan_code,price_id,product_id,amount,currency,interval_unit,frequency) values($1,'STARTER',$2,$3,1500,'USD','month',1),($1,'PRO',$4,$5,4500,'USD','month',1)", [revision, prices.STARTER, `pro_${"l".repeat(26)}`, prices.PRO, `pro_${"p".repeat(26)}`]);
  await db.exec("update public.organization_subscriptions set plan_code='TRIAL',subscription_status='trialing',provider=null,provider_customer_id=null,provider_subscription_id=null;set role authenticated;set request.jwt.claim.sub='" + userA + "';");
  return db;
})();
after(async () => (await ready).close());
async function isolated(run: (db: PGlite) => Promise<void>) { const db = await ready; await db.exec("begin"); try { await run(db); } finally { await db.exec("rollback"); } }
async function rejected(db: PGlite, sql: string, params: unknown[], pattern: RegExp) {
  await db.exec("savepoint expected_rejection");
  try { await assert.rejects(db.query(sql, params), pattern); } finally { await db.exec("rollback to savepoint expected_rejection;release savepoint expected_rejection"); }
}
async function inspect(db: PGlite, sql: string, args: unknown[] = []) { await db.exec("reset role"); try { return (await db.query<Record<string, unknown>>(sql, args)).rows; } finally { await db.exec("set role authenticated"); } }
async function intent(db: PGlite, plan = "STARTER", org = orgA) { return (await db.query<{ result: { intentId: string; priceId: string } }>("select public.create_live_billing_checkout_intent($1,$2,$3) as result", [authority, org, plan])).rows[0].result; }
function event(intentId: string | null, extra: Record<string, unknown> = {}) { return { environment: "live", catalog_revision: revision,
  event_id: `evt_${"a".repeat(26)}`, event_type: "subscription.created", occurred_at: "2026-10-01T00:00:00.000001Z",
  subscription_id: subscription, customer_id: customer, price_id: prices.STARTER, status: "active", intent_id: intentId,
  period_start: "2026-10-01T00:00:00Z", period_end: "2026-11-01T00:00:00Z", scheduled_action: null, scheduled_at: null, ...extra }; }
async function sync(db: PGlite, payload: Record<string, unknown>, expected: string | null = null) { return (await db.query<{ result: string }>("select public.synchronize_paddle_live_subscription($1,$2::jsonb,$3) as result", [authority, JSON.stringify(payload), expected])).rows[0].result; }
async function activated(db: PGlite, plan = "STARTER") { const i = await intent(db, plan); const e = event(i.intentId, { price_id: prices[plan as "STARTER" | "PRO"] }); assert.equal(await sync(db, e), "APPLIED"); return e; }
async function state(db: PGlite) { return (await inspect(db, "select to_jsonb(s) as s from public.organization_subscriptions s where organization_id=$1", [orgA]))[0].s as Record<string, unknown>; }

test("Live draft changes only four reviewed legacy predicates and preserves every legacy ACL/owner/security setting", () => isolated(async db => {
  const current = await inspect(db, "select n.nspname||'.'||p.proname as name,pg_get_functiondef(p.oid) as body,p.proacl::text as acl,p.proowner::int as owner,p.proconfig::text as config,p.prosecdef as definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.prokind='f'");
  const replacements: Record<string, [string, string]> = {
    "public.persist_deal_import": ["provider='paddle_sandbox'", "provider in ('paddle_sandbox','paddle_live')"],
    "public.claim_analysis_run": ["sub.provider='paddle_sandbox'", "sub.provider in ('paddle_sandbox','paddle_live')"],
    "public.create_billing_checkout_intent": ["if not found or s.plan_code='INTERNAL'", "if not found or s.provider='paddle_live' or s.plan_code='INTERNAL'"],
    "public.synchronize_paddle_subscription": ["elsif i.consumed_at is not null then", "elsif s.provider='paddle_live' then outcome:='SUBSCRIPTION_CONFLICT'; elsif i.consumed_at is not null then"],
  };
  for (const old of originalFunctions) {
    const replacement = replacements[String(old.name)];
    const expected = { ...old, body: replacement ? String(old.body).replace(...replacement) : old.body };
    assert.deepEqual(current.find(row => row.name === old.name), expected, String(old.name));
  }
}));
test("unreviewed legacy function body aborts complete Live draft with no partial installation", async () => {
  const db = await postgresFixture();
  try {
    await db.exec("reset role");
    const old = (await db.query<{ body: string }>("select pg_get_functiondef('public.claim_analysis_run(text,uuid,uuid,text,uuid)'::regprocedure) as body")).rows[0].body;
    const changed = old.replace("\nbegin\n", "\nbegin\n-- unreviewed isolated change\n"); assert.notEqual(changed, old); await db.exec(changed);
    await assert.rejects(db.exec(readFileSync(new URL("../docs/live-activation/authority-review-draft.sql", import.meta.url), "utf8")), /LIVE_USAGE_EXTENSION_PRECONDITION_FAILED/);
    await db.exec("rollback");
    assert.equal((await db.query<{ relation: unknown }>("select to_regclass('private.paddle_live_settings') as relation")).rows[0].relation, null);
  } finally { await db.close(); }
});
test("existing Sandbox checkout/event/lifecycle remains available after isolated draft adoption", () => isolated(async db => {
  const i = (await db.query<{ result: { intentId: string; priceId: string } }>("select public.create_billing_checkout_intent($1,$2,'STARTER') as result", [fixtureSecret, orgA])).rows[0].result;
  assert.equal(i.priceId, "pri_01m2mqgrjazqnz7wyex9p7dyt8");
  const e = event(i.intentId, { price_id: i.priceId, event_id: `ntfsimevt_${"s".repeat(26)}`, subscription_id: `sub_${"s".repeat(26)}` });
  const query = "select public.synchronize_paddle_subscription($1,$2::jsonb) as result";
  assert.equal((await db.query<{ result: string }>(query, [fixtureSecret, JSON.stringify(e)])).rows[0].result, "APPLIED");
  assert.equal((await state(db)).provider, "paddle_sandbox");
  assert.equal((await db.query<{ result: string }>(query, [fixtureSecret, JSON.stringify(e)])).rows[0].result, "DUPLICATE_EVENT");
  assert.equal((await db.query<{ result: string }>(query, [fixtureSecret, JSON.stringify({ ...e, event_id: `evt_${"t".repeat(26)}`, event_type: "subscription.past_due", status: "past_due", occurred_at: "2026-10-02T00:00:00Z" })])).rows[0].result, "APPLIED");
  assert.equal((await state(db)).subscription_status, "past_due");
}));

test("Live draft installs disabled by default and grants no private schema/table client access", () => isolated(async db => {
  assert.equal((await inspect(db, "select has_schema_privilege('anon','private','USAGE') as anon,has_schema_privilege('authenticated','private','USAGE') as authenticated"))[0].anon, false);
  for (const table of ["paddle_live_settings", "paddle_live_catalog", "paddle_live_checkout_intents", "paddle_live_event_receipts"]) {
    const flags = (await inspect(db, "select c.relrowsecurity as rls,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=$1", [table]))[0];
    assert.deepEqual(flags, { rls: true, anon: false, authenticated: false });
  }
  await inspect(db, "update private.paddle_live_settings set enabled=false");
  await rejected(db, "select public.get_live_billing_configuration($1)", [authority], /LIVE_AUTHORITY_REJECTED/);
}));
test("Live authority cannot be forged, substituted with Sandbox authority or omit complete catalog", () => isolated(async db => {
  for (const key of ["", fixtureSecret, "d".repeat(64)]) await rejected(db, "select public.get_live_billing_configuration($1)", [key], /LIVE_AUTHORITY_REJECTED/);
  await inspect(db, "delete from private.paddle_live_catalog where plan_code='PRO'");
  await rejected(db, "select public.get_live_billing_configuration($1)", [authority], /LIVE_CATALOG_REQUIRED/);
}));
test("accidentally reused Sandbox authority is rejected even when Live digest is configured", () => isolated(async db => {
  await inspect(db, "create or replace function private.assert_billing_authority(secret text) returns void language plpgsql security definer set search_path='' as $$ begin if secret is distinct from repeat('c',64) then raise exception 'AUTHORITY_REJECTED' using errcode='42501'; end if; end $$;");
  await rejected(db, "select public.get_live_billing_configuration($1)", [authority], /LIVE_AUTHORITY_REJECTED/);
  assert.equal((await inspect(db, "select count(*)::int as n from private.paddle_live_checkout_intents"))[0].n, 0);
}));
test("unexpected Sandbox verifier permission failure remains closed instead of proving distinct authority", () => isolated(async db => {
  await inspect(db, "create or replace function private.assert_billing_authority(secret text) returns void language plpgsql security definer set search_path='' as $$ begin raise exception 'unexpected verifier permission failure' using errcode='42501'; end $$;");
  await rejected(db, "select public.get_live_billing_configuration($1)", [authority], /unexpected verifier permission failure/);
  assert.equal((await inspect(db, "select count(*)::int as n from private.paddle_live_checkout_intents"))[0].n, 0);
}));
test("Live intent is exact, owner authorized, reused once and conflicting selection rejected", () => isolated(async db => {
  const i = await intent(db); assert.equal(i.priceId, prices.STARTER); assert.deepEqual(await intent(db), i);
  await rejected(db, "select public.create_live_billing_checkout_intent($1,$2,'PRO')", [authority, orgA], /CHECKOUT_PENDING/);
  await rejected(db, "select public.create_live_billing_checkout_intent($1,$2,'BUSINESS')", [authority, orgA], /UNKNOWN_PRICE/);
  await rejected(db, "select public.create_live_billing_checkout_intent($1,$2,'STARTER')", [authority, orgB], /BILLING_OWNER_REQUIRED/);
  await db.exec("set role anon"); await rejected(db, "select public.create_live_billing_checkout_intent($1,$2,'STARTER')", [authority, orgA], /permission denied/);
}));
for (const provider of ["paddle_sandbox", "other"]) test(`Live checkout never reclassifies ${provider} tenant even canceled`, () => isolated(async db => {
  await inspect(db, "update public.organization_subscriptions set provider=$1,plan_code='STARTER',subscription_status='canceled' where organization_id=$2", [provider, orgA]);
  const before = await state(db); await rejected(db, "select public.create_live_billing_checkout_intent($1,$2,'STARTER')", [authority, orgA], /SUBSCRIPTION_CONFLICT/); assert.deepEqual(await state(db), before);
}));
for (const plan of ["INTERNAL", "BUSINESS"]) test(`Live checkout preserves ${plan}`, () => isolated(async db => {
  await inspect(db, "update public.organization_subscriptions set plan_code=$1,subscription_status='active' where organization_id=$2", [plan, orgA]);
  const before = await state(db); await rejected(db, "select public.create_live_billing_checkout_intent($1,$2,'STARTER')", [authority, orgA], /CHECKOUT_UNAVAILABLE/); assert.deepEqual(await state(db), before);
}));
test("Live initial event activates correct plan without changing trial, period anchors, usage or other tenant", () => isolated(async db => {
  const before = await state(db); const other = await inspect(db, "select to_jsonb(s) as s from public.organization_subscriptions s where organization_id=$1", [orgB]);
  await activated(db, "PRO"); const after = await state(db);
  assert.equal(after.provider, "paddle_live"); assert.equal(after.plan_code, "PRO"); assert.equal(after.subscription_status, "active");
  for (const key of ["trial_ends_at", "current_period_start", "current_period_end"]) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(await inspect(db, "select to_jsonb(s) as s from public.organization_subscriptions s where organization_id=$1", [orgB]), other);
  assert.equal((await inspect(db, "select count(*)::int as n from public.organization_usage_events"))[0].n, 0);
}));
test("Live duplicate calls and same event-ID across Sandbox receipts remain isolated", () => isolated(async db => {
  const i = await intent(db); const e = event(i.intentId);
  await inspect(db, "insert into public.billing_event_receipts(event_id,event_type,occurred_at,subscription_id,outcome) values($1,'subscription.created',$2,$3,'APPLIED')", [e.event_id, e.occurred_at, e.subscription_id]);
  assert.deepEqual(await Promise.all([sync(db, e), sync(db, e)]), ["APPLIED", "DUPLICATE_EVENT"]);
  assert.equal((await inspect(db, "select count(*)::int as n from private.paddle_live_event_receipts"))[0].n, 1);
  assert.equal((await inspect(db, "select count(*)::int as n from public.billing_event_receipts"))[0].n, 1);
}));
test("Live event ordering preserves provider microseconds and rejects equal/stale events", () => isolated(async db => {
  const first = await activated(db);
  for (const occurred of ["2026-10-01T00:00:00.000000Z", first.occurred_at]) assert.equal(await sync(db, event(null, { event_id: `evt_${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`, occurred_at: occurred, price_id: prices.PRO })), "STALE_EVENT");
  assert.equal(await sync(db, event(null, { event_id: `evt_${"b".repeat(26)}`, occurred_at: "2026-10-01T00:00:00.000002Z", price_id: prices.PRO })), "APPLIED");
  assert.equal((await state(db)).plan_code, "PRO");
}));
for (const [name, change] of Object.entries({ environment: { environment: "sandbox" }, revision: { catalog_revision: crypto.randomUUID() }, simulator: { event_id: `ntfsimevt_${"a".repeat(26)}` }, subscription: { subscription_id: "bad" }, scheduledPair: { scheduled_action: "cancel" }, future: { occurred_at: "2099-01-01T00:00:00Z" } })) test(`Live authority rejects malformed ${name} before writes`, () => isolated(async db => {
  const i = await intent(db); const before = await state(db);
  await rejected(db, "select public.synchronize_paddle_live_subscription($1,$2::jsonb)", [authority, JSON.stringify(event(i.intentId, change))], /INVALID_EVENT/); assert.deepEqual(await state(db), before);
  assert.equal((await inspect(db, "select count(*)::int as n from private.paddle_live_event_receipts"))[0].n, 0);
}));
test("Live missing, expired, consumed and wrong-price intents cannot authorize a subscription", () => isolated(async db => {
  assert.equal(await sync(db, event(null)), "MISSING_CHECKOUT_INTENT");
  const i = await intent(db); await inspect(db, "update private.paddle_live_checkout_intents set expires_at=clock_timestamp()-interval '1 second' where id=$1", [i.intentId]);
  assert.equal(await sync(db, event(i.intentId, { event_id: `evt_${"b".repeat(26)}` })), "EXPIRED_CHECKOUT_INTENT");
  await inspect(db, "update private.paddle_live_checkout_intents set expires_at=clock_timestamp()+interval '1 minute',consumed_at=clock_timestamp() where id=$1", [i.intentId]);
  assert.equal(await sync(db, event(i.intentId, { event_id: `evt_${"c".repeat(26)}` })), "CONSUMED_CHECKOUT_INTENT");
  await inspect(db, "update private.paddle_live_checkout_intents set consumed_at=null where id=$1", [i.intentId]);
  assert.equal(await sync(db, event(i.intentId, { event_id: `evt_${"d".repeat(26)}`, price_id: prices.PRO })), "PLAN_PRICE_MISMATCH");
  assert.equal((await state(db)).provider, null);
}));
test("Live intent cannot bind a tenant that became Sandbox before event delivery", () => isolated(async db => {
  const i = await intent(db); await inspect(db, "update public.organization_subscriptions set provider='paddle_sandbox',plan_code='STARTER',subscription_status='canceled' where organization_id=$1", [orgA]);
  const before = await state(db); assert.equal(await sync(db, event(i.intentId)), "SUBSCRIPTION_CONFLICT"); assert.deepEqual(await state(db), before);
}));
test("Sandbox intent and event cannot reclassify Live canceled workspace", () => isolated(async db => {
  // A historical pending Sandbox intent before a future Live binding cannot cross.
  const i = (await db.query<{ result: { intentId: string } }>("select public.create_billing_checkout_intent($1,$2,'STARTER') as result", [fixtureSecret, orgA])).rows[0].result;
  await activated(db); await inspect(db, "update public.organization_subscriptions set subscription_status='canceled' where organization_id=$1", [orgA]);
  const before = await state(db);
  await rejected(db, "select public.create_billing_checkout_intent($1,$2,'STARTER')", [fixtureSecret, orgA], /CHECKOUT_UNAVAILABLE/);
  const sandboxEvent = event(i.intentId, { price_id: "pri_01m2mqgrjazqnz7wyex9p7dyt8", event_id: `evt_${"s".repeat(26)}`, subscription_id: `sub_${"s".repeat(26)}` });
  const result = (await db.query<{ result: string }>("select public.synchronize_paddle_subscription($1,$2::jsonb) as result", [fixtureSecret, JSON.stringify(sandboxEvent)])).rows[0].result;
  assert.equal(result, "SUBSCRIPTION_CONFLICT"); assert.deepEqual(await state(db), before);
}));
test("Live canceled subscription cannot resurrect via newer event; a fresh Live checkout can resubscribe", () => isolated(async db => {
  await activated(db); assert.equal(await sync(db, event(null, { event_id: `evt_${"b".repeat(26)}`, event_type: "subscription.canceled", status: "canceled", occurred_at: "2026-10-02T00:00:00Z" })), "APPLIED");
  assert.equal(await sync(db, event(null, { event_id: `evt_${"c".repeat(26)}`, occurred_at: "2026-10-03T00:00:00Z" })), "INVALID_STATUS");
  const i = await intent(db, "PRO"); assert.equal(await sync(db, event(i.intentId, { event_id: `evt_${"d".repeat(26)}`, subscription_id: `sub_${"n".repeat(26)}`, price_id: prices.PRO, occurred_at: "2026-10-04T00:00:00Z" })), "APPLIED");
  assert.equal((await state(db)).plan_code, "PRO");
}));
test("Live customer mismatch and unknown catalog price never update entitlements", () => isolated(async db => {
  await activated(db); const before = await state(db);
  assert.equal(await sync(db, event(null, { event_id: `evt_${"b".repeat(26)}`, occurred_at: "2026-10-02T00:00:00Z", customer_id: `ctm_${"x".repeat(26)}` })), "SUBSCRIPTION_CONFLICT");
  assert.equal(await sync(db, event(null, { event_id: `evt_${"c".repeat(26)}`, occurred_at: "2026-10-03T00:00:00Z", price_id: "pri_01m2mqgrjazqnz7wyex9p7dyt8" })), "UNKNOWN_PRICE");
  assert.deepEqual(await state(db), before);
}));
for (const status of ["past_due", "paused", "canceled"]) test(`Live ${status} denies server spend and SQL import/claim under SHADOW`, () => isolated(async db => {
  await activated(db, "PRO"); assert.equal(await sync(db, event(null, { event_id: `evt_${"b".repeat(26)}`, occurred_at: "2026-10-02T00:00:00Z", status, price_id: prices.PRO })), "APPLIED");
  const harness = serverHarness(db, "SHADOW"); const reservation = await harness.usage.reserveOrganizationUsage(harness.client as never, orgA, "AI_ANALYSES", 1, "isolated-live");
  assert.equal(reservation.allowed, false); assert.equal(reservation.mode, "ENFORCED");
  const row = [{ external_deal_id: "isolated", customer_name: "Synthetic", deal_value: "10", quote_date: "2026-10-01", sales_notes: "Postponed", transcript: null }];
  await rejected(db, "select public.persist_deal_import($1,$2,$3,$4,'synthetic.csv',1,0,$5::jsonb,false)", [fixtureSecret, orgA, crypto.randomUUID(), "a".repeat(64), JSON.stringify(row)], /IMPORT_QUOTA_EXCEEDED/);
  assert.equal((await db.query<{ result: boolean }>("select public.claim_analysis_run($1,$2,$3,'STANDARD',$4) as result", [fixtureSecret, orgA, crypto.randomUUID(), crypto.randomUUID()])).rows[0].result, false);
  assert.equal((await inspect(db, "select count(*)::int as n from public.organization_usage_events"))[0].n, 0);
}));
test("Live scheduled cancellation retains active access and releases exact pending cancel operation", () => isolated(async db => {
  await activated(db);
  await db.query("select public.begin_live_billing_operation($1,$2,'cancel')", [authority, orgA]);
  assert.equal(await sync(db, event(null, { event_id: `evt_${"b".repeat(26)}`, occurred_at: "2026-10-02T00:00:00Z", scheduled_action: "cancel", scheduled_at: "2026-11-01T00:00:00Z" })), "APPLIED");
  const s = await state(db); assert.equal(s.subscription_status, "active"); assert.equal(s.cancel_at_period_end, true); assert.equal(s.billing_operation_id, null);
  await rejected(db, "select public.begin_live_billing_operation($1,$2,'PRO')", [authority, orgA], /BILLING_OPERATION_PENDING/);
}));
test("Live exact operation token and owner are required to release definitive rejection", () => isolated(async db => {
  await activated(db);
  const token = (await db.query<{ result: string }>("select public.begin_live_billing_operation($1,$2,'PRO') as result", [authority, orgA])).rows[0].result;
  assert.equal((await db.query<{ result: boolean }>("select public.abort_live_billing_operation($1,$2,$3) as result", [authority, orgA, crypto.randomUUID()])).rows[0].result, false);
  await db.exec("set request.jwt.claim.sub='" + userB + "'"); await rejected(db, "select public.abort_live_billing_operation($1,$2,$3)", [authority, orgA, token], /BILLING_OWNER_REQUIRED/);
  await db.exec("set request.jwt.claim.sub='" + userA + "'");
  assert.equal((await db.query<{ result: boolean }>("select public.abort_live_billing_operation($1,$2,$3) as result", [authority, orgA, token])).rows[0].result, true);
  assert.equal((await state(db)).billing_operation_id, null);
}));
test("Live reconciliation requires owner, matching last-event CAS and elapsed operation cooldown", () => isolated(async db => {
  const first = await activated(db); await db.query("select public.begin_live_billing_operation($1,$2,'PRO')", [authority, orgA]);
  const e = event(null, { event_id: `evt_${"r".repeat(26)}`, event_type: "reconciliation", occurred_at: "2026-10-02T00:00:00Z", price_id: prices.PRO });
  assert.equal(await sync(db, e, first.event_id), "RECONCILE_CONFLICT");
  await inspect(db, "update public.organization_subscriptions set billing_operation_started_at=clock_timestamp()-interval '3 minutes' where organization_id=$1", [orgA]);
  assert.equal(await sync(db, { ...e, event_id: `evt_${"s".repeat(26)}` }, "wrong"), "RECONCILE_CONFLICT");
  await db.exec("set request.jwt.claim.sub='" + userB + "'"); await rejected(db, "select public.synchronize_paddle_live_subscription($1,$2::jsonb,$3)", [authority, JSON.stringify({ ...e, event_id: `evt_${"t".repeat(26)}` }), first.event_id], /BILLING_OWNER_REQUIRED/);
  await db.exec("set request.jwt.claim.sub='" + userA + "'"); assert.equal(await sync(db, { ...e, event_id: `evt_${"u".repeat(26)}` }, first.event_id), "APPLIED");
  assert.equal((await state(db)).plan_code, "PRO"); assert.equal((await state(db)).billing_operation_id, null);
}));

const appEnvironment = () => ({ PADDLE_ENVIRONMENT: "live", PADDLE_LIVE_CATALOG_REVISION: revision,
  PADDLE_STARTER_PRICE_ID: prices.STARTER, PADDLE_PRO_PRICE_ID: prices.PRO,
  PADDLE_LIVE_STARTER_PRODUCT_ID: `pro_${"l".repeat(26)}`, PADDLE_LIVE_PRO_PRODUCT_ID: `pro_${"p".repeat(26)}`,
  PADDLE_API_KEY: "pdl_" + "live_apikey_" + "a".repeat(26) + "_" + "b".repeat(22) + "_" + "c".repeat(3),
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "live_synthetic", PADDLE_CHECKOUT_ENABLED: "true" });
const providerPrice = (plan: "STARTER" | "PRO") => ({ id: prices[plan], product_id: `pro_${(plan === "STARTER" ? "l" : "p").repeat(26)}`, type: "standard", status: "active", billing_cycle: { interval: "month", frequency: 1 }, trial_period: null,
  unit_price: { amount: plan === "STARTER" ? "1500" : "4500", currency_code: "USD" }, unit_price_overrides: [], quantity: { minimum: 1, maximum: 1 } });
async function providerStub(run: (calls: { path: string; method: string; body: unknown }[]) => Promise<void>, options: { wrongAmount?: boolean; mutation?: "reject" | "ambiguous"; wrongCustomer?: boolean; portalHost?: string; transaction?: Record<string, unknown> } = {}) {
  const previous = globalThis.fetch; const calls: { path: string; method: string; body: unknown }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://api.paddle.com");
    const method = init?.method ?? "GET"; const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: url.pathname, method, body });
    const plan = url.pathname.endsWith(prices.PRO) || url.pathname.endsWith(`pro_${"p".repeat(26)}`) ? "PRO" : "STARTER";
    let data: unknown;
    if (url.pathname.startsWith("/prices/")) { data = providerPrice(plan); if (options.wrongAmount) (data as { unit_price: { amount: string } }).unit_price.amount = "1"; }
    else if (url.pathname.startsWith("/products/")) data = { id: `pro_${(plan === "STARTER" ? "l" : "p").repeat(26)}`, name: "Synthetic", type: "standard", status: "active", tax_category: "saas" };
    else if (url.pathname.startsWith("/transactions/")) data = { id: url.pathname.split("/").at(-1), customer_id: customer, subscription_id: subscription, status: "ready", currency_code: "USD", collection_mode: "automatic", origin: "subscription_payment_method_change", items: [{ quantity: 1, price: providerPrice("STARTER") }], payments: [], custom_data: null, ...options.transaction };
    else if (method === "POST" && url.pathname.endsWith("/portal-sessions")) data = { id: `cpls_${"a".repeat(26)}`, customer_id: customer,
      urls: { general: { overview: `https://${options.portalHost ?? "customer-portal.paddle.com"}/synthetic` }, subscriptions: [{ id: subscription, cancel_subscription: `https://customer-portal.paddle.com/synthetic`, update_subscription_payment_method: `https://${options.portalHost ?? "customer-portal.paddle.com"}/synthetic` }] } };
    else if (url.pathname === "/subscriptions/" + subscription || url.pathname === "/subscriptions/" + subscription + "/cancel") {
      if (method !== "GET") {
        if (options.mutation === "ambiguous") throw new Error("PADDLE_TIMEOUT");
        if (options.mutation === "reject") return Response.json({ error: { type: "request_error", code: "synthetic_rejection", detail: "synthetic" } }, { status: 400 });
      }
      data = { id: subscription, customer_id: options.wrongCustomer ? `ctm_${"x".repeat(26)}` : customer, status: "active", billing_cycle: { interval: "month", frequency: 1 },
        current_billing_period: { starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-11-01T00:00:00Z" }, scheduled_change: null,
        items: [{ quantity: 1, price: providerPrice(method === "PATCH" ? "PRO" : "STARTER"), product: { id: `pro_${"l".repeat(26)}`, name: "Synthetic", status: "active", tax_category: "saas" } }] };
    } else throw new Error("Unexpected provider endpoint: " + url.pathname);
    return Response.json({ data, meta: { request_id: "synthetic" } });
  };
  try { await run(calls); } finally { globalThis.fetch = previous; }
}
test("actual Live checkout route requires adopted capability before any provider access or intent write", () => isolated(async db => {
  await inspect(db, "update private.paddle_live_settings set enabled=false"); const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async calls => { const response = await h.routes.billingMutation(h.request("checkout-intent", "STARTER"), "checkout-intent"); assert.equal(response.status, 503); assert.equal(calls.length, 0); });
  assert.equal((await inspect(db, "select count(*)::int as n from private.paddle_live_checkout_intents"))[0].n, 0);
}));
test("actual Live checkout verifies all provider metadata before creating exact approved intent", () => isolated(async db => {
  const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async calls => { const response = await h.routes.billingMutation(h.request("checkout-intent", "PRO"), "checkout-intent"); assert.equal(response.status, 200); const body = await response.json();
    assert.equal(body.environment, "live"); assert.equal(body.priceId, prices.PRO); assert.equal(body.clientToken, "live_synthetic"); assert.equal(calls.length, 4); assert.ok(calls.every(call => call.method === "GET")); });
  assert.ok(h.calls.indexOf("get_live_billing_configuration") < h.calls.indexOf("create_live_billing_checkout_intent"));
  assert.equal((await state(db)).provider, null);
}));
test("actual Live wrong price amount fails without checkout write", () => isolated(async db => {
  const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async () => { assert.equal((await h.routes.billingMutation(h.request("checkout-intent", "PRO"), "checkout-intent")).status, 503); }, { wrongAmount: true });
  assert.equal(h.calls.includes("create_live_billing_checkout_intent"), false);
}));
test("actual billing routes retain owner and same-origin defenses before provider execution", () => isolated(async db => {
  const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async calls => {
    h.setOwner(false); assert.equal((await h.routes.billingMutation(h.request("checkout-intent", "PRO"), "checkout-intent")).status, 403);
    h.setOwner(true); assert.equal((await h.routes.billingMutation(h.request("checkout-intent", "PRO", "https://evil.invalid"), "checkout-intent")).status, 403);
    assert.equal(calls.length, 0); assert.equal(h.calls.length, 0);
  });
}));
test("actual Live SDK update uses exact catalog and operation lock; definitive rejection releases it", () => isolated(async db => {
  await activated(db); const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async calls => {
    const response = await h.routes.billingMutation(h.request("change-plan", "PRO"), "change-plan"); assert.equal(response.status, 409);
    const mutations = calls.filter(call => call.method === "PATCH"); assert.equal(mutations.length, 1);
    assert.deepEqual(mutations[0].body, { items: [{ price_id: prices.PRO, quantity: 1 }], proration_billing_mode: "prorated_immediately", on_payment_failure: "prevent_change" });
  }, { mutation: "reject" });
  assert.ok(h.calls.indexOf("begin_live_billing_operation") < h.calls.indexOf("abort_live_billing_operation")); assert.equal((await state(db)).billing_operation_id, null);
}));
test("actual ambiguous Live provider failure retains operation lock and never retries mutation", () => isolated(async db => {
  await activated(db); const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async calls => { assert.equal((await h.routes.billingMutation(h.request("change-plan", "PRO"), "change-plan")).status, 503); assert.equal(calls.filter(call => call.method === "PATCH").length, 1); }, { mutation: "ambiguous" });
  assert.equal(h.calls.includes("abort_live_billing_operation"), false); assert.ok((await state(db)).billing_operation_id);
}));
test("actual Live SDK success returns pending while entitlements remain authoritative", () => isolated(async db => {
  await activated(db); const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async calls => { const response = await h.routes.billingMutation(h.request("change-plan", "PRO"), "change-plan"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { result: "SYNC_PENDING" }); assert.equal(calls.filter(call => call.method === "PATCH").length, 1); });
  assert.equal((await state(db)).plan_code, "STARTER"); assert.ok((await state(db)).billing_operation_id);
}));
test("actual Live portal creates a fresh scoped link and rejects a Sandbox URL", () => isolated(async db => {
  await activated(db); const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async calls => { const response = await h.routes.billingMutation(h.request("portal"), "portal"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { url: "https://customer-portal.paddle.com/synthetic" }); assert.deepEqual(calls[0].body, { subscription_ids: [subscription] }); });
  await providerStub(async () => { assert.equal((await h.routes.billingMutation(h.request("portal"), "portal")).status, 503); }, { portalHost: "sandbox-customer-portal.paddle.com" });
}));
test("actual Live reconciliation rejects unrelated provider identity before synchronization", () => isolated(async db => {
  await activated(db); const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async () => { assert.equal((await h.routes.billingMutation(h.request("reconcile"), "reconcile")).status, 503); }, { wrongCustomer: true });
  assert.equal(h.calls.includes("synchronize_paddle_live_subscription"), false);
}));
test("Live active Standard reservation, commit/replay and exhausted quota remain enforced under SHADOW", () => isolated(async db => {
  await activated(db); const h = serverHarness(db, "SHADOW");
  const first = await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AI_ANALYSES", 1, "live-standard"); assert.equal(first.allowed, true); assert.equal(first.mode, "ENFORCED");
  assert.equal(await h.usage.commitOrganizationUsage(h.client as never, orgA, first, 1), true); assert.equal(await h.usage.commitOrganizationUsage(h.client as never, orgA, first, 1), true);
  const replay = await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AI_ANALYSES", 1, "live-standard"); assert.equal(replay.isNew, false);
  const remaining = await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AI_ANALYSES", 29, "live-fill"); assert.equal(remaining.allowed, true); assert.equal(await h.usage.commitOrganizationUsage(h.client as never, orgA, remaining, 29), true);
  const denied = await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AI_ANALYSES", 1, "live-exhausted"); assert.equal(denied.allowed, false);
  assert.equal((await inspect(db, "select sum(units)::int as n from public.organization_usage_events where status='committed'"))[0].n, 30);
}));
test("actual Live cancel requests end-of-period only and does not assume cancellation", () => isolated(async db => {
  await activated(db); const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async calls => {
    const response = await h.routes.billingMutation(h.request("cancel"), "cancel"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { result: "SYNC_PENDING" });
    assert.equal(calls.length, 1); assert.equal(calls[0].method, "POST"); assert.equal(calls[0].path, "/subscriptions/" + subscription + "/cancel"); assert.deepEqual(calls[0].body, { effective_from: "next_billing_period" });
  });
  assert.equal((await state(db)).subscription_status, "active"); assert.equal((await state(db)).provider_scheduled_action, null); assert.ok((await state(db)).billing_operation_id);
}));
test("actual Live reconciliation uses server-fetched identity and authoritative CAS without usage reset", () => isolated(async db => {
  await activated(db); const h = billingHarness(db, appEnvironment(), authority); const before = await state(db);
  await providerStub(async calls => { const response = await h.routes.billingMutation(h.request("reconcile"), "reconcile"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { result: "APPLIED" }); assert.ok(calls.every(call => call.method === "GET")); });
  assert.equal(h.calls.includes("synchronize_paddle_live_subscription"), true);
  for (const field of ["plan_code", "current_period_start", "current_period_end", "trial_ends_at"]) assert.deepEqual((await state(db))[field], before[field]);
}));
test("actual Live API rejects Sandbox key or browser token before provider access", () => isolated(async db => {
  for (const changed of [ { PADDLE_API_KEY: appEnvironment().PADDLE_API_KEY.replace("live_apikey", "sdbx_apikey") }, { NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: "test_synthetic" } ]) {
    const h = billingHarness(db, { ...appEnvironment(), ...changed }, authority);
    await providerStub(async calls => { assert.equal((await h.routes.billingMutation(h.request("checkout-intent", "STARTER"), "checkout-intent")).status, 503); assert.equal(calls.length, 0); });
    assert.equal(h.calls.includes("create_live_billing_checkout_intent"), false);
  }
}));
test("actual Sandbox configuration cannot mutate a Live canceled subscription", () => isolated(async db => {
  await activated(db); await inspect(db, "update public.organization_subscriptions set subscription_status='canceled' where organization_id=$1", [orgA]);
  const h = billingHarness(db, { ...appEnvironment(), PADDLE_ENVIRONMENT: "sandbox", PADDLE_STARTER_PRICE_ID: "pri_01m2mqgrjazqnz7wyex9p7dyt8", PADDLE_PRO_PRICE_ID: "pri_01m2mqs3q7f9r0kyqzmrt6gkgg" }, authority);
  await providerStub(async calls => { assert.equal((await h.routes.billingMutation(h.request("checkout-intent", "PRO"), "checkout-intent")).status, 409); assert.equal(calls.length, 0); });
  assert.equal(h.calls.includes("create_billing_checkout_intent"), false); assert.equal((await state(db)).provider, "paddle_live");
}));
test("Live Starter denies premium reservations and Live Pro includes Deep within the shared analysis allowance", () => isolated(async db => {
  await activated(db); const h = serverHarness(db, "SHADOW");
  const deniedDeep = await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AI_ANALYSES", 1, "deep-analysis:live-starter"); assert.equal(deniedDeep.allowed, false);
  const deniedAuto = await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AUTO_CONVERT_ROWS", 1, "auto-live-starter"); assert.equal(deniedAuto.allowed, false);
  await h.usage.releaseUnusedUsage(h.client as never, orgA, deniedDeep); await h.usage.releaseUnusedUsage(h.client as never, orgA, deniedAuto);
  assert.equal(await sync(db, event(null, { event_id: `evt_${"b".repeat(26)}`, occurred_at: "2026-10-02T00:00:00Z", price_id: prices.PRO })), "APPLIED");
  const deep = await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AI_ANALYSES", 1, "deep-analysis:live-pro"); assert.equal(deep.allowed, true); assert.equal(await h.usage.commitOrganizationUsage(h.client as never, orgA, deep, 1), true);
  const fill = await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AI_ANALYSES", 249, "live-pro-fill"); assert.equal(fill.allowed, true); assert.equal(await h.usage.commitOrganizationUsage(h.client as never, orgA, fill, 249), true);
  assert.equal((await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AI_ANALYSES", 1, "deep-analysis:live-pro-exhausted")).allowed, false);
  assert.equal((await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AUTO_CONVERT_ROWS", 1500, "live-pro-auto")).allowed, true);
  assert.equal((await h.usage.reserveOrganizationUsage(h.client as never, orgA, "AUTO_CONVERT_ROWS", 1, "live-pro-auto-exhausted")).allowed, false);
}));
test("Live initial binding rejects nullable-provider paid row instead of accepting SQL UNKNOWN", () => isolated(async db => {
  const i = await intent(db); await inspect(db, "update public.organization_subscriptions set plan_code='STARTER',subscription_status='canceled' where organization_id=$1", [orgA]);
  await rejected(db, "select public.create_live_billing_checkout_intent($1,$2,'STARTER')", [authority, orgA], /SUBSCRIPTION_CONFLICT/);
  assert.equal(await sync(db, event(i.intentId)), "SUBSCRIPTION_CONFLICT"); assert.equal((await state(db)).provider, null);
}));
const paymentTransaction = `txn_${"t".repeat(26)}`;
for (const status of ["active", "past_due"]) test(`actual Live ${status} payment-method/dunning bootstrap reads only and verifies exact owned subscription`, () => isolated(async db => {
  await activated(db); const h = billingHarness(db, appEnvironment(), authority); const before = await state(db);
  if (status === "past_due") { assert.equal(await sync(db, event(null, { event_id: `evt_${"b".repeat(26)}`, occurred_at: "2026-10-02T00:00:00Z", status })), "APPLIED"); Object.assign(before, await state(db)); }
  await providerStub(async calls => { const response = await h.routes.billingMutation(h.request("payment-link", undefined, undefined, { transactionId: paymentTransaction }), "payment-link");
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { environment: "live", transactionId: paymentTransaction, clientToken: "live_synthetic" }); assert.equal(calls.length, 5); assert.ok(calls.every(call => call.method === "GET")); }, { transaction: status === "past_due" ? { status: "past_due", origin: "subscription_recurring" } : {} });
  assert.equal(h.calls.includes("verify_live_billing_payment_link"), true); assert.deepEqual(await state(db), before);
}));
test("actual Live payment bootstrap requires adopted capability before all SDK reads", () => isolated(async db => {
  await inspect(db, "update private.paddle_live_settings set enabled=false"); const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async calls => { assert.equal((await h.routes.billingMutation(h.request("payment-link", undefined, undefined, { transactionId: paymentTransaction }), "payment-link")).status, 503); assert.equal(calls.length, 0); });
}));
test("actual payment bootstrap rejects malformed, extra-field, foreign owner and cross-origin requests", () => isolated(async db => {
  const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async calls => {
    for (const body of [{ transactionId: "bad" }, { transactionId: paymentTransaction, status: "active" }]) assert.equal((await h.routes.billingMutation(h.request("payment-link", undefined, undefined, body), "payment-link")).status, 400);
    assert.equal((await h.routes.billingMutation(h.request("payment-link", undefined, "https://evil.invalid", { transactionId: paymentTransaction }), "payment-link")).status, 403);
    h.setOwner(false); assert.equal((await h.routes.billingMutation(h.request("payment-link", undefined, undefined, { transactionId: paymentTransaction }), "payment-link")).status, 403); assert.equal(calls.length, 0);
  });
}));
for (const [name, transaction] of Object.entries({ foreignCustomer: { customer_id: `ctm_${"x".repeat(26)}` }, foreignSubscription: { subscription_id: `sub_${"x".repeat(26)}` }, wrongPrice: { items: [{ quantity: 1, price: { ...providerPrice("STARTER"), id: "pri_01m2mqgrjazqnz7wyex9p7dyt8" } }] }, paid: { status: "completed" } })) test(`actual payment bootstrap ${name} never authorizes provider initialization`, () => isolated(async db => {
  await activated(db); const h = billingHarness(db, appEnvironment(), authority); const before = await state(db);
  await providerStub(async calls => { assert.equal((await h.routes.billingMutation(h.request("payment-link", undefined, undefined, { transactionId: paymentTransaction }), "payment-link")).status, 503); assert.ok(calls.every(call => call.method === "GET")); }, { transaction });
  assert.deepEqual(await state(db), before);
}));
test("actual initial payment bootstrap requires owned unexpired unconsumed exact checkout intent without consuming it", () => isolated(async db => {
  const i = await intent(db); const h = billingHarness(db, appEnvironment(), authority);
  const transaction = { subscription_id: null, origin: "web", custom_data: { lostdeal_checkout_intent_id: i.intentId } };
  await providerStub(async () => { assert.equal((await h.routes.billingMutation(h.request("payment-link", undefined, undefined, { transactionId: paymentTransaction }), "payment-link")).status, 200); }, { transaction });
  assert.equal((await inspect(db, "select consumed_at from private.paddle_live_checkout_intents where id=$1", [i.intentId]))[0].consumed_at, null); assert.equal((await state(db)).provider, null);
  await inspect(db, "update private.paddle_live_checkout_intents set expires_at=clock_timestamp()-interval '1 second' where id=$1", [i.intentId]);
  await providerStub(async () => { assert.equal((await h.routes.billingMutation(h.request("payment-link", undefined, undefined, { transactionId: paymentTransaction }), "payment-link")).status, 503); }, { transaction });
}));
test("actual payment bootstrap rejects foreign checkout intent and Sandbox environment before initialization", () => isolated(async db => {
  await db.exec("set request.jwt.claim.sub='" + userB + "'"); const i = await intent(db, "STARTER", orgB); await db.exec("set request.jwt.claim.sub='" + userA + "'");
  const h = billingHarness(db, appEnvironment(), authority);
  await providerStub(async () => { assert.equal((await h.routes.billingMutation(h.request("payment-link", undefined, undefined, { transactionId: paymentTransaction }), "payment-link")).status, 503); }, { transaction: { subscription_id: null, origin: "web", custom_data: { lostdeal_checkout_intent_id: i.intentId } } });
  const sandbox = billingHarness(db, { ...appEnvironment(), PADDLE_ENVIRONMENT: "sandbox", PADDLE_STARTER_PRICE_ID: "pri_01m2mqgrjazqnz7wyex9p7dyt8", PADDLE_PRO_PRICE_ID: "pri_01m2mqs3q7f9r0kyqzmrt6gkgg" }, authority);
  await providerStub(async calls => { assert.equal((await sandbox.routes.billingMutation(sandbox.request("payment-link", undefined, undefined, { transactionId: paymentTransaction }), "payment-link")).status, 503); assert.equal(calls.length, 0); });
}));
