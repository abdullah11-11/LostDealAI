import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@paddle/paddle-node-sdk";
import { readFileSync } from "node:fs";
import { classifyPaddleFailure } from "@/lib/billing/paddle-errors";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migrationName = "20260922083319_prompt16_billing_operation_rejection_recovery.sql";

function apiError(type: string, code: string, detail = "provider detail must stay private", retryAfter: number | null = null) {
  return new ApiError({ type, code, detail, documentation_url: "https://developer.paddle.com/errors/synthetic" }, retryAfter);
}

test("structured Paddle request errors are definitive and safe to release", () => {
  const failure = classifyPaddleFailure(apiError("request_error", "conflict"));
  assert.equal(failure.definitiveRejection, true);
  assert.equal(failure.responseStatus, 409);
  assert.equal(failure.publicCode, "BILLING_CHANGE_REJECTED");
  assert.match(failure.publicMessage, /did not apply/i);
  assert.doesNotMatch(JSON.stringify(failure), /provider detail must stay private|documentation_url/);
});

for (const code of ["subscription_immediate_charge_hour_limit_exceeded", "subscription_immediate_charge_24_hour_limit_exceeded"]) {
  test(`${code} has bounded rate-limit guidance`, () => {
    const failure = classifyPaddleFailure(apiError("request_error", code, "private", 3600));
    assert.equal(failure.definitiveRejection, true);
    assert.equal(failure.publicCode, "BILLING_CHANGE_RATE_LIMITED");
    assert.equal(failure.retryAfterSeconds, 3600);
    assert.match(failure.publicMessage, /temporary immediate-charge limit/i);
  });
}

test("provider API errors, timeouts, and unknown failures stay locked for reconciliation", () => {
  for (const error of [apiError("api_error", "internal_error"), new Error("PADDLE_TIMEOUT"), new Error("network detail")]) {
    const failure = classifyPaddleFailure(error);
    assert.equal(failure.definitiveRejection, false);
    assert.equal(failure.responseStatus, 503);
    assert.equal(failure.publicCode, "BILLING_OUTCOME_UNCONFIRMED");
    assert.match(failure.publicMessage, /Do not retry/i);
    assert.doesNotMatch(JSON.stringify(failure), /network detail|provider detail must stay private/);
  }
});

test("malformed provider metadata is reduced to bounded telemetry", () => {
  const failure = classifyPaddleFailure(apiError("request_error\nsecret", "bad/code", "do not expose", -4));
  assert.equal(failure.definitiveRejection, false);
  assert.equal(failure.providerType, "unclassified");
  assert.equal(failure.providerCode, "unclassified");
  assert.equal(failure.retryAfterSeconds, null);
  assert.doesNotMatch(JSON.stringify(failure), /secret|bad\/code|do not expose/);
});

test("route binds cleanup to the exact returned operation token", () => {
  const route = source("lib/billing/routes.ts");
  assert.match(route, /const operationId = z\.string\(\)\.uuid\(\)\.parse\(await rpc\("begin_billing_operation"/);
  assert.match(route, /rpc\("abort_billing_operation", \{[\s\S]*target_operation_id: operationId/);
  assert.match(route, /if \(failure\.definitiveRejection\)/);
  assert.match(route, /operationReleased = await releaseOperation\(\)/);
  assert.doesNotMatch(route, /error\.(?:detail|errors|documentationUrl)|JSON\.stringify\(error\)/);
});

test("billing UI exposes one unambiguous provider-verification control", () => {
  const ui = source("components/billing-controls.tsx");
  const controls = [...ui.matchAll(/<Button[^>]*onClick=\{\(\) => void act\("reconcile"\)\}[^>]*>([^<]+)<\/Button>/g)];
  assert.equal(controls.length, 1);
  assert.equal(controls[0][1], "Verify billing status");
  assert.doesNotMatch(ui, />Refresh billing status<|>Refresh status</);
  assert.match(ui, /!state && message && <Button[^>]+onClick=\{\(\) => void refresh\(/);
  assert.match(ui, /fetch\("\/api\/billing\/status", \{ cache: "no-store" \}\)/);
});

test("pending operation UX exposes only a safe boolean and blocks new mutations", () => {
  const ui = source("components/billing-controls.tsx");
  const route = source("lib/billing/routes.ts");
  assert.match(route, /operationPending = parsed\.success && parsed\.data\.billing_operation_id !== null/);
  assert.match(route, /scheduledAt: data\?\.provider_scheduled_at \?\? null, operationPending/);
  assert.match(ui, /state\?\.owner && state\.operationPending && <p role="alert"/);
  assert.match(ui, /previous billing change is awaiting verification/i);
  assert.match(ui, /disabled=\{busy \|\| state\.operationPending/);
  assert.doesNotMatch(ui, /billing_operation_id|billing_operation_started_at|provider_subscription_id|provider_customer_id/);
});

test("reconciliation is owner-gated, provider-read-only, and safely observable", () => {
  const route = source("lib/billing/routes.ts");
  const branchStart = route.indexOf('if (action === "reconcile") {', route.indexOf('if (action === "reconcile")') + 1);
  const branch = route.slice(branchStart, route.indexOf('const change = action === "change-plan"'));
  assert.match(route, /organization\.role !== "owner"/);
  assert.match(branch, /paddle\.subscriptions\.get/);
  assert.match(branch, /rpc\("synchronize_paddle_subscription"/);
  assert.doesNotMatch(branch, /paddle\.subscriptions\.(?:update|cancel)|customerPortalSessions\.create/);
  for (const stage of ["request_started", "provider_read_succeeded", "rpc_invoked", "outcome"]) assert.ok(route.includes(stage), stage);
  assert.doesNotMatch(route, /logBillingReconciliation\([^)]*(?:organization|identity|current|event|authority|error)/);
});

test("forward migration is a narrow owner-authorized token compare-and-clear RPC", () => {
  const sql = source(`supabase/migrations/${migrationName}`);
  for (const invariant of [
    "private.assert_billing_authority(target_authority_secret)",
    "private.is_org_owner(target_organization_id)",
    "billing_operation_id = target_operation_id",
    "security definer",
    "set search_path = ''",
  ]) assert.ok(sql.toLowerCase().includes(invariant.toLowerCase()), invariant);
  assert.match(sql, /revoke all on function public\.abort_billing_operation\(text, uuid, uuid\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.abort_billing_operation\(text, uuid, uuid\) to authenticated/);
  assert.doesNotMatch(sql, /provider_(?:subscription|customer|price)_id\s*=|plan_code\s*=|subscription_status\s*=|organization_usage_events|service_role/i);
});

test("rollback proof covers grants, owner boundary, wrong token, exact token, and atomic cleanup", () => {
  const sql = source("supabase/tests/prompt16_billing_checks.sql");
  for (const proof of [
    "abort operation grant mismatch",
    "member abort accepted",
    "member reconciliation accepted",
    "wrong operation token cleared lock",
    "exact operation token did not clear lock",
    "operation metadata not cleared atomically",
    "eligible reconciliation did not clear stale operation",
    "reconciliation changed valid subscription",
  ]) assert.ok(sql.includes(proof), proof);
  assert.match(sql, /^begin;/m);
  assert.match(sql, /rollback;\s*$/);
});
