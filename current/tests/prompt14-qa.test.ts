import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  MAX_CSV_FILE_BYTES,
  MAX_CSV_ROWS,
} from "@/lib/csv/constants";
import { createNormalizedCsv, makeSpreadsheetTextInert } from "@/lib/csv/export";
import { createMappingPlan } from "@/lib/csv/mapping";
import {
  applyMappingRecipe,
  normalizeDealValue,
  normalizeQuoteDateWithFormat,
  parseCsvText,
  validateCsvFileMetadata,
  validateParsedCsvShape,
  validateSmartCsvRows,
} from "@/lib/csv/validation";
import { normalizeUploadedFilename } from "@/lib/csv/filename";
import { parseDealsQueryState } from "@/lib/deals/query-state";
import { applySecurityHeaders, isSensitivePath } from "@/lib/security/headers";
import { checkRateLimit, RATE_LIMITS, type RateLimitCounterStore } from "@/lib/security/rate-limit-core";

const root = process.cwd();

test("Prompt 14 currency fuzz preserves supported USD notation and rejects repeated markers", () => {
  for (const value of ["USD $12,500", "$12,500 USD"]) {
    assert.equal(normalizeDealValue(value).value, "12500.00", value);
  }
  for (const value of ["$$12,500", "USD USD 12,500"]) {
    const result = normalizeDealValue(value);
    assert.equal(result.value, null, value);
    assert.match(result.error, /valid amount/i);
  }
});

test("Prompt 14 currency boundaries reject non-finite, negative, foreign, and extreme values", () => {
  for (const value of ["-1", "(1,000)", "NaN", "Infinity", "12.500,00", "1000000000000.00"]) {
    assert.equal(normalizeDealValue(value).value, null, value);
  }
  for (const value of ["12500", "12,500", "$12,500.00", "USD 12,500", "12,500 USD"]) {
    assert.equal(normalizeDealValue(value).value, "12500.00", value);
  }
});

test("Prompt 14 invalid and ambiguous dates are distinguished without rollover", () => {
  for (const value of ["2026-02-30", "13/32/2026", "00/12/2026", "12/00/2026", "not-a-date"]) {
    const result = normalizeQuoteDateWithFormat(value);
    assert.equal(result.value, null, value);
    assert.equal(result.needsReview, false, value);
  }
  assert.equal(normalizeQuoteDateWithFormat("03/04/2026").needsReview, true);
  assert.equal(normalizeQuoteDateWithFormat("03/04/2026", "MM/DD/YYYY").value, "2026-03-04");
  assert.equal(normalizeQuoteDateWithFormat("03/04/2026", "DD/MM/YYYY").value, "2026-04-03");
});

test("Prompt 14 query fuzz accepts only a complete positive page integer", () => {
  for (const value of ["", "0", "-1", "2junk", "NaN", "1.5", "<script>2</script>", "999999999999999999999"]) {
    assert.equal(parseDealsQueryState({ page: value }).page, 1, value);
  }
  assert.equal(parseDealsQueryState({ page: "2" }).page, 2);
});

test("Prompt 14 query enums and long filters fail closed", () => {
  const state = parseDealsQueryState({
    sort: "recovery_score);drop",
    direction: "sideways",
    analysis: "unknown",
    priority: "urgent",
    reason: "<script>",
    q: `  ${"x".repeat(150)}  `,
  });
  assert.equal(state.sort, "created");
  assert.equal(state.direction, "desc");
  assert.equal(state.analysis, null);
  assert.equal(state.priority, null);
  assert.equal(state.reason, null);
  assert.equal(state.q.length, 100);
});

test("Prompt 14 file-size boundary is exact", () => {
  assert.equal(validateCsvFileMetadata({ name: "deals.csv", size: MAX_CSV_FILE_BYTES }), null);
  assert.match(validateCsvFileMetadata({ name: "deals.csv", size: MAX_CSV_FILE_BYTES + 1 }) ?? "", /larger than 5 MB/i);
});

test("Prompt 14 CSV shape rejects empty, header-only, duplicate headers, and 2,001 rows", () => {
  assert.match(validateParsedCsvShape(parseCsvText("")) ?? "", /header/i);
  assert.match(validateParsedCsvShape(parseCsvText("deal_value,sales_notes\n")) ?? "", /no deal rows/i);
  assert.match(validateParsedCsvShape(parseCsvText("Deal Value,deal_value\n1,note")) ?? "", /unique/i);
  const rows = Array.from({ length: MAX_CSV_ROWS + 1 }, (_, index) => `${index + 1},10,note`).join("\n");
  assert.match(validateParsedCsvShape(parseCsvText(`id,deal_value,sales_notes\n${rows}`)) ?? "", /2,000/i);
});

test("Prompt 14 maximum 2,000-row Smart Import stays bounded and makes no AI call", () => {
  const rows = Array.from({ length: MAX_CSV_ROWS }, (_, index) => `QA-${index + 1},12500,Lost,Customer ${index + 1},Safe note ${index + 1}`);
  const parsed = parseCsvText(`Opportunity ID,Quoted Amount,Status,Account Name,Call Notes\n${rows.join("\n")}`);
  assert.equal(validateParsedCsvShape(parsed), null);
  const plan = createMappingPlan(parsed.headers);
  const started = performance.now();
  const result = validateSmartCsvRows(parsed, plan.recipe);
  const elapsed = performance.now() - started;
  assert.equal(result.readyRows.length, MAX_CSV_ROWS);
  assert.equal(result.invalidRows.length, 0);
  assert.ok(elapsed < 2_000, `2,000-row validation took ${elapsed.toFixed(1)}ms`);
});

