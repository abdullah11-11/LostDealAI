import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  PASSWORD_RESET_GENERIC_MESSAGE,
  parseAppOrigin,
  passwordRecoveryRateKey,
  passwordRecoveryRedirectUrl,
  validateNewPassword,
  validateRecoveryEmail,
} from "@/lib/auth/password-recovery";
import {
  PLAN_CATALOG,
  PLAN_CODES,
  UNLIMITED,
  getEntitlements,
  isUnlimited,
  type PlanCode,
} from "@/lib/billing/plans";
import { decideUsage, expectedDatabaseLimit, utcCalendarMonth } from "@/lib/billing/usage-core";
import {
  analyzeDealWithStore,
  type DealAnalysisStore,
  type SourceDealRow,
} from "@/lib/ai/analysis-workflow";
import type { AnalysisModelRunner } from "@/lib/ai/analyze-deal";
import { DealAnalysisError } from "@/lib/ai/errors";
import { checkRateLimit, RATE_LIMITS, type RateLimitCounterStore } from "@/lib/security/rate-limit-core";

const root = process.cwd();
const source = (path: string) => readFileSync(`${root}/${path}`, "utf8");

test("Prompt 15 exposes exactly the five centralized plan codes", () => {
  assert.deepEqual(PLAN_CODES, ["INTERNAL", "TRIAL", "STARTER", "PRO", "BUSINESS"]);
  assert.deepEqual(Object.keys(PLAN_CATALOG), PLAN_CODES);
  assert.equal(PLAN_CATALOG.INTERNAL.purchasable, false);
  assert.equal(PLAN_CATALOG.TRIAL.purchasable, false);
  for (const plan of ["STARTER", "PRO"] as const) {
    assert.equal(PLAN_CATALOG[plan].purchasable, true);
  }
  assert.equal(PLAN_CATALOG.BUSINESS.purchasable, false);
});

test("INTERNAL uses explicit unlimited values and unknown plans fail closed", () => {
  assert.equal(PLAN_CATALOG.INTERNAL.usage!.IMPORTED_DEALS, UNLIMITED);
  assert.equal(isUnlimited(PLAN_CATALOG.INTERNAL.usage!.AI_ANALYSES), true);
  assert.equal(isUnlimited(PLAN_CATALOG.INTERNAL.usage!.AI_MAPPING_REQUESTS), true);
  assert.equal(getEntitlements("UNKNOWN"), null);
  assert.equal(getEntitlements(null), null);
});

test("TRIAL, STARTER, and PRO resolve the approved commercial allowances", () => {
  const expected: Record<Exclude<PlanCode, "INTERNAL" | "BUSINESS">, [number, number, number]> = {
    TRIAL: [50, 10, 3],
    STARTER: [250, 30, 3],
    PRO: [1_500, 250, 30],
  };
  for (const [planCode, limits] of Object.entries(expected)) {
    const plan = PLAN_CATALOG[planCode as keyof typeof expected];
    assert.deepEqual([
      plan.usage!.IMPORTED_DEALS,
      plan.usage!.AI_ANALYSES,
      plan.usage!.AI_MAPPING_REQUESTS,
    ], limits);
    assert.equal(expectedDatabaseLimit(plan, "AI_ANALYSES"), limits[1]);
  }
  assert.equal(PLAN_CATALOG.BUSINESS.usage, null);
  assert.equal(expectedDatabaseLimit(PLAN_CATALOG.BUSINESS, "AI_ANALYSES"), undefined);
});

test("quota decisions handle below, exact, over, SHADOW, and INTERNAL safely", () => {
  assert.deepEqual(decideUsage(100, 98, 0, 1, "ENFORCED"), { allowed: true, wouldDeny: false, remaining: 2 });
  assert.deepEqual(decideUsage(100, 99, 0, 1, "ENFORCED"), { allowed: true, wouldDeny: false, remaining: 1 });
  assert.deepEqual(decideUsage(100, 100, 0, 1, "ENFORCED"), { allowed: false, wouldDeny: true, remaining: 0 });
  assert.deepEqual(decideUsage(100, 100, 0, 1, "SHADOW"), { allowed: true, wouldDeny: true, remaining: 0 });
  assert.deepEqual(decideUsage(UNLIMITED, 9_999, 500, 1, "ENFORCED"), { allowed: true, wouldDeny: false, remaining: null });
});

