import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createWebhookHandler, normalizePaddleEvent, PADDLE_PRICES } from "@/supabase/functions/_shared/paddle";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migrationName = "20260921064300_prompt16_paddle_simulator_event_id_compat.sql";
const migration = source(`supabase/migrations/${migrationName}`);
const shared = source("supabase/functions/_shared/paddle.ts");
const sqlChecks = source("supabase/tests/prompt16_paddle_simulator_event_id_checks.sql");
const fixture = (eventId: unknown) => ({
  event_id: eventId,
  event_type: "subscription.updated",
  occurred_at: "2026-09-21T06:30:23.182194Z",
  data: {
    id: `sub_${"s".repeat(26)}`,
    customer_id: `ctm_${"c".repeat(26)}`,
    status: "active",
    items: [{ quantity: 1, price: { id: PADDLE_PRICES.STARTER } }],
    current_billing_period: { starts_at: "2026-09-21T00:00:00Z", ends_at: "2026-10-21T00:00:00Z" },
    custom_data: null,
    scheduled_change: null,
  },
});

for (const [label, eventId] of [
  ["platform", `evt_${"a".repeat(26)}`],
  ["simulator", `ntfsimevt_${"b".repeat(26)}`],
] as const) test(`${label} event ID is accepted and preserved exactly`, () => {
  assert.equal(normalizePaddleEvent(fixture(eventId))?.event_id, eventId);
});

for (const [label, eventId] of [
  ["ntfsim prefix", `ntfsim_${"a".repeat(26)}`],
  ["ntfsimrun prefix", `ntfsimrun_${"a".repeat(26)}`],
  ["notification prefix", `ntf_${"a".repeat(26)}`],
  ["short platform ID", `evt_${"a".repeat(25)}`],
  ["long simulator ID", `ntfsimevt_${"a".repeat(27)}`],
  ["uppercase characters", `evt_${"A".repeat(26)}`],
  ["illegal characters", `evt_${"a".repeat(25)}-`],
  ["arbitrary prefix", `arbitrary_${"a".repeat(26)}`],
  ["empty ID", ""],
  ["null ID", null],
] as const) test(`${label} is denied as an event ID`, () => {
  assert.throws(() => normalizePaddleEvent(fixture(eventId)), /INVALID_EVENT/);
});

test("a signed simulator event reaches synchronization but an unsigned event does not", async () => {
  const secret = "synthetic-simulator-signature-fixture";
  const eventId = `ntfsimevt_${"z".repeat(26)}`;
  const raw = JSON.stringify(fixture(eventId));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `ts=${timestamp};h1=${createHmac("sha256", secret).update(`${timestamp}:${raw}`).digest("hex")}`;
  let calls = 0;
  const handler = createWebhookHandler({
    environment: () => "sandbox",
    secret: () => secret,
    synchronize: async (event) => { calls += 1; assert.equal(event.event_id, eventId); return "MISSING_CHECKOUT_INTENT"; },
  });
  const signed = await handler(new Request("https://test.invalid", { method: "POST", headers: { "content-type": "application/json", "Paddle-Signature": signature }, body: raw }));
  assert.equal(signed.status, 200);
  assert.deepEqual(await signed.json(), { result: "MISSING_CHECKOUT_INTENT" });
  const unsigned = await handler(new Request("https://test.invalid", { method: "POST", headers: { "content-type": "application/json" }, body: raw }));
  assert.equal(unsigned.status, 400);
  assert.equal(calls, 1);
});

test("the dedicated event validator does not broaden other Paddle entity IDs", () => {
  assert.match(shared, /function eventId\(value: unknown\)[\s\S]*\^\(\?:evt\|ntfsimevt\)_\[a-z0-9\]\{26\}\$/);
  assert.match(shared, /event_id: eventId\(e\.event_id\)/);
  assert.match(shared, /subscription_id: id\(d\.id, "sub"\), customer_id: id\(d\.customer_id, "ctm"\)/);
  const invalidSubscription = fixture(`evt_${"a".repeat(26)}`);
  invalidSubscription.data.id = `ntfsimevt_${"a".repeat(26)}`;
  assert.throws(() => normalizePaddleEvent(invalidSubscription), /INVALID_EVENT/);
});