test("Prompt 14 Unicode name merge preserves source data without fabrication", () => {
  const parsed = parseCsvText("First Name,Last Name,Amount,Notes\nعبداللہ,وحید,5000,گاہک نے بعد میں رابطہ کرنے کو کہا");
  const plan = createMappingPlan(parsed.headers);
  const source = applyMappingRecipe(parsed.rows[0], parsed.headers, plan.recipe);
  assert.equal(source.customer_name, "عبداللہ وحید");
  const result = validateSmartCsvRows(parsed, plan.recipe);
  assert.equal(result.readyRows[0]?.customer_name, "عبداللہ وحید");
});

test("Prompt 14 normalized export makes formula-like text inert", () => {
  for (const value of ["=cmd()", "+SUM(A1)", "-1+2", "@IMPORTXML()"] ) {
    assert.equal(makeSpreadsheetTextInert(value), `'${value}`);
  }
  const csv = createNormalizedCsv([{
    rowNumber: 2,
    external_deal_id: "QA-1",
    customer_name: "<script>alert(1)</script>",
    deal_value: "100.00",
    quote_date: null,
    status: "lost",
    salesperson: null,
    service_type: null,
    lead_source: null,
    sales_notes: "=HYPERLINK(\"https://evil.example\")",
    transcript: null,
  }]);
  assert.match(csv, /'<script>|<script>/);
  assert.match(csv, /'=HYPERLINK/);
});

test("Prompt 14 hostile filenames remain display-only safe labels", () => {
  for (const value of ["../../evil.csv", "..\\..\\evil.csv", "<img src=x>.csv", " آزمائش.csv "]) {
    const safe = normalizeUploadedFilename(value);
    assert.ok(safe.length <= 180);
    assert.doesNotMatch(safe, /[<>\\/]/);
  }
});

test("Prompt 14 rate-limit counters remain atomic under bounded concurrency", async () => {
  let count = 0;
  const store: RateLimitCounterStore = {
    async increment() {
      count += 1;
      return count;
    },
  };
  const decisions = await Promise.all(Array.from({ length: 12 }, () => checkRateLimit(store, "qa-user", "upload_ai_mapping", 1_800_000)));
  assert.equal(decisions.filter((decision) => decision.allowed).length, RATE_LIMITS.upload_ai_mapping.limit);
  assert.equal(decisions.filter((decision) => !decision.allowed).length, 6);
  assert.ok(decisions.every((decision) => decision.retryAfterSeconds > 0));
});

test("Prompt 14 sensitive responses receive private cache and hardened headers", () => {
  for (const path of ["/dashboard", "/deals/uuid", "/upload", "/api/deals/delete"]) {
    assert.equal(isSensitivePath(path), true);
    const response = applySecurityHeaders(new Response("ok"), path, "https:");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=/);
  }
});

test("Prompt 14 normal page-load sources have no OpenAI or automatic scoring writes", () => {
  const files = [
    "app/(dashboard)/dashboard/page.tsx",
    "app/(dashboard)/deals/page.tsx",
    "app/(dashboard)/deals/[id]/page.tsx",
    "app/(dashboard)/upload/page.tsx",
    "app/page.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(`${root}/${file}`, "utf8");
    assert.doesNotMatch(source, /getOpenAIClient|responses\.(?:parse|create)|scoreAnalysis|\.update\(/, file);
  }
});

test("Prompt 14 public assets contain only the intended branded and synthetic files", () => {
  const files = readdirSync(`${root}/public`, { recursive: true }).map(String);
  assert.ok(files.includes("lostdeal-favicon-v2.ico"));
  assert.ok(files.includes("examples/smart-import-crm-example.csv"));
  for (const file of files) {
    assert.doesNotMatch(file, /(?:customer|private|session|credential|payload|debug).*\.(?:csv|json|log)$/i);
  }
});

test("Prompt 14 mutation routes export POST only and retain centralized guards", () => {
  const routes = [
    "app/api/deals/analyze/route.ts",
    "app/api/deals/analyze-batch/route.ts",
    "app/api/deals/delete/route.ts",
    "app/api/deals/score/route.ts",
    "app/api/deals/score-batch/route.ts",
    "app/api/uploads/auto-convert/route.ts",
    "app/api/uploads/import/route.ts",
    "app/api/uploads/normalize/route.ts",
    "app/api/uploads/suggest-mapping/route.ts",
    "app/api/uploads/validate/route.ts",
  ];
  for (const file of routes) {
    const source = readFileSync(`${root}/${file}`, "utf8");
    assert.match(source, /export async function POST/);
    assert.doesNotMatch(source, /export async function (?:GET|PUT|PATCH|DELETE)/);
    assert.match(source, /validateMutationRequest/);
    assert.match(source, /getAuthorizedRouteContext/);
    assert.match(source, /enforceRateLimitOrRespond/);
  }
});

test("Prompt 14 migrations remain immutable alongside authorized Prompt 15 forward migrations and no service-role runtime", () => {
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
    "20260916095842_prompt16_paddle_billing_foundation.sql",
  ]);
  const runtime = ["app", "components", "lib"].flatMap((directory) => {
    const walk = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${path}/${entry.name}`) : [`${path}/${entry.name}`]);
    return walk(`${root}/${directory}`);
  }).filter((file) => /\.(?:ts|tsx)$/.test(file));
  for (const file of runtime) assert.doesNotMatch(readFileSync(file, "utf8"), /SUPABASE_SERVICE_ROLE|service_role/);
});