test("usage periods use deterministic UTC calendar boundaries", () => {
  assert.deepEqual(utcCalendarMonth(new Date("2026-09-30T23:59:59.999Z")), {
    start: "2026-09-01T00:00:00.000Z",
    end: "2026-10-01T00:00:00.000Z",
  });
  assert.deepEqual(utcCalendarMonth(new Date("2026-12-15T12:00:00.000Z")), {
    start: "2026-12-01T00:00:00.000Z",
    end: "2027-01-01T00:00:00.000Z",
  });
});

test("the applied Prompt 15 migration remains intact beside its authorized forward migrations", () => {
  const migrations = readdirSync(`${root}/supabase/migrations`).filter((file) => file.endsWith(".sql")).sort();
  assert.deepEqual(migrations, [
    "20260810000000_initial_lostdeal_schema.sql",
    "20260830000000_prompt12_deal_delete.sql",
    "20260901000000_prompt15_commercial_foundation.sql",
    "20260902000000_prompt15_1_plan_limits.sql",
    "20260902010000_prompt15_2_auto_convert_limit.sql",
    "20260902020000_prompt15_3_deep_analysis.sql",
    "20260905070000_prompt15_3_1_runtime_hardening.sql",
    "20260905083511_prompt15_3_2_usage_reservation_runtime_hotfix.sql",
    "20260906080228_prompt15_3_3_recovery_sort_rpc_auth_hotfix.sql",
    "20260908055554_prompt15_3_5_deep_semantic_diagnostic_hardening.sql",
    "20260916095842_prompt16_paddle_billing_foundation.sql", "20260917144440_prompt16_authority_dual_verifier.sql", "20260921064300_prompt16_paddle_simulator_event_id_compat.sql", "20260921073247_prompt16_authority_rotation_finalize.sql", "20260922083319_prompt16_billing_operation_rejection_recovery.sql", "20261005185926_prompt17a_atomic_operations_and_authorization.sql",
  ]);
  const migration = source("supabase/migrations/20260901000000_prompt15_commercial_foundation.sql");
  assert.match(migration, /create table public\.organization_subscriptions/i);
  assert.match(migration, /create table public\.organization_usage_events/i);
  assert.match(migration, /select[\s\S]*'INTERNAL'[\s\S]*from public\.organizations/i);
  assert.match(migration, /trial_end timestamptz := now\(\) \+ interval '14 days'/i);
  assert.match(migration, /values \([\s\S]*new\.id,[\s\S]*'TRIAL'/i);
  assert.match(migration, /after insert on public\.organizations/i);
  assert.doesNotMatch(migration, /card_number|credit_card|\bcvv\b|payment_method_data/i);
});

test("commercial tables are tenant-readable and direct plan/usage DML is denied", () => {
  const migration = source("supabase/migrations/20260901000000_prompt15_commercial_foundation.sql");
  for (const table of ["organization_subscriptions", "organization_usage_events"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(migration, new RegExp(`on public\\.${table}[\\s\\S]*for select[\\s\\S]*private\\.is_org_member\\(organization_id\\)`, "i"));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, "i"));
    assert.doesNotMatch(migration, new RegExp(`grant (?:insert|update|delete|truncate) on table public\\.${table} to authenticated`, "i"));
    assert.doesNotMatch(migration, new RegExp(`on public\\.${table}[\\s\\S]*for (?:insert|update|delete)\\s+to authenticated`, "i"));
  }
  assert.doesNotMatch(migration, /service_role/i);
  assert.match(migration, /public\.reserve_organization_usage\(\s*target_authority_secret text,\s*target_organization_id uuid,\s*target_metric text,\s*target_units integer,\s*target_idempotency_key text\s*\)/i);
  assert.doesNotMatch(migration, /public\.reserve_organization_usage\([\s\S]{0,300}target_plan_code/i);
  assert.match(migration, /create extension if not exists pgcrypto with schema extensions/i);
  assert.match(migration, /extensions\.digest\(coalesce\(target_authority_secret, ''\), 'sha256'\)/i);
  assert.match(migration, /USAGE_AUTHORITY_INVALID/i);
  const authorityVerifiers = [...migration.matchAll(/is distinct from '([0-9a-f]{64})'/gi)]
    .map((match) => match[1]);
  assert.equal(authorityVerifiers.length, 2);
  assert.equal(new Set(authorityVerifiers).size, 1);
});

test("quota reservations are tenant-scoped, idempotent, atomic, and concurrency safe", () => {
  const migration = source("supabase/migrations/20260901000000_prompt15_commercial_foundation.sql");
  assert.match(migration, /private\.is_org_member\(target_organization_id\)/i);
  assert.match(migration, /unique \(organization_id, metric, idempotency_key\)/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /committed_total \+ reserved_total \+ target_units <= selected_limit/i);
  assert.match(migration, /reservation_expires_at[\s\S]*interval '15 minutes'/i);
  assert.match(migration, /target_reservation_token[\s\S]*target_committed_units <= units/i);
  assert.doesNotMatch(migration, /release_organization_usage|refund_organization_usage/i);
});

test("database entitlement mirror stays aligned with the typed catalog", () => {
  const migration = source("supabase/migrations/20260902000000_prompt15_1_plan_limits.sql");
  const metricSql = {
    IMPORTED_DEALS: "IMPORTED_DEALS",
    AI_ANALYSES: "AI_ANALYSES",
    AI_MAPPING_REQUESTS: "AI_MAPPING_REQUESTS",
  } as const;
  for (const planCode of PLAN_CODES) {
    for (const metric of Object.keys(metricSql) as Array<keyof typeof metricSql>) {
      const limit = expectedDatabaseLimit(PLAN_CATALOG[planCode], metric);
      if (limit === undefined) {
        assert.equal(planCode, "BUSINESS");
        assert.match(migration, /BUSINESS remains a compatibility code only/i);
        assert.doesNotMatch(migration, new RegExp(`target_plan_code = '${planCode}' and target_metric = '${metricSql[metric]}' then`, "i"));
      } else if (limit === null) {
        assert.match(migration, new RegExp(`target_plan_code = '${planCode}'[\\s\\S]*then null`, "i"));
      } else {
        assert.match(migration, new RegExp(`target_plan_code = '${planCode}' and target_metric = '${metricSql[metric]}' then ${limit}`, "i"));
      }
    }
  }
});

function analysisFixture(reservation: { allowed: boolean; isNew: boolean }) {
  const row: SourceDealRow = {
    id: "11111111-1111-4111-8111-111111111111",
    deal_value: 8_500,
    quote_date: "2026-08-01",
    service_type: "HVAC",
    status: "lost",
    sales_notes: "Customer liked the system but said the monthly payment is too high.",
    transcript: "Customer: The monthly payment is too high right now.",
    analysis_status: "pending",
  };
  let reserveCalls = 0;
  let commitCalls = 0;
  const store: DealAnalysisStore = {
    async fetch(id) { return id === row.id ? { ...row } : null; },
    async inspectExisting() { return null; },
    async repairCompleted() { return false; },
    async scoreCompleted() { return true; },
    async reserveUsage() {
      reserveCalls += 1;
      return {
        ...reservation,
        available: true,
        requiresFinalization: true,
        usageKey: `analysis:${row.id}`,
      };
    },
    async finalizeUsage() { commitCalls += 1; return true; },
    async claim() { row.analysis_status = "processing"; return true; },
    async persistAndComplete() { row.analysis_status = "completed"; return true; },
    async fail() { row.analysis_status = "failed"; },
    async countPending() { return row.analysis_status === "pending" ? 1 : 0; },
    async listPending() { return row.analysis_status === "pending" ? [row.id] : []; },
  };
  return { row, store, reserveCalls: () => reserveCalls, commitCalls: () => commitCalls };
}

const successfulRunner: AnalysisModelRunner = async () => ({
  analysis: {
    lost_reason: "FINANCING",
    lost_reason_detail: "The customer's monthly payment concern prevented the purchase.",
    buying_intent_score: 75,
    confidence_score: 90,
    evidence: [{ source: "TRANSCRIPT", excerpt: "The monthly payment is too high right now." }],
    positive_signals: ["Customer liked the system"],
    negative_signals: ["Monthly payment concern"],
    recommended_action: "Discuss available payment structures without promising terms.",
    recommended_timing: "Within 48 hours",
    recommended_channel: "HUMAN_CALL",
    follow_up_message: "Would you like to review available payment structures?",
  },
  model: "synthetic-model",
  responseId: "synthetic-response",
  usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 },
});