test("the forward migration replaces only the anchored provider event-ID predicate", () => {
  assert.match(migration, /public\.synchronize_paddle_subscription\(text,jsonb,text\)/);
  assert.match(migration, /event_id !~ ''\^evt_\[a-z0-9\]\{26\}\$''/);
  assert.match(migration, /event_id !~ ''\^\(evt\|ntfsimevt\)_\[a-z0-9\]\{26\}\$''/);
  assert.match(migration, /PADDLE_EVENT_ID_COMPAT_PRECONDITION_FAILED/);
  assert.match(migration, /p\.proacl is not distinct from original_acl/);
  assert.match(migration, /p\.proowner = original_owner/);
  assert.match(migration, /p\.prosecdef = original_security_definer/);
  assert.match(migration, /p\.proconfig is not distinct from original_config/);
  assert.doesNotMatch(migration, /\b(?:create table|alter table|drop table|grant|revoke|commit|service_role)\b/i);
  assert.doesNotMatch(migration, /0d092f687f|ec4a6b6cc5/);
});

test("receipt storage needs no widening and the SQL proof is rollback-only", () => {
  const foundation = source("supabase/migrations/20260916095842_prompt16_paddle_billing_foundation.sql");
  assert.match(foundation, /event_id text primary key check \(length\(event_id\) between 1 and 100\)/i);
  assert.doesNotMatch(migration, /billing_event_receipts|create table|alter table/i);
  assert.match(sqlChecks, /^begin;/m);
  assert.match(sqlChecks, /2_VALID_EVENT_IDS_AND_10_INVALID_EVENT_IDS_PASS/);
  assert.match(sqlChecks, /MISSING_CHECKOUT_INTENT/);
  assert.match(sqlChecks, /rollback;\s*$/);
});

test("all twelve release-40 migrations remain byte-identical", () => {
  const expected: Record<string, string> = {
    "20260810000000_initial_lostdeal_schema.sql": "6b2f0cefa368d51338f314fe24d6afd9fa600a500f508cc8d7ad171805c80ecb",
    "20260830000000_prompt12_deal_delete.sql": "75e580cc49736f0880dd305ca901014c556560f46af5f6cfc05798021866a095",
    "20260901000000_prompt15_commercial_foundation.sql": "1ddbc82204a0340588a8bf9925962c2b7ce3cf6ccf46e875304cf88bc1a8efd8",
    "20260902000000_prompt15_1_plan_limits.sql": "ab6252fa9ec2b20793e8969829397b1bac2e1320af6f7fddf41a9100dd7fd12d",
    "20260902010000_prompt15_2_auto_convert_limit.sql": "014c25c127d32b04c31e9c6980681c2857ba9c318ffcf874ca333c0f821c71ad",
    "20260902020000_prompt15_3_deep_analysis.sql": "afb27ade8242ef6a0be23c33f210c65e95c7377cac1f031a7b90772dfe27dc0e",
    "20260905070000_prompt15_3_1_runtime_hardening.sql": "0b4568fd9156bb90b2719eedce8fadf425f55faa2542c58ceaadc9376a802387",
    "20260905083511_prompt15_3_2_usage_reservation_runtime_hotfix.sql": "7a07c0c262c5b1c61ff9ee6e89b74df26e50575b2694303a46741768e5260ba5",
    "20260906080228_prompt15_3_3_recovery_sort_rpc_auth_hotfix.sql": "2fc588e7959ce3f54325a5e9b7f5b8b671d57523a455bbdd77b7f7cab1563f91",
    "20260908055554_prompt15_3_5_deep_semantic_diagnostic_hardening.sql": "d5b84f7aa151177337eae53d684aa480b4af6fb818d50f8b3b952dfd01916cd8",
    "20260916095842_prompt16_paddle_billing_foundation.sql": "71cfc215e2d2b9c602063addf1ae5f9f1d00f8872e51976662a9a8c4fda68d28",
    "20260917144440_prompt16_authority_dual_verifier.sql": "54ff3bc0239a8fdcb149fb61dbac8781a422ab0a263051b13ca29f1028d98d08",
  };
  for (const [file, digest] of Object.entries(expected)) {
    assert.equal(createHash("sha256").update(source(`supabase/migrations/${file}`)).digest("hex"), digest, file);
  }
  assert.deepEqual(
    readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((file) => file.endsWith(".sql")).sort(),
    [...Object.keys(expected), migrationName, "20260921073247_prompt16_authority_rotation_finalize.sql", "20260922083319_prompt16_billing_operation_rejection_recovery.sql", "20261005185926_prompt17a_atomic_operations_and_authorization.sql"],
  );
});
