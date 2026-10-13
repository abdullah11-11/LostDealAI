import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(`${root}/${path}`, "utf8");

const previousMigrationPath = "supabase/migrations/20260902020000_prompt15_3_deep_analysis.sql";
const hotfixMigrationPath = "supabase/migrations/20260905083511_prompt15_3_2_usage_reservation_runtime_hotfix.sql";
const previousMigration = source(previousMigrationPath);
const hotfixMigration = source(hotfixMigrationPath);

function reserveFunctionDefinition(sql: string): string {
  const start = sql.search(/create or replace function public\.reserve_organization_usage\(/i);
  assert.notEqual(start, -1, "reserve_organization_usage definition start");
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, "reserve_organization_usage definition end");
  return sql.slice(start, end + "\n$$;".length);
}

const previousFunction = reserveFunctionDefinition(previousMigration);
const hotfixFunction = reserveFunctionDefinition(hotfixMigration);

const appliedMigrationHashes: Record<string, string> = {
  "20260810000000_initial_lostdeal_schema.sql": "6b2f0cefa368d51338f314fe24d6afd9fa600a500f508cc8d7ad171805c80ecb",
  "20260830000000_prompt12_deal_delete.sql": "75e580cc49736f0880dd305ca901014c556560f46af5f6cfc05798021866a095",
  "20260901000000_prompt15_commercial_foundation.sql": "1ddbc82204a0340588a8bf9925962c2b7ce3cf6ccf46e875304cf88bc1a8efd8",
  "20260902000000_prompt15_1_plan_limits.sql": "ab6252fa9ec2b20793e8969829397b1bac2e1320af6f7fddf41a9100dd7fd12d",
  "20260902010000_prompt15_2_auto_convert_limit.sql": "014c25c127d32b04c31e9c6980681c2857ba9c318ffcf874ca333c0f821c71ad",
  "20260902020000_prompt15_3_deep_analysis.sql": "afb27ade8242ef6a0be23c33f210c65e95c7377cac1f031a7b90772dfe27dc0e",
  "20260905070000_prompt15_3_1_runtime_hardening.sql": "0b4568fd9156bb90b2719eedce8fadf425f55faa2542c58ceaadc9376a802387",
};

test("Prompt 15.3.2 adds exactly one forward migration and preserves every applied migration byte-for-byte", () => {
  for (const [file, expected] of Object.entries(appliedMigrationHashes)) {
    const actual = createHash("sha256")
      .update(source(`supabase/migrations/${file}`))
      .digest("hex");
    assert.equal(actual, expected, file);
  }

  const migrations = readdirSync(`${root}/supabase/migrations`)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  assert.deepEqual(migrations, [
    ...Object.keys(appliedMigrationHashes),
    "20260905083511_prompt15_3_2_usage_reservation_runtime_hotfix.sql",
    "20260906080228_prompt15_3_3_recovery_sort_rpc_auth_hotfix.sql",
    "20260908055554_prompt15_3_5_deep_semantic_diagnostic_hardening.sql",
    "20260916095842_prompt16_paddle_billing_foundation.sql", "20260917144440_prompt16_authority_dual_verifier.sql", "20260921064300_prompt16_paddle_simulator_event_id_compat.sql", "20260921073247_prompt16_authority_rotation_finalize.sql", "20260922083319_prompt16_billing_operation_rejection_recovery.sql", "20261005185926_prompt17a_atomic_operations_and_authorization.sql",
  ]);
  assert.equal(
    createHash("sha256").update(hotfixMigration).digest("hex"),
    "7a07c0c262c5b1c61ff9ee6e89b74df26e50575b2694303a46741768e5260ba5",
  );
});

test("the replacement function differs from the authorized Prompt 15.3 function only by the timestamp-variable rename", () => {
  assert.equal(
    hotfixFunction,
    previousFunction.replace(/\bcurrent_time\b/g, "runtime_now"),
  );
  assert.equal((previousFunction.match(/\bcurrent_time\b/g) ?? []).length, 11);
  assert.equal((hotfixFunction.match(/\bruntime_now\b/g) ?? []).length, 11);
});

test("the runtime clock is an explicit timestamptz and the ambiguous current_time identifier is absent", () => {
  assert.match(hotfixFunction, /runtime_now timestamptz := clock_timestamp\(\);/);
  assert.match(hotfixFunction, /date_trunc\('month', runtime_now\)/);
  assert.doesNotMatch(hotfixFunction, /\bcurrent_time\b/i);
});