test("analysis over quota makes zero provider calls", async () => {
  const fixture = analysisFixture({ allowed: false, isNew: true });
  let providerCalls = 0;
  const result = await analyzeDealWithStore(fixture.store, fixture.row.id, async (input) => {
    providerCalls += 1;
    return successfulRunner(input);
  });
  assert.deepEqual(result, { status: "quota_exceeded" });
  assert.equal(fixture.reserveCalls(), 1);
  assert.equal(providerCalls, 0);
  assert.equal(fixture.commitCalls(), 0);
});

test("successful fresh analysis reserves and commits exactly one usage operation", async () => {
  const fixture = analysisFixture({ allowed: true, isNew: true });
  let providerCalls = 0;
  const result = await analyzeDealWithStore(fixture.store, fixture.row.id, async (input) => {
    providerCalls += 1;
    return successfulRunner(input);
  });
  assert.equal(result.status, "completed");
  assert.equal(fixture.reserveCalls(), 1);
  assert.equal(providerCalls, 1);
  assert.equal(fixture.commitCalls(), 1);
});

test("analysis provider failure leaves the reservation uncommitted", async () => {
  const fixture = analysisFixture({ allowed: true, isNew: true });
  let providerCalls = 0;
  const result = await analyzeDealWithStore(fixture.store, fixture.row.id, async () => {
    providerCalls += 1;
    throw new DealAnalysisError("AI_TEMPORARILY_UNAVAILABLE");
  });
  assert.equal(result.status, "failed");
  assert.equal(providerCalls, 1);
  assert.equal(fixture.commitCalls(), 0);
});

