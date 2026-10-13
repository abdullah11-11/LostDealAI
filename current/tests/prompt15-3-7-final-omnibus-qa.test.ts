import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { AI_CONFIG } from "@/lib/ai/config";
import { PLAN_CATALOG } from "@/lib/billing/plans";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

function assertOrdered(body: string, markers: readonly string[]): void {
  let cursor = -1;
  for (const marker of markers) {
    const position = body.indexOf(marker, cursor + 1);
    assert.notEqual(position, -1, `missing ordered marker: ${marker}`);
    assert.ok(position > cursor, `out-of-order marker: ${marker}`);
    cursor = position;
  }
}

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

test("all applied migrations remain immutable and Prompt 15.3.7 adds no migration", () => {
  const hashes: Record<string, string> = {
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
  };
  const migrations = readdirSync(join(root, "supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  assert.deepEqual(migrations, [...Object.keys(hashes), "20260916095842_prompt16_paddle_billing_foundation.sql", "20260917144440_prompt16_authority_dual_verifier.sql", "20260921064300_prompt16_paddle_simulator_event_id_compat.sql", "20260921073247_prompt16_authority_rotation_finalize.sql", "20260922083319_prompt16_billing_operation_rejection_recovery.sql", "20261005185926_prompt17a_atomic_operations_and_authorization.sql"]);
  assert.equal(migrations.some((file) => file.includes("prompt15_3_7")), false);
  for (const [file, expected] of Object.entries(hashes)) {
    const actual = createHash("sha256")
      .update(source(`supabase/migrations/${file}`))
      .digest("hex");
    assert.equal(actual, expected, file);
  }
});

test("TypeScript build metadata is ignored while required Vinext font assets stay tracked", () => {
  const ignore = source(".gitignore");
  assert.match(ignore, /^\*\.tsbuildinfo$/m);

  if (existsSync(join(root, ".git"))) {
    const buildMetadata = execFileSync(
      "git",
      ["ls-files", "-z", "--", "tsconfig.tsbuildinfo"],
      { cwd: root, encoding: "utf8" },
    ).split("\0").filter(Boolean);
    const fontAssets = execFileSync(
      "git",
      ["ls-files", "-z", "--", ".vinext/fonts"],
      { cwd: root, encoding: "utf8" },
    ).split("\0").filter(Boolean);
    assert.deepEqual(buildMetadata, []);
    assert.ok(fontAssets.length > 0);
  }
});

test("build configuration avoids deprecated or future-incompatible loader forms", () => {
  const config = source("vite.config.ts");
  const typescript = source("tsconfig.json");
  const artifactValidation = source("scripts/validate-artifact.sh");
  const loaderRegistration = source("scripts/register-cloudflare-workers-loader.mjs");
  assert.match(config, /hosting\.json" with \{ type: "json" \}/);
  assert.match(config, /build\/sites-vite-plugin\.ts"/);
  assert.match(typescript, /"allowImportingTsExtensions": true/);
  assert.doesNotMatch(config, /from "\.\/\.openai\/hosting\.json";/);
  assert.doesNotMatch(config, /from "\.\/build\/sites-vite-plugin";/);
  assert.doesNotMatch(artifactValidation, /--experimental-loader/);
  assert.match(artifactValidation, /--import "\$\{loader_registration\}"/);
  assert.match(loaderRegistration, /register\(new URL\("\.\/cloudflare-workers-loader\.mjs"/);
});

test("Deep provider execution stays behind identity, tenant, access, schema, usage, and claim gates", () => {
  const route = source("app/api/deals/analyze-deep/route.ts");
  const post = route.slice(route.indexOf("export async function POST"));
  assertOrdered(post, [
    "getAuthorizedRouteContext()",
    "validateMutationRequest(",
    "authorizeDealReference(",
    "enforceRateLimitOrRespond(",
    "getOrganizationUsageSnapshot(",
    "resolveDeepAnalysisAccess(",
    "isDeepAnalysisSchemaReady(",
    "analyzeAuthorizedDeepDeal(",
  ]);

  const workflow = source("lib/ai/deep-analysis-workflow.ts");
  const operation = workflow.slice(workflow.indexOf("export async function analyzeDeepDealWithStore"));
  assertOrdered(operation, [
    "store.inspectExisting(",
    "store.reserveUsage(",
    "store.claim(",
    "analyzeDeepDeal(trustedSource(deal), runModel)",
    "store.persistAndComplete(",
  ]);
  const freshResult = operation.slice(operation.indexOf("let result: CompletedDeepDealAnalysis"));
  assertOrdered(freshResult, [
    "analyzeDeepDeal(trustedSource(deal), runModel)",
    "store.persistAndComplete(",
    "finalizeUsageWithBoundedRetry(",
    "store.scoreCompleted(",
  ]);
});

test("read-only UI sources cannot invoke provider clients or benchmark harnesses", () => {
  const apiSegment = `${join("app", "api")}${process.platform === "win32" ? "\\" : "/"}`;
  const pageFiles = sourceFiles("app").filter((file) => !file.includes(apiSegment));
  const uiFiles = [...pageFiles, ...sourceFiles("components")];
  const uiSource = uiFiles.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(uiSource, /getOpenAIClient|responses\.parse|OPENAI_API_KEY|runOpenAI(?:Deep)?Analysis/);

  const runtimeSource = ["app", "components", "lib", "worker"]
    .flatMap(sourceFiles)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(runtimeSource, /scripts\/benchmark|benchmark-analysis-models|benchmark-auto-convert/);
});

test("provider privacy, model locks, pricing, limits, scoring, and SHADOW rollout remain unchanged", () => {
  const environment = source(".env.example");
  const billing = source("lib/billing/config.ts");
  const scoring = source("lib/scoring/recovery-score.ts");
  for (const runner of [
    "lib/ai/openai-runner.ts",
    "lib/ai/deep-openai-runner.ts",
    "lib/csv/ai-mapping-runner.ts",
    "lib/csv/auto-convert-runner.ts",
  ]) {
    assert.match(source(runner), /store:\s*false/);
  }

  assert.equal(AI_CONFIG.standardModel, "gpt-5.6-terra");
  assert.equal(AI_CONFIG.deepModel, "gpt-5.6-terra");
  assert.equal(AI_CONFIG.deepPromptVersion, "deep-1.3");
  assert.equal(AI_CONFIG.deepSchemaVersion, "deep-1.0");
  assert.match(environment, /^BILLING_ENFORCEMENT_MODE=SHADOW$/m);
  assert.match(environment, /^OPENAI_AUTO_CONVERT_MODEL=gpt-5\.6-luna$/m);
  assert.match(environment, /^OPENAI_STANDARD_ANALYSIS_MODEL=gpt-5\.6-terra$/m);
  assert.match(environment, /^OPENAI_DEEP_ANALYSIS_MODEL=gpt-5\.6-terra$/m);
  assert.match(billing, /:\s*"SHADOW";/);
  assert.doesNotMatch(billing, /NEXT_PUBLIC_/);
  assert.equal(PLAN_CATALOG.STARTER.monthlyPriceUsd, 15);
  assert.equal(PLAN_CATALOG.STARTER.usage?.AI_ANALYSES, 30);
  assert.equal(PLAN_CATALOG.PRO.monthlyPriceUsd, 45);
  assert.equal(PLAN_CATALOG.PRO.usage?.AI_ANALYSES, 250);
  assert.equal(PLAN_CATALOG.BUSINESS.purchasable, false);
  assert.equal(PLAN_CATALOG.BUSINESS.usage, null);
  assert.doesNotMatch(scoring, /OpenAI|runModel|provider|deep_analysis/i);
});

test("the canonical SQL checklist matches the current eight-table protected-write model", () => {
  const checks = source("supabase/tests/schema_checks.sql");
  for (const table of [
    "profiles",
    "organizations",
    "organization_members",
    "uploads",
    "deals",
    "deal_analyses",
    "organization_subscriptions",
    "organization_usage_events",
  ]) {
    assert.match(checks, new RegExp(`'${table}'`));
  }
  assert.match(checks, /deal_analyses_select_org_member/);
  assert.doesNotMatch(checks, /deal_analyses_(?:insert|update)_org_member/);
  assert.match(checks, /authenticated_cannot_write_protected_columns/);
  assert.match(checks, /PROMPT15_3_7_SCHEMA_CHECKS_PASS/);
});

test("operator documentation closes Prompt 15.3.x while keeping commercial launch blocked", () => {
  const deep = source("docs/DEEP_RECOVERY_ANALYSIS.md");
  const security = source("docs/PRODUCTION_SECURITY_CHECKLIST.md");
  const gaps = source("docs/LAUNCH_GAP_REGISTER.md");

  assert.match(deep, /Prompt 15\.3\.7 final omnibus QA/);
  assert.match(deep, /Synthetic Juniper[\s\S]*exactly\s+one[\s\S]*reload[\s\S]*zero/i);
  assert.match(security, /\[x\].*Synthetic Juniper Deep run/i);
  assert.match(security, /production audit[\s\S]*zero[\s\S]*critical[\s\S]*high[\s\S]*moderate[\s\S]*low/i);
  assert.match(security, /development audit[\s\S]*two high[\s\S]*one low/i);
  assert.match(security, /semver-major Vinext beta/i);
  assert.match(gaps, /Deep Recovery Analysis \| DONE/);
  assert.match(gaps, /Prompt 15\.3\.x Analysis QA \| DONE/);
  assert.match(gaps, /Build-tool dependency review \| DONE with scoped exception/);
  assert.match(gaps, /eight HIGH dependency nodes solely from braces advisory GHSA-vfj7-8cjw-p6xm on the two approved dev\/build paths/);
  assert.match(gaps, /exception expires 2026-11-04 or immediately when a patched release appears/);
  assert.match(gaps, /Paddle sandbox QA \| DONE \(sandbox\)/);
  assert.match(gaps, /not commercially launch-ready/i);
});
