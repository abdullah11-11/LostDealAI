import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Paddle, Environment, LogLevel } from "@paddle/paddle-node-sdk";
import { PADDLE_EVENTS, PADDLE_PRICES, normalizePaddleEvent, verifyPaddleSignature, createWebhookHandler, boundedBody } from "@/supabase/functions/_shared/paddle";
import { planChangeRequest, validatePaddleConfig, safePortalUrl } from "@/lib/billing/paddle-policy";
import { resolveDeepAnalysisAccess } from "@/lib/billing/analysis-access";
import { resolveAutoConvertAccess } from "@/lib/billing/auto-convert-access";
import { PLAN_CATALOG, type PlanCode } from "@/lib/billing/plans";
import { decideUsage, rollingUsagePeriod } from "@/lib/billing/usage-core";
import { getSafeNextPath } from "@/lib/auth/validation";
import { validateMutationRequest } from "@/lib/security/origin";
import { applySecurityHeaders } from "@/lib/security/headers";
const source = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const secret = "synthetic-signature-fixture-not-a-credential";
const event = (status = "active") => ({ event_id: `evt_${"a".repeat(26)}`, event_type: "subscription.created", occurred_at: new Date().toISOString(), data: {
  id: `sub_${"a".repeat(26)}`, customer_id: `ctm_${"a".repeat(26)}`, status,
  items: [{ quantity: 1, price: { id: String(PADDLE_PRICES.STARTER) } }],
  current_billing_period: { starts_at: "2026-09-16T00:00:00Z", ends_at: "2026-10-16T00:00:00Z" },
  custom_data: { lostdeal_checkout_intent_id: "11111111-1111-4111-8111-111111111111" }, scheduled_change: null,
} });
const sign = (raw: string, ts = Math.floor(Date.now()/1000)) => `ts=${ts};h1=${createHmac("sha256",secret).update(`${ts}:${raw}`).digest("hex")}`;
const request = (raw: string, signature = sign(raw)) => new Request("https://test.invalid/paddle-webhook", { method: "POST", headers: { "content-type": "application/json", "Paddle-Signature": signature }, body: raw });