test("completed analysis reload uses zero quota and zero provider calls", async () => {
  const fixture = analysisFixture({ allowed: true, isNew: true });
  fixture.row.analysis_status = "completed";
  let providerCalls = 0;
  const result = await analyzeDealWithStore(fixture.store, fixture.row.id, async (input) => {
    providerCalls += 1;
    return successfulRunner(input);
  });
  assert.deepEqual(result, { status: "completed", fresh: false });
  assert.equal(fixture.reserveCalls(), 0);
  assert.equal(providerCalls, 0);
});

test("AI Smart Mapping follows authorization, rate, reservation, provider, commit order", () => {
  const route = source("app/api/uploads/suggest-mapping/route.ts");
  const ordered = [
    "getAuthorizedRouteContext",
    "enforceRateLimitOrRespond",
    "reserveOrganizationUsage",
    "suggestCsvMapping",
    "saveOperation",
  ].map((term) => route.indexOf(term, route.indexOf("export async function POST")));
  assert.ok(ordered.every((index) => index >= 0));
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered);
  assert.match(route, /"AI_MAPPING_REQUESTS",\s*1/);
  assert.match(route, /if \(!reservation\.allowed\)[\s\S]*status: 403/);
  assert.match(route, /if \(!reservation\.isNew\)[\s\S]*status: 409/);
});