test("all timestamp comparisons, expiration checks, and the 15-minute reservation use runtime_now", () => {
  for (const expected of [
    /runtime_now < selected_trial_end/,
    /runtime_now >= selected_period_start/,
    /runtime_now < selected_period_end/,
    /reservation_expires_at <= runtime_now/,
    /reservation_expires_at > runtime_now/,
    /runtime_now \+ interval '15 minutes'/,
  ]) assert.match(hotfixFunction, expected);
});

test("reserve_organization_usage keeps one exact PostgREST signature and return shape", () => {
  assert.equal((hotfixMigration.match(/create or replace function public\.reserve_organization_usage\(/gi) ?? []).length, 1);
  assert.doesNotMatch(hotfixMigration, /drop function|create function public\.reserve_organization_usage/i);
  assert.match(hotfixFunction, /public\.reserve_organization_usage\(\s*target_authority_secret text,\s*target_organization_id uuid,\s*target_metric text,\s*target_units integer,\s*target_idempotency_key text\s*\)/i);
  assert.match(hotfixFunction, /returns table \(\s*reservation_token uuid,\s*is_new boolean,\s*allowed boolean,\s*plan_code text,\s*usage_limit integer,\s*period_start timestamptz,\s*period_end timestamptz\s*\)/i);
});

test("SECURITY DEFINER, empty search_path, and least-privilege RPC grants remain exact", () => {
  assert.match(hotfixFunction, /language plpgsql\s+security definer\s+set search_path = ''/i);
  assert.match(hotfixMigration, /revoke all on function public\.reserve_organization_usage\(text, uuid, text, integer, text\)\s+from public, anon, authenticated;/i);
  assert.match(hotfixMigration, /grant execute on function public\.reserve_organization_usage\(text, uuid, text, integer, text\)\s+to authenticated;/i);
});

test("the hotfix adds no private-schema exposure, service role, dynamic SQL, table, policy, or data mutation", () => {
  assert.doesNotMatch(hotfixMigration, /grant\s+usage\s+on\s+schema\s+private|grant[^;]+on\s+(?:all\s+)?(?:table|schema)\b/i);
  assert.doesNotMatch(hotfixMigration, /service_role|execute\s+format|execute\s+immediate|create\s+table|alter\s+table|create\s+policy|truncate\s+table/i);
  assert.doesNotMatch(hotfixMigration, /update\s+public\.organization_subscriptions|delete\s+from\s+public\.|insert\s+into\s+public\.organizations\b/i);
});

test("invalid authority and wrong-organization requests remain fail-closed before metering", () => {
  assert.match(hotfixFunction, /extensions\.digest\(coalesce\(target_authority_secret, ''\), 'sha256'\)/);
  assert.match(hotfixFunction, /is distinct from '[0-9a-f]{64}'[\s\S]*raise exception 'USAGE_AUTHORITY_INVALID' using errcode = '42501'/);
  assert.match(hotfixFunction, /if not private\.is_org_member\(target_organization_id\) then\s+raise exception 'USAGE_ORGANIZATION_UNAUTHORIZED' using errcode = '42501'/);
  assert.ok(hotfixFunction.indexOf("USAGE_AUTHORITY_INVALID") < hotfixFunction.indexOf("private.is_org_member"));
  assert.ok(hotfixFunction.indexOf("USAGE_ORGANIZATION_UNAUTHORIZED") < hotfixFunction.indexOf("from public.organization_subscriptions"));
});

test("INTERNAL Standard and Deep reservations use the repaired monthly timestamptz period and remain unlimited", () => {
  assert.match(hotfixFunction, /if selected_plan = 'INTERNAL' then\s+selected_period_start := date_trunc\('month', runtime_now\);\s+selected_period_end := selected_period_start \+ interval '1 month';\s+status_allows_usage := true;/);
  assert.match(hotfixFunction, /selected_limit := private\.plan_usage_limit\(selected_plan, target_metric\)/);
  assert.match(hotfixFunction, /selected_limit is null or committed_total \+ reserved_total \+ target_units <= selected_limit/);
  assert.match(hotfixFunction, /when selected_plan = 'INTERNAL' then true/);
});

test("Trial and Pro Deep quota rules preserve operations one and two while denying a third Trial unit", () => {
  assert.match(hotfixFunction, /when selected_plan = 'TRIAL' then deep_committed_total \+ deep_reserved_total \+ target_units <= 2/);
  assert.match(hotfixFunction, /when selected_plan = 'PRO' then true/);
  const deepAllowed = (plan: "TRIAL" | "PRO" | "INTERNAL", committed: number, reserved: number, units: number) => {
    if (plan === "INTERNAL" || plan === "PRO") return true;
    return committed + reserved + units <= 2;
  };
  assert.equal(deepAllowed("TRIAL", 0, 0, 1), true);
  assert.equal(deepAllowed("TRIAL", 1, 0, 1), true);
  assert.equal(deepAllowed("TRIAL", 2, 0, 1), false);
  assert.equal(deepAllowed("PRO", 250, 10, 1), true);
  assert.equal(deepAllowed("INTERNAL", 10_000, 10_000, 1), true);
});

test("Standard Trial quota remains in the shared AI_ANALYSES meter and unchanged plan-limit function", () => {
  assert.match(hotfixFunction, /target_metric not in \('IMPORTED_DEALS', 'AI_ANALYSES', 'AI_MAPPING_REQUESTS', 'AUTO_CONVERT_ROWS'\)/);
  assert.match(hotfixFunction, /is_deep_analysis := target_metric = 'AI_ANALYSES'\s+and target_idempotency_key like 'deep-analysis:%'/);
  assert.match(hotfixFunction, /deep_quota_allows_usage boolean := true/);
  const planLimits = source("supabase/migrations/20260902000000_prompt15_1_plan_limits.sql");
  assert.match(planLimits, /target_plan_code = 'TRIAL' and target_metric = 'AI_ANALYSES' then 10/);
  assert.match(planLimits, /target_plan_code = 'PRO' and target_metric = 'AI_ANALYSES' then 250/);
});

test("duplicate idempotency keys remain non-charging and advisory-lock protected", () => {
  assert.match(hotfixFunction, /pg_advisory_xact_lock/);
  assert.match(hotfixFunction, /where usage_event\.organization_id = target_organization_id\s+and usage_event\.metric = target_metric\s+and usage_event\.idempotency_key = target_idempotency_key/);
  assert.match(hotfixFunction, /if existing_status in \('committed', 'reserved'\) then\s+return query select\s+null::uuid,\s+false,\s+true,/);
  assert.match(hotfixFunction, /on conflict \(organization_id, metric, idempotency_key\)\s+do update set/);
});

test("expired reservations retain their prior cleanup and reusable upsert behavior", () => {
  assert.match(hotfixFunction, /set status = 'expired', reservation_expires_at = null[\s\S]*status = 'reserved'\s+and reservation_expires_at <= runtime_now/);
  assert.match(hotfixFunction, /do update set\s+units = excluded\.units,\s+status = 'reserved',[\s\S]*reservation_expires_at = excluded\.reservation_expires_at/);
});

test("Standard and Deep server paths each reserve exactly one AI_ANALYSES unit with distinct idempotency keys", () => {
  const standard = source("lib/ai/deal-analysis-service.ts");
  const deep = source("lib/ai/deep-analysis-service.ts");
  assert.match(standard, /reserveOrganizationUsage\(\s*supabase,\s*organizationId,\s*"AI_ANALYSES",\s*1,\s*`analysis:\$\{dealId\}`/);
  assert.match(deep, /reserveOrganizationUsage\(\s*supabase,\s*organizationId,\s*"AI_ANALYSES",\s*1,\s*`deep-analysis:\$\{dealId\}:\$\{operationId\}`/);
});

test("reservation denial remains before mocked-provider execution and finalization remains analysis-bound", () => {
  const standardWorkflow = source("lib/ai/analysis-workflow.ts");
  const deepWorkflow = source("lib/ai/deep-analysis-workflow.ts");
  for (const workflow of [standardWorkflow, deepWorkflow]) {
    assert.ok(workflow.indexOf("reserveUsage") < workflow.indexOf("runModel"));
    assert.match(workflow, /if \(!reservation\.allowed\)/);
    assert.match(workflow, /finalizeUsage/);
  }
  const hardening = source("supabase/migrations/20260905070000_prompt15_3_1_runtime_hardening.sql");
  assert.match(hardening, /analysis\.analysis_usage_key = target_idempotency_key/);
  assert.match(hardening, /if selected_status <> 'committed'/);
});

test("models, pricing, limits, and provider code are outside this database-only hotfix", () => {
  assert.doesNotMatch(hotfixMigration, /openai|gpt-5|price|checkout|webhook|paddle/i);
  const config = source("lib/ai/config.ts");
  const autoConvert = source("lib/csv/auto-convert-runner.ts");
  assert.match(config, /TESTED_COST_SAFE_ANALYSIS_FALLBACK = "gpt-5\.6-terra"/);
  assert.match(autoConvert, /OPENAI_AUTO_CONVERT_MODEL/);
});