test("exact sandbox price mapping cannot be swapped or switched live", () => {
  const env = { PADDLE_ENVIRONMENT: "sandbox", PADDLE_STARTER_PRICE_ID: PADDLE_PRICES.STARTER, PADDLE_PRO_PRICE_ID: PADDLE_PRICES.PRO };
  assert.doesNotThrow(() => validatePaddleConfig(env));
  assert.throws(() => validatePaddleConfig({ ...env, PADDLE_ENVIRONMENT: "live" }));
  assert.throws(() => validatePaddleConfig({ ...env, PADDLE_STARTER_PRICE_ID: PADDLE_PRICES.PRO }));
  assert.throws(() => validatePaddleConfig({}));
});
for (const type of PADDLE_EVENTS) test(`normalizes ${type} through one pipeline`, () => {
  const normalized = normalizePaddleEvent({ ...event(), event_type: type });
  assert.equal(normalized?.event_type,type); assert.equal(normalized.price_id,PADDLE_PRICES.STARTER);
  assert.equal(normalized.intent_id,"11111111-1111-4111-8111-111111111111");
});
for (const status of ["active","past_due","paused","canceled","trialing"]) test(`normalizer preserves ${status} for database policy`, () => assert.equal(normalizePaddleEvent(event(status))?.status,status));
test("normalizer strips payment data and allows subsequent events without custom data", () => {
  const e = event(); const normalized = normalizePaddleEvent({ ...e, data: { ...e.data, custom_data: null, address: { city: "synthetic" }, management_urls: { update_payment_method: "discard" } } });
  assert.equal(normalized?.intent_id,null); assert.doesNotMatch(JSON.stringify(normalized),/address|management_urls|synthetic|discard/);
});
test("non-subscription events cannot provision", () => assert.equal(normalizePaddleEvent({ ...event(), event_type: "transaction.completed" }),null));
test("unknown price and multiple base items fail closed", () => {
  const e=event(); e.data.items[0].price.id="unknown"; assert.throws(() => normalizePaddleEvent(e),/UNKNOWN_PRICE/);
  const multi=event(); multi.data.items.push(multi.data.items[0]); assert.throws(() => normalizePaddleEvent(multi),/UNKNOWN_PRICE/);
});
test("bad IDs, quantity, period and status fail closed", () => {
  const e=event(); e.data.id="bad"; assert.throws(() => normalizePaddleEvent(e));
  const quantity=event(); quantity.data.items[0].quantity=2; assert.throws(() => normalizePaddleEvent(quantity));
  const period=event(); period.data.current_billing_period.ends_at="2025-01-01"; assert.throws(() => normalizePaddleEvent(period));
  assert.throws(() => normalizePaddleEvent(event("unrecognized")));
});
test("raw whitespace participates in signature and is never reserialized", async () => {
  const raw=JSON.stringify(event(),null,2); assert.equal(await verifyPaddleSignature(raw,sign(raw),secret),true);
  assert.equal(await verifyPaddleSignature(JSON.stringify(JSON.parse(raw)),sign(raw),secret),false);
});
test("missing, malformed, duplicated timestamp, expired and future signatures fail", async () => {
  const raw=JSON.stringify(event());
  for(const signature of ["", "ts=invalid;h1=bad", `${sign(raw)};ts=1`, sign(raw,Math.floor(Date.now()/1000)-10),sign(raw,Math.floor(Date.now()/1000)+10)]) assert.equal(await verifyPaddleSignature(raw,signature,secret),false);
  assert.equal(await verifyPaddleSignature(raw,sign(raw),"wrong"),false);
});
test("signature key rotation accepts a valid h1 among invalid candidates", async () => {
  const raw="{}"; assert.equal(await verifyPaddleSignature(raw,`${sign(raw)};h1=${"0".repeat(64)}`,secret),true);
});
test("public handler needs no JWT but requires a valid Paddle signature before RPC", async () => {
  let calls=0; const handler=createWebhookHandler({ environment:()=>"sandbox",secret:()=>secret,synchronize:async e=>{ calls++; assert.equal(e.price_id,PADDLE_PRICES.STARTER);return "APPLIED"; } });
  assert.equal((await handler(request(JSON.stringify(event()),"bad"))).status,400); assert.equal(calls,0);
  assert.equal((await handler(request(JSON.stringify(event())))).status,200); assert.equal(calls,1);
});
test("missing signature, non-POST and wrong content type never call RPC", async () => {
  let calls=0; const handler=createWebhookHandler({environment:()=>"sandbox",secret:()=>secret,synchronize:async()=>{calls++;return "APPLIED";}});
  assert.equal((await handler(new Request("https://test.invalid"))).status,405);
  assert.equal((await handler(new Request("https://test.invalid",{method:"POST",body:"{}"}))).status,415);
  assert.equal((await handler(new Request("https://test.invalid",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}))).status,400);
  assert.equal(calls,0);
});
test("unconfigured secret and live environment fail closed without breaking bootstrap", async () => {
  for (const [environment,configuredSecret] of [["sandbox",undefined],["production",secret]]) {
    const handler=createWebhookHandler({environment:()=>environment,secret:()=>configuredSecret,synchronize:async()=>{throw new Error("MUST_NOT_CALL");}});
    assert.equal((await handler(request("{}"))).status,503);
  }
});
test("oversized streaming bodies rejected independently of content-length", async () => {
  await assert.rejects(()=>boundedBody(request("x".repeat(1025)),1024),/BODY_TOO_LARGE/);
  assert.equal(await boundedBody(request(" {} \n"),1024)," {} \n");
});
test("signed invalid JSON and unknown price do not invoke RPC", async () => {
  let calls=0;const handler=createWebhookHandler({environment:()=>"sandbox",secret:()=>secret,synchronize:async()=>{calls++;return "APPLIED";}});
  assert.equal((await handler(request("{"))).status,400);
  const e=event();e.data.items[0].price.id="unknown";
  assert.equal((await handler(request(JSON.stringify(e)))).status,400); assert.equal(calls,0);
});
for (const result of ["APPLIED","DUPLICATE_EVENT","STALE_EVENT","EXPIRED_CHECKOUT_INTENT","INTERNAL_WORKSPACE_BLOCKED"]) test(`database outcome ${result} is acknowledged safely`,async()=>{
  const handler=createWebhookHandler({environment:()=>"sandbox",secret:()=>secret,synchronize:async()=>result});
  const response=await handler(request(JSON.stringify(event())));assert.equal(response.status,200);assert.deepEqual(await response.json(),{result});
});
test("RPC failures remain retryable and expose no raw error",async()=>{
  const handler=createWebhookHandler({environment:()=>"sandbox",secret:()=>secret,synchronize:async()=>{throw new Error("sensitive database details");}});
  const response=await handler(request(JSON.stringify(event())));assert.equal(response.status,503);assert.deepEqual(await response.json(),{result:"DATABASE_FAILURE"});
});
for(const [current,target,proration] of [["STARTER","PRO","prorated_immediately"],["PRO","STARTER","prorated_next_billing_period"]] as const) test(`${current} to ${target}: SDK sends exact price and proration with prevent_change`,async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),`https://sandbox-api.paddle.com/subscriptions/sub_${"a".repeat(26)}`);assert.equal(init?.method,"PATCH");
    const body=JSON.parse(String(init?.body));assert.deepEqual(body.items,[{price_id:PADDLE_PRICES[target],quantity:1}]);assert.equal(body.proration_billing_mode,proration);assert.equal(body.on_payment_failure,"prevent_change");
    return Response.json({error:{type:"request_error",code:"test_failure",detail:"synthetic"}},{status:400});};
  try { const paddle=new Paddle("synthetic-not-a-key",{environment:Environment.sandbox,logLevel:LogLevel.none});await assert.rejects(()=>paddle.subscriptions.update(`sub_${"a".repeat(26)}`,planChangeRequest(current,target)));assert.equal(calls,1); }
  finally{globalThis.fetch=original;}
});
test("same-plan and invalid plan changes fail before provider execution",()=>{assert.throws(()=>planChangeRequest("PRO","PRO"));assert.throws(()=>planChangeRequest("INTERNAL","PRO"));});
test("portal destinations are sandbox-only and reject credential URLs",()=>{
  assert.equal(safePortalUrl("https://sandbox-customer-portal.paddle.com/"),"https://sandbox-customer-portal.paddle.com/");
  for(const u of ["https://customer-portal.paddle.com/","https://evil.invalid/","javascript:alert(1)","https://user@sandbox-customer-portal.paddle.com/"])assert.throws(()=>safePortalUrl(u));
});
for(const [plan,status,allowed] of [["TRIAL","trialing",true],["STARTER","active",false],["PRO","active",true],["INTERNAL","active",true],["STARTER","past_due",false],["PRO","past_due",false],["STARTER","paused",false],["PRO","paused",false],["PRO","canceled",false]] as const) test(`server Deep/Auto Convert matrix ${plan}/${status}`,()=>{
  assert.equal(resolveDeepAnalysisAccess(plan,status,"ENFORCED").providerExecutionAllowed,allowed);
  assert.equal(resolveAutoConvertAccess(plan,status,"ENFORCED").providerExecutionAllowed,allowed);
});
test("plan transitions change allowances without changing usage",()=>{
  const used=20;for(const plan of ["STARTER","PRO","STARTER"] as PlanCode[]) {const limit=PLAN_CATALOG[plan].usage!.AI_ANALYSES;const result=decideUsage(limit,used,0,1,"ENFORCED");assert.equal(result.remaining,Number(limit)-20);}
  assert.equal(decideUsage(30,31,0,1,"ENFORCED").allowed,false);
});
test("billing mutation security and no browser entitlement authority",()=>{
  const route=source("lib/billing/routes.ts");for(const required of ["validateMutationRequest","getAuthorizedRouteContext","organization.role !== \"owner\"","enforceRateLimitOrRespond",".strict()","begin_billing_operation","target_expected_event_id"])assert.ok(route.includes(required),required);
  assert.doesNotMatch(route,/\.from\([^)]*\)\.(update|insert|upsert)/);
  assert.ok(route.indexOf('begin_billing_operation')<route.indexOf('paddle.subscriptions.update'));
  const ui=source("components/billing-controls.tsx");assert.doesNotMatch(ui,/setState\(\{[^}]*plan|PADDLE_API_KEY|PADDLE_WEBHOOK_SECRET|authority_secret/);
});
test("same origin enforced and selected plan is a safe auth destination",()=>{
  const r=new Request("https://lostdeal-ai.equal-dune-2306.chatgpt.site/api/billing/portal",{method:"POST",headers:{origin:"https://evil.invalid","content-type":"application/json"}});
  assert.equal(validateMutationRequest(r,"json")?.status,403);
  assert.equal(getSafeNextPath("/account?plan=PRO"),"/account?plan=PRO");assert.equal(getSafeNextPath("//evil.invalid"),"/dashboard");
  assert.match(source("components/auth-screen.tsx"),/name="next"/);assert.match(source("app/actions/auth.ts"),/getSafeNextPath\(String\(formData.get\("next"\)/);
});
test("Paddle CSP exceptions apply only to billing page",()=>{
  const normal=applySecurityHeaders(new Response(),"/deals","https:").headers.get("content-security-policy")!;
  const billing=applySecurityHeaders(new Response(),"/account","https:").headers.get("content-security-policy")!;
  assert.doesNotMatch(normal,/paddle/);assert.match(billing,/cdn.paddle.com/);assert.match(billing,/frame-ancestors 'none'/);
});
test("one forward migration, narrow public function, and no usage resets",()=>{
  assert.deepEqual(readdirSync(new URL("../supabase/migrations",import.meta.url)).filter(f=>f.includes("prompt16")),["20260916095842_prompt16_paddle_billing_foundation.sql"]);
  const sql=source("supabase/migrations/20260916095842_prompt16_paddle_billing_foundation.sql");
  const sync=sql.slice(sql.indexOf("create function public.synchronize_paddle_subscription"),sql.indexOf("revoke all on function public.get_billing_subscription"));
  assert.doesNotMatch(sync,/organization_usage_events|trial_ends_at\s*=|current_period_start\s*=|current_period_end\s*=/);
  assert.match(sql,/revoke all on public.billing_checkout_intents, public.billing_event_receipts from public,anon,authenticated/);
  assert.match(sql,/private.assert_billing_authority/);assert.match(source("supabase/config.toml"),/\[functions.paddle-webhook\]\nverify_jwt = false/);
  assert.doesNotMatch(source("supabase/functions/paddle-webhook/index.ts"),/SERVICE_ROLE|SUPABASE_SECRET|createClient/);
});

test("paid usage display matches monthly SQL rollover and month-end clamping", () => {
  assert.deepEqual(rollingUsagePeriod("2026-01-01T12:00:00Z", "2026-01-31T12:00:00Z", new Date("2026-03-01T00:00:00Z")), {
    start: "2026-02-28T12:00:00.000Z", end: "2026-03-28T12:00:00.000Z",
  });
  assert.throws(() => rollingUsagePeriod("invalid", "invalid", new Date()));
});
test("billing document navigation loads the account-specific sandbox CSP", () => {
  assert.match(source("components/dashboard-shell.tsx"), /<a href="\/account"/);
  assert.match(source("components/marketing/pricing-section.tsx"), /<a/);
  const csp = applySecurityHeaders(new Response(), "/account", "https:").headers.get("content-security-policy")!;
  assert.match(csp, /frame-src https:\/\/sandbox-buy.paddle.com/);
  assert.match(csp, /style-src[^;]+sandbox-cdn.paddle.com/);
});