test("import atomically commits only ready rows and rolls back partial-batch failure", () => {
  const route = source("app/api/uploads/import/route.ts");
  const sql = source("supabase/migrations/20261005185926_prompt17a_atomic_operations_and_authorization.sql");
  assert.match(route, /rpc\("persist_deal_import"/);
  assert.match(route, /target_rows: rows/);
  assert.match(sql, /row_count := jsonb_array_length\(target_rows\)/);
  assert.match(sql, /'IMPORTED_DEALS',[\s\S]*reservation.reservation_token,row_count/);
  assert.match(sql, /IMPORT_USAGE_COMMIT_FAILED/);
  assert.doesNotMatch(route, /\.insert\(|commitOrganizationUsage/);
});

test("deterministic/manual mapping, normalization, scoring, and page loads consume zero usage", () => {
  const zeroUsageFiles = [
    "lib/csv/mapping.ts",
    "app/api/uploads/normalize/route.ts",
    "app/api/deals/score/route.ts",
    "app/api/deals/score-batch/route.ts",
    "app/(dashboard)/dashboard/page.tsx",
    "app/(dashboard)/deals/page.tsx",
    "app/(dashboard)/deals/[id]/page.tsx",
    "app/(dashboard)/upload/page.tsx",
  ];
  for (const file of zeroUsageFiles) {
    const code = source(file);
    assert.doesNotMatch(code, /reserveOrganizationUsage|commitOrganizationUsage|organization_usage_events/, file);
    assert.doesNotMatch(code, /responses\.(?:parse|create)|getOpenAIClient/, file);
  }
});

test("Plan & Usage and the Upload feature gate use read-only authenticated snapshots", () => {
  const account = source("app/(dashboard)/account/page.tsx");
  assert.match(account, /requireOrganization\(plan === "STARTER"/);
  assert.match(account, /getOrganizationUsageSnapshot/);
  assert.match(account, /Current Plan/);
  assert.match(account, /Imported Deals/);
  assert.match(account, /AI Analyses/);
  assert.match(account, /AI Smart Mapping/);
  assert.match(account, /Current Period/);
  assert.doesNotMatch(account, /reserveOrganizationUsage|commitOrganizationUsage|\.insert\(|\.update\(|OpenAI/);
  const upload = source("app/(dashboard)/upload/page.tsx");
  assert.match(upload, /requireOrganization\("\/upload"\)/);
  assert.match(upload, /getOrganizationUsageSnapshot/);
  assert.match(upload, /resolveAutoConvertAccess/);
  assert.doesNotMatch(upload, /reserveOrganizationUsage|commitOrganizationUsage|\.insert\(|\.update\(|responses\.(?:parse|create)/);
  for (const file of ["app/(dashboard)/dashboard/page.tsx", "app/(dashboard)/deals/page.tsx"]) {
    assert.doesNotMatch(source(file), /getOrganizationUsageSnapshot/, file);
  }
});

test("Forgot Password validates email and preserves enumeration-safe generic copy", () => {
  const valid = new FormData();
  valid.set("email", " Owner@Example.COM ");
  assert.deepEqual(validateRecoveryEmail(valid), { email: "owner@example.com", fieldErrors: {} });
  const invalid = new FormData();
  invalid.set("email", "not-an-email");
  assert.match(validateRecoveryEmail(invalid).fieldErrors.email ?? "", /valid email/i);
  assert.equal(PASSWORD_RESET_GENERIC_MESSAGE, "If an account exists for that email, a password reset link has been sent.");
  const actions = source("app/actions/auth.ts");
  assert.match(actions, /resetPasswordForEmail/);
  assert.match(actions, /PASSWORD_RESET_GENERIC_MESSAGE/);
  assert.doesNotMatch(actions, /listUsers|admin\.|user not found|email exists/i);
});

test("password-recovery limiter keys are normalized hashes and threshold is 5 per 15 minutes", async () => {
  const first = await passwordRecoveryRateKey(" Owner@Example.com ");
  const second = await passwordRecoveryRateKey("owner@example.COM");
  assert.equal(first, second);
  assert.doesNotMatch(first, /owner|example\.com/i);
  assert.match(first, /^password-recovery:[0-9a-f]{64}$/);
  assert.deepEqual(RATE_LIMITS.forgot_password, { limit: 5, windowSeconds: 15 * 60 });

  let count = 0;
  const store: RateLimitCounterStore = { async increment() { count += 1; return count; } };
  const decisions = await Promise.all(Array.from({ length: 6 }, () => checkRateLimit(store, first, "forgot_password", 0)));
  assert.equal(decisions.filter((decision) => decision.allowed).length, 5);
  assert.equal(decisions.at(-1)?.allowed, false);
});

test("new-password validation covers empty, weak, mismatch, and valid values", () => {
  const empty = validateNewPassword(new FormData());
  assert.match(empty.fieldErrors.password ?? "", /enter/i);
  const weak = new FormData();
  weak.set("password", "short");
  weak.set("passwordConfirmation", "short");
  assert.match(validateNewPassword(weak).fieldErrors.password ?? "", /8/);
  const mismatch = new FormData();
  mismatch.set("password", "long-enough-password");
  mismatch.set("passwordConfirmation", "different-password");
  assert.match(validateNewPassword(mismatch).fieldErrors.passwordConfirmation ?? "", /match/i);
  const valid = new FormData();
  valid.set("password", "long-enough-password");
  valid.set("passwordConfirmation", "long-enough-password");
  assert.deepEqual(validateNewPassword(valid).fieldErrors, {});
});

test("recovery origin and redirect are strict, same-origin, and token-free", () => {
  assert.equal(parseAppOrigin("https://app.example.com"), "https://app.example.com");
  assert.equal(parseAppOrigin("http://localhost:3000"), "http://localhost:3000");
  for (const unsafe of [
    "http://app.example.com",
    "https://app.example.com/path",
    "https://user:pass@app.example.com",
    "https://app.example.com?next=https://evil.example",
  ]) assert.throws(() => parseAppOrigin(unsafe));
  const redirect = new URL(passwordRecoveryRedirectUrl("https://app.example.com"));
  assert.equal(redirect.origin, "https://app.example.com");
  assert.equal(redirect.pathname, "/auth/confirm");
  assert.equal(redirect.searchParams.get("next"), "/reset-password");
  assert.equal(redirect.searchParams.get("type"), "recovery");
  assert.equal(redirect.searchParams.has("token_hash"), false);
});

test("reset requires verified recovery state, updates password, clears state, and signs out", () => {
  const confirm = source("app/auth/confirm/route.ts");
  const page = source("app/(auth)/reset-password/page.tsx");
  const actions = source("app/actions/auth.ts");
  assert.match(confirm, /requestedType === "recovery"[\s\S]*PASSWORD_RECOVERY_COOKIE/);
  assert.match(confirm, /recoveryReturn[\s\S]*exchangeCodeForSession\(code\)/);
  assert.match(confirm, /httpOnly: true/);
  assert.match(confirm, /sameSite: "strict"/);
  assert.match(confirm, /maxAge: PASSWORD_RECOVERY_MAX_AGE_SECONDS/);
  assert.match(confirm, /reset-password\?error=invalid/);
  assert.match(page, /getVerifiedIdentity/);
  assert.match(page, /PASSWORD_RECOVERY_COOKIE/);
  assert.match(actions, /getVerifiedIdentity\(supabase\)[\s\S]*updateUser\(\{ password \}\)/);
  assert.match(actions, /cookieStore\.delete\(PASSWORD_RECOVERY_COOKIE\)/);
  assert.match(actions, /signOut\(\{ scope: "global" \}\)/);
  assert.match(actions, /redirect\("\/login\?reset=success"\)/);
  assert.doesNotMatch(confirm + actions, /console\.(?:log|info|warn|error)/i);
});

test("commercial mode stays server-only SHADOW with only authorized Paddle packages", () => {
  const config = source("lib/billing/config.ts");
  const envExample = source(".env.example");
  const pkg = JSON.parse(source("package.json")) as { dependencies: Record<string, string> };
  assert.match(config, /import "server-only"/);
  assert.match(config, /BILLING_ENFORCEMENT_MODE/);
  assert.match(config, /BILLING_USAGE_AUTHORITY_SECRET/);
  assert.match(config, /\^\[0-9a-f\]\{64\}\$\/i/);
  assert.match(config, /: "SHADOW"/);
  assert.match(envExample, /BILLING_ENFORCEMENT_MODE=SHADOW/);
  assert.match(envExample, /^BILLING_USAGE_AUTHORITY_SECRET=$/m);
  assert.match(source("lib/billing/usage.ts"), /target_authority_secret: authoritySecret/g);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_BILLING|STRIPE_SECRET|NEXT_PUBLIC_PADDLE_API|LEMON_SQUEEZY_API/i);
  assert.deepEqual(Object.keys(pkg.dependencies).filter((name) => /stripe|paddle|lemonsqueezy|paypro/i.test(name)).sort(), ["@paddle/paddle-js", "@paddle/paddle-node-sdk"]);
  const runtime = ["app", "components", "lib"].flatMap((directory) => {
    const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`]);
    return walk(`${root}/${directory}`);
  }).filter((file) => /\.(?:ts|tsx)$/.test(file));
  for (const file of runtime) {
    const code = source(file.slice(root.length + 1));
    assert.doesNotMatch(code, /SUPABASE_SERVICE_ROLE|service_role|STRIPE_SECRET|LEMON_SQUEEZY_API_KEY/);
    if (!file.endsWith("/lib/billing/paddle-server.ts")) assert.doesNotMatch(code, /PADDLE_API_KEY/);
    else assert.match(code, /import "server-only"/);
  }
});

test("Prompt 15 commercial documents exist without public pricing claims", () => {
  for (const file of [
    "docs/LAUNCH_GAP_REGISTER.md",
    "docs/PRICING_RECOMMENDATION.md",
    "docs/PAYMENT_PROVIDER_RESEARCH.md",
    "docs/UNIT_ECONOMICS.md",
    "docs/BILLING_ARCHITECTURE.md",
  ]) assert.ok(source(file).length > 500, file);
  const landing = source("app/page.tsx");
  assert.doesNotMatch(landing, /\$39|\$99|\$199|Start checkout|Buy now/i);
  assert.match(source("docs/LAUNCH_GAP_REGISTER.md"), /not commercially launch-ready/i);
});
