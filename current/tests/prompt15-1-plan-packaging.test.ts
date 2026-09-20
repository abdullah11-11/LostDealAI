import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  PLAN_CATALOG,
  PLAN_FEATURES,
  UNLIMITED,
  hasPlanFeature,
  isFutureTrialPreviewEligible,
  isUnlimited,
} from "@/lib/billing/plans";
import { decideUsage, expectedDatabaseLimit } from "@/lib/billing/usage-core";

const root = process.cwd();
const source = (path: string) => readFileSync(`${root}/${path}`, "utf8");

function runtimeFiles(): string[] {
  const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`]
  ));
  return ["app", "components", "lib"].flatMap((directory) => walk(`${root}/${directory}`))
    .filter((file) => /\.(?:ts|tsx)$/.test(file));
}

test("Prompt 15.1 catalog contains the owner-approved truthful prices and availability", () => {
  assert.deepEqual({
    TRIAL: PLAN_CATALOG.TRIAL.priceLabel,
    STARTER: PLAN_CATALOG.STARTER.priceLabel,
    PRO: PLAN_CATALOG.PRO.priceLabel,
    BUSINESS: PLAN_CATALOG.BUSINESS.priceLabel,
  }, {
    TRIAL: "$0 / 14 days",
    STARTER: "$15/month",
    PRO: "$45/month",
    BUSINESS: "Coming Soon",
  });
  assert.equal(PLAN_CATALOG.INTERNAL.priceLabel, null);
  assert.equal(PLAN_CATALOG.STARTER.monthlyPriceUsd, 15);
  assert.equal(PLAN_CATALOG.PRO.monthlyPriceUsd, 45);
  assert.equal(PLAN_CATALOG.BUSINESS.monthlyPriceUsd, null);
  assert.equal(PLAN_CATALOG.BUSINESS.purchasable, false);
  assert.equal(PLAN_CATALOG.BUSINESS.availability, "COMING_SOON");
});

test("Starter includes the complete current core without future Pro operations", () => {
  for (const feature of [
    "standardAnalysis",
    "smartImport",
    "aiSmartMapping",
    "normalizedCsvExport",
    "dealIntelligence",
    "batchAnalysis",
  ] as const) assert.equal(hasPlanFeature("STARTER", feature), true, feature);
  assert.equal(hasPlanFeature("STARTER", "autoConvert"), false);
  assert.equal(hasPlanFeature("STARTER", "deepAnalysis"), false);
  assert.deepEqual(PLAN_CATALOG.STARTER.usage, {
    IMPORTED_DEALS: 250,
    AI_ANALYSES: 30,
    AI_MAPPING_REQUESTS: 3,
    AUTO_CONVERT_ROWS: 0,
  });
});

test("Pro inherits every Starter capability, adds future entitlements, and has higher limits", () => {
  for (const feature of PLAN_FEATURES) {
    if (PLAN_CATALOG.STARTER.features[feature]) assert.equal(hasPlanFeature("PRO", feature), true, feature);
  }
  assert.equal(hasPlanFeature("PRO", "autoConvert"), true);
  assert.equal(hasPlanFeature("PRO", "deepAnalysis"), true);
  assert.deepEqual(PLAN_CATALOG.PRO.usage, {
    IMPORTED_DEALS: 1_500,
    AI_ANALYSES: 250,
    AI_MAPPING_REQUESTS: 30,
    AUTO_CONVERT_ROWS: 1_500,
  });
  for (const metric of ["IMPORTED_DEALS", "AI_ANALYSES", "AI_MAPPING_REQUESTS"] as const) {
    const starterLimit = expectedDatabaseLimit(PLAN_CATALOG.STARTER, metric);
    const proLimit = expectedDatabaseLimit(PLAN_CATALOG.PRO, metric);
    assert.equal(typeof starterLimit, "number");
    assert.equal(typeof proLimit, "number");
    if (typeof starterLimit === "number" && typeof proLimit === "number") {
      assert.ok(proLimit > starterLimit, metric);
    }
  }
});

test("Trial preserves approved limits and future preview eligibility without live Pro access", () => {
  assert.deepEqual(PLAN_CATALOG.TRIAL.usage, {
    IMPORTED_DEALS: 50,
    AI_ANALYSES: 10,
    AI_MAPPING_REQUESTS: 3,
    AUTO_CONVERT_ROWS: 25,
  });
  assert.equal(hasPlanFeature("TRIAL", "autoConvert"), false);
  assert.equal(hasPlanFeature("TRIAL", "deepAnalysis"), false);
  assert.equal(isFutureTrialPreviewEligible("TRIAL", "autoConvert"), true);
  assert.equal(isFutureTrialPreviewEligible("TRIAL", "deepAnalysis"), true);
  assert.equal(isFutureTrialPreviewEligible("STARTER", "autoConvert"), false);
});

test("Business is an inactive compatibility tier with no fake connected capability", () => {
  assert.equal(PLAN_CATALOG.BUSINESS.purchasable, false);
  assert.equal(PLAN_CATALOG.BUSINESS.usage, null);
  assert.equal(expectedDatabaseLimit(PLAN_CATALOG.BUSINESS, "IMPORTED_DEALS"), undefined);
  assert.equal(hasPlanFeature("BUSINESS", "connectedDataSource"), false);
  assert.equal(PLAN_CATALOG.BUSINESS.priceLabel, "Coming Soon");
  for (const file of runtimeFiles()) {
    const code = readFileSync(file, "utf8");
    if (!file.endsWith("/components/billing-controls.tsx")) assert.doesNotMatch(code, /createCheckout|checkout\.open|Paddle\.Checkout|lemonsqueezy/i, file);
    else assert.match(code, /checkout-intent/);
  }
});

test("Internal remains hidden, non-purchasable, unlimited, and owner-safe", () => {
  assert.equal(PLAN_CATALOG.INTERNAL.availability, "INTERNAL");
  assert.equal(PLAN_CATALOG.INTERNAL.purchasable, false);
  assert.equal(PLAN_CATALOG.INTERNAL.priceLabel, null);
  assert.equal(PLAN_CATALOG.INTERNAL.usage?.IMPORTED_DEALS, UNLIMITED);
  assert.equal(isUnlimited(PLAN_CATALOG.INTERNAL.usage!.AI_ANALYSES), true);
  assert.deepEqual(decideUsage(UNLIMITED, 1_000_000, 5_000, 1, "ENFORCED"), {
    allowed: true,
    wouldDeny: false,
    remaining: null,
  });
});

test("updated quotas calculate would-deny while SHADOW preserves current access", () => {
  assert.deepEqual(decideUsage(30, 30, 0, 1, "SHADOW"), {
    allowed: true,
    wouldDeny: true,
    remaining: 0,
  });
  assert.deepEqual(decideUsage(250, 249, 0, 1, "ENFORCED"), {
    allowed: true,
    wouldDeny: false,
    remaining: 1,
  });
  assert.deepEqual(decideUsage(250, 250, 0, 1, "ENFORCED"), {
    allowed: false,
    wouldDeny: true,
    remaining: 0,
  });
  assert.match(source("lib/billing/config.ts"), /: "SHADOW"/);
  assert.match(source(".env.example"), /BILLING_ENFORCEMENT_MODE=SHADOW/);
});

test("clients have no plan-escalation mutation path", () => {
  const migration = source("supabase/migrations/20260901000000_prompt15_commercial_foundation.sql");
  assert.match(migration, /revoke all on table public\.organization_subscriptions from anon, authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete) on table public\.organization_subscriptions to authenticated/i);
  assert.doesNotMatch(migration, /for (?:insert|update|delete)\s+to authenticated/i);
  for (const file of runtimeFiles()) {
    const code = readFileSync(file, "utf8");
    assert.doesNotMatch(code, /from\(["']organization_subscriptions["']\)[\s\S]{0,180}\.(?:insert|update|upsert|delete)\(/, file);
    if (!file.endsWith("/lib/billing/routes.ts")) assert.doesNotMatch(code, /(?:request|body|payload)\.(?:plan|planCode|plan_code)/, file);
    else { assert.match(code, /planSchema/); assert.match(code, /organization.role !== "owner"/); }
  }
});

test("Plan & Usage derives pricing from the catalog and exposes live metrics", () => {
  const account = source("app/(dashboard)/account/page.tsx");
  assert.match(account, /snapshot\.plan\.priceLabel/);
  assert.doesNotMatch(account, /\$15|\$45|\$29|\$59/);
  for (const label of ["Imported Deals", "AI Analyses", "AI Smart Mapping", "AI Auto Convert"]) assert.match(account, new RegExp(label));
  assert.doesNotMatch(account, /Deep Analysis usage/i);
  assert.match(account, /Business is coming soon/);
  assert.match(account, /not purchasable/);
  assert.doesNotMatch(account, /createCheckout|href=["'][^"']*checkout|Buy now|Subscribe now/i);
});

test("the forward migration changes only the private limit mirror and preserves Prompt 15", () => {
  const original = source("supabase/migrations/20260901000000_prompt15_commercial_foundation.sql");
  assert.equal(createHash("sha256").update(original).digest("hex"), "1ddbc82204a0340588a8bf9925962c2b7ce3cf6ccf46e875304cf88bc1a8efd8");
  const forward = source("supabase/migrations/20260902000000_prompt15_1_plan_limits.sql");
  assert.match(forward, /create or replace function private\.plan_usage_limit/i);
  assert.match(forward, /STARTER'[\s\S]*'AI_ANALYSES' then 30/i);
  assert.match(forward, /PRO'[\s\S]*'AI_MAPPING_REQUESTS' then 30/i);
  assert.doesNotMatch(forward, /create table|alter table|create policy|create trigger|service_role/i);
});

test("normal page loads and deterministic scoring remain zero-OpenAI and zero-usage-write", () => {
  for (const file of [
    "app/(dashboard)/account/page.tsx",
    "app/(dashboard)/dashboard/page.tsx",
    "app/(dashboard)/deals/page.tsx",
    "app/(dashboard)/deals/[id]/page.tsx",
    "app/(dashboard)/upload/page.tsx",
    "app/page.tsx",
  ]) {
    const code = source(file);
    assert.doesNotMatch(code, /getOpenAIClient|responses\.(?:create|parse)|reserveOrganizationUsage|commitOrganizationUsage/, file);
  }
  for (const file of ["app/api/deals/score/route.ts", "app/api/deals/score-batch/route.ts"]) {
    const code = source(file);
    assert.doesNotMatch(code, /getOpenAIClient|responses\.(?:create|parse)|reserveOrganizationUsage|commitOrganizationUsage/, file);
  }
});

test("commercial documents record the approved provider and product decisions", () => {
  const pricing = source("docs/PRICING_RECOMMENDATION.md");
  const research = source("docs/PAYMENT_PROVIDER_RESEARCH.md");
  const gaps = source("docs/LAUNCH_GAP_REGISTER.md");
  assert.match(pricing, /OWNER-APPROVED CURRENT DIRECTION/);
  assert.match(pricing, /Starter[\s\S]*\$15/);
  assert.match(pricing, /Pro[\s\S]*\$45/);
  assert.match(pricing, /Business[\s\S]*Coming Soon/i);
  assert.match(research, /Preferred provider:\*\*\s*\*\*Paddle\*\*/i);
  assert.match(research, /Pakistan-based individual \/ sole trader/i);
  assert.match(research, /approval pending/i);
  assert.match(gaps, /Pricing direction[\s\S]*DONE/i);
  assert.match(gaps, /Paddle account approval[\s\S]*PENDING/i);
});
