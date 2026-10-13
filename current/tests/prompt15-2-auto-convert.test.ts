import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { resolveAutoConvertAccess } from "@/lib/billing/auto-convert-access";
import { PLAN_CATALOG, UNLIMITED } from "@/lib/billing/plans";
import { decideUsage } from "@/lib/billing/usage-core";
import {
  AUTO_CONVERT_MAX_BATCH_CHARACTERS,
  AUTO_CONVERT_BATCH_CONCURRENCY,
  AUTO_CONVERT_MAX_ROWS_PER_BATCH,
  buildAutoConvertBatches,
  buildAutoConvertPlan,
  executeAutoConvertPlan,
} from "@/lib/csv/auto-convert";
import {
  AutoConvertExtractionOutputSchema,
  AutoConvertExtractionRequestSchema,
  type AutoConvertExtractionOutput,
  type AutoConvertExtractionRequest,
} from "@/lib/csv/auto-convert-schema";
import type { AiMappingOutput } from "@/lib/csv/ai-mapping-schema";
import { CANONICAL_FIELDS } from "@/lib/csv/constants";
import { createCanonicalCsv } from "@/lib/csv/export";
import { createMappingPlan } from "@/lib/csv/mapping";
import { parseCsvText, validateSmartCsvRows } from "@/lib/csv/validation";
import { checkRateLimit, RATE_LIMITS, type RateLimitCounterStore } from "@/lib/security/rate-limit-core";

const root = process.cwd();
const source = (path: string) => readFileSync(`${root}/${path}`, "utf8");

const emptyMappingRunner = async (): Promise<AiMappingOutput> => ({ suggestions: [] });
const emptyExtractionRunner = async (request: AutoConvertExtractionRequest): Promise<AutoConvertExtractionOutput> => ({
  results: request.rows.map((row) => ({ row_reference: row.row_reference, fields: [] })),
});

function canonicalCsv(rows: number): string {
  const body = Array.from({ length: rows }, (_, index) => [
    `AUTO-${index + 1}`,
    `Customer ${index + 1}`,
    "12800",
    "2026-08-14",
    "Lost",
    "Alex",
    "Carrier heat pump",
    "Google Ads",
    "Alex handled the quote. Lead came from Google Ads.",
    "Synthetic customer transcript.",
  ].join(","));
  return [CANONICAL_FIELDS.join(","), ...body].join("\n");
}

test("Auto Convert limits and feature entitlements match the approved plans", () => {
  assert.equal(PLAN_CATALOG.TRIAL.usage?.AUTO_CONVERT_ROWS, 25);
  assert.equal(PLAN_CATALOG.STARTER.usage?.AUTO_CONVERT_ROWS, 0);
  assert.equal(PLAN_CATALOG.PRO.usage?.AUTO_CONVERT_ROWS, 1_500);
  assert.equal(PLAN_CATALOG.INTERNAL.usage?.AUTO_CONVERT_ROWS, UNLIMITED);
  assert.equal(PLAN_CATALOG.BUSINESS.usage, null);
  assert.equal(PLAN_CATALOG.STARTER.features.autoConvert, false);
  assert.equal(PLAN_CATALOG.PRO.features.autoConvert, true);
});

test("commercial SHADOW never converts a Pro entitlement into provider access", () => {
  assert.deepEqual(resolveAutoConvertAccess("INTERNAL", "active", "SHADOW"), {
    state: "ACTIVE", entitled: true, providerExecutionAllowed: true, trialPreviewEligible: false,
  });
  assert.equal(resolveAutoConvertAccess("STARTER", "active", "SHADOW").state, "LOCKED");
  assert.equal(resolveAutoConvertAccess("STARTER", "active", "SHADOW").providerExecutionAllowed, false);
  assert.equal(resolveAutoConvertAccess("PRO", "active", "SHADOW").state, "BILLING_PENDING");
  assert.equal(resolveAutoConvertAccess("PRO", "active", "SHADOW").providerExecutionAllowed, false);
  assert.equal(resolveAutoConvertAccess("TRIAL", "trialing", "SHADOW").trialPreviewEligible, true);
  assert.equal(resolveAutoConvertAccess("TRIAL", "trialing", "SHADOW").providerExecutionAllowed, false);
});

test("future ENFORCED mode requires a verified compatible subscription state", () => {
  assert.equal(resolveAutoConvertAccess("PRO", "active", "ENFORCED").providerExecutionAllowed, true);
  assert.equal(resolveAutoConvertAccess("PRO", "canceled", "ENFORCED").providerExecutionAllowed, false);
  assert.equal(resolveAutoConvertAccess("TRIAL", "trialing", "ENFORCED").providerExecutionAllowed, true);
  assert.equal(resolveAutoConvertAccess("TRIAL", "active", "ENFORCED").providerExecutionAllowed, false);
  assert.equal(resolveAutoConvertAccess("BUSINESS", "active", "ENFORCED").providerExecutionAllowed, false);
});

test("complete canonical data stays in the one deterministic pipeline with zero provider calls", async () => {
  const parsed = parseCsvText(canonicalCsv(1));
  const plan = buildAutoConvertPlan(parsed);
  assert.equal(plan.reservationUnits, 0);
  let mappingCalls = 0;
  let extractionCalls = 0;
  const result = await executeAutoConvertPlan(
    plan,
    async () => { mappingCalls += 1; throw new Error("unexpected"); },
    async () => { extractionCalls += 1; throw new Error("unexpected"); },
  );
  assert.equal(mappingCalls, 0);
  assert.equal(extractionCalls, 0);
  assert.equal(result.usageUnits, 0);
  assert.equal(result.rows[0].values.deal_value, "12800.00");
  assert.equal(result.rows[0].values.quote_date, "2026-08-14");
});

test("simple messy headers are resolved by the existing deterministic aliases", async () => {
  const parsed = parseCsvText("Client Name,Quote Total,Rep,Outcome,Comments\nSarah,\"$12,800\",Alex,Lost,Financing delayed the purchase");
  const deterministic = createMappingPlan(parsed.headers);
  assert.equal(deterministic.recipe.customer_name?.sources[0], 0);
  assert.equal(deterministic.recipe.deal_value?.sources[0], 1);
  assert.equal(deterministic.recipe.salesperson?.sources[0], 2);
  assert.equal(deterministic.recipe.status?.sources[0], 3);
  assert.equal(deterministic.recipe.sales_notes?.sources[0], 4);
});

test("chaotic but known aliases resolve without a second schema", () => {
  const parsed = parseCsvText("Prospect,Opportunity Size,Closer,Disposition,Random Notes\nSarah,12800,Alex,Declined,Financing blocker");
  const recipe = createMappingPlan(parsed.headers).recipe;
  assert.deepEqual([
    recipe.customer_name?.sources[0],
    recipe.deal_value?.sources[0],
    recipe.salesperson?.sources[0],
    recipe.status?.sources[0],
  ], [0, 1, 2, 3]);
});

test("blob extraction is evidence-backed and preserves source-labelled notes", async () => {
  const parsed = parseCsvText("Customer,CRM Dump\nSarah,\"Alex quoted Sarah $12,800 for a Carrier heat pump. Financing is the blocker. Call again in September.\"");
  const plan = buildAutoConvertPlan(parsed);
  const mappingRunner = async (): Promise<AiMappingOutput> => ({ suggestions: [{
    source_column: "CRM Dump", target: "sales_notes", confidence: "HIGH", reason: "Source sales context",
  }] });
  const result = await executeAutoConvertPlan(plan, mappingRunner, async (request) => ({
    results: request.rows.map((row) => ({ row_reference: row.row_reference, fields: [
      { target: "deal_value", value: "12800", confidence: "HIGH", source_column: "CRM Dump", evidence: "quoted Sarah $12,800" },
      { target: "salesperson", value: "Alex", confidence: "HIGH", source_column: "CRM Dump", evidence: "Alex quoted Sarah" },
      { target: "service_type", value: "Carrier heat pump", confidence: "HIGH", source_column: "CRM Dump", evidence: "Carrier heat pump" },
    ] })),
  }));
  const row = result.rows[0].values;
  assert.equal(row.customer_name, "Sarah");
  assert.equal(row.deal_value, "12800.00");
  assert.equal(row.salesperson, "Alex");
  assert.equal(row.service_type, "Carrier heat pump");
  assert.equal(row.quote_date, "");
  assert.match(row.sales_notes, /^CRM Dump: Alex quoted Sarah/);
  assert.equal(result.provenance.length, 3);
  assert.equal(result.provenance.every((item) => item.sourceColumn === "CRM Dump" && item.evidence.length > 0), true);
});

test("no-information source never fabricates missing customer facts", async () => {
  const parsed = parseCsvText("CRM Dump\nCustomer called.");
  const plan = buildAutoConvertPlan(parsed);
  const result = await executeAutoConvertPlan(
    plan,
    async () => ({ suggestions: [{ source_column: "CRM Dump", target: "sales_notes", confidence: "HIGH", reason: "Source context" }] }),
    emptyExtractionRunner,
  );
  const row = result.rows[0].values;
  assert.equal(row.customer_name, "");
  assert.equal(row.deal_value, "");
  assert.equal(row.quote_date, "");
  assert.equal(row.salesperson, "");
  assert.equal(row.service_type, "");
  assert.equal(row.status, "Needs review");
});

test("deterministic quote amount wins over contradictory text extraction", async () => {
  const parsed = parseCsvText("Quote Amount,Status,CRM Notes\n\"$12,000\",Lost,\"Earlier quote was $10,000; revised proposal is $12,000.\"");
  const plan = buildAutoConvertPlan(parsed);
  const result = await executeAutoConvertPlan(plan, emptyMappingRunner, async (request) => ({ results: request.rows.map((row) => ({
    row_reference: row.row_reference,
    fields: [{ target: "deal_value", value: "10000", confidence: "HIGH", source_column: "CRM Notes", evidence: "Earlier quote was $10,000" }],
  })) }));
  assert.equal(result.rows[0].values.deal_value, "12000.00");
  assert.equal(result.provenance.some((item) => item.target === "deal_value"), false);
});

test("Won, Sold, Completed, accepted, and paid-deposit source cannot become Lost", async () => {
  for (const sourceText of ["Customer won the bid", "Deal sold", "Completed", "Customer accepted the proposal", "Customer paid a deposit"]) {
    const parsed = parseCsvText(`Notes\n${sourceText}`);
    const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), emptyMappingRunner, async (request) => ({
      results: request.rows.map((row) => ({ row_reference: row.row_reference, fields: [{
        target: "status", value: "Lost", confidence: "HIGH", source_column: "Notes", evidence: sourceText,
      }] })),
    }));
    assert.equal(result.rows[0].values.status, "Won", sourceText);
  }
  const notSold = parseCsvText("Notes\nDeal was not sold");
  const safe = await executeAutoConvertPlan(buildAutoConvertPlan(notSold), emptyMappingRunner, emptyExtractionRunner);
  assert.notEqual(safe.rows[0].values.status, "Won");
});

test("ambiguous dates are rejected even when the model chooses an interpretation", async () => {
  const parsed = parseCsvText("Status,Notes\nLost,Quote created 03/04/2026");
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), emptyMappingRunner, async (request) => ({
    results: request.rows.map((row) => ({ row_reference: row.row_reference, fields: [{
      target: "quote_date", value: "2026-03-04", confidence: "HIGH", source_column: "Notes", evidence: "03/04/2026",
    }] })),
  }));
  assert.equal(result.rows[0].values.quote_date, "");
  assert.match(result.issues.map((item) => item.message).join(" "), /evidence was rejected/i);
});

test("supported currency expressions normalize while ambiguous, negative, and malformed evidence is rejected", async () => {
  const evidence = ["quoted 12.8k", "quoted 12K", "proposal was $12,800", "estimate: USD 12,800", "quote 12.500,00", "quote -12800", "quote twelve thousand"];
  const parsed = parseCsvText(["Status,Notes", ...evidence.map((value) => `Lost,\"${value.replaceAll('"', '""')}\"`)].join("\n"));
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), emptyMappingRunner, async (request) => ({
    results: request.rows.map((row) => ({ row_reference: row.row_reference, fields: [{
      target: "deal_value", value: /\b12K\b/.test(row.sources[0].value) ? "12000" : "12800", confidence: "HIGH", source_column: "Notes", evidence: row.sources[0].value,
    }] })),
  }));
  assert.deepEqual(result.rows.slice(0, 4).map((row) => row.values.deal_value), ["12800.00", "12000.00", "12800.00", "12800.00"]);
  assert.deepEqual(result.rows.slice(4).map((row) => row.values.deal_value), ["", "", ""]);
});

test("invalid evidence, random names, and unsupported lead inference are rejected", async () => {
  const parsed = parseCsvText("Status,Notes\nLost,Alex spoke with Jamie after a web visit");
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), emptyMappingRunner, async (request) => ({
    results: request.rows.map((row) => ({ row_reference: row.row_reference, fields: [
      { target: "deal_value", value: "15000", confidence: "HIGH", source_column: "Notes", evidence: "Alex spoke with Jamie" },
      { target: "salesperson", value: "Alex", confidence: "HIGH", source_column: "Notes", evidence: "Alex spoke with Jamie" },
      { target: "lead_source", value: "web", confidence: "HIGH", source_column: "Notes", evidence: "web visit" },
    ] })),
  }));
  assert.equal(result.rows[0].values.deal_value, "");
  assert.equal(result.rows[0].values.salesperson, "");
  assert.equal(result.rows[0].values.lead_source, "");
  assert.equal(result.provenance.length, 0);
});

test("medium critical mappings block while medium non-critical mappings are provisional", async () => {
  const parsed = parseCsvText("Mystery Money,Text Blob\n12800,Synthetic source note");
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), async () => ({ suggestions: [
    { source_column: "Mystery Money", target: "deal_value", confidence: "MEDIUM", reason: "Possible amount" },
    { source_column: "Text Blob", target: "sales_notes", confidence: "MEDIUM", reason: "Likely notes" },
  ] }), emptyExtractionRunner);
  assert.equal(result.recipe.deal_value, null);
  assert.equal(result.recipe.sales_notes?.sources[0], 1);
  assert.equal(result.mappingDecisions.find((item) => item.target === "deal_value")?.applied, false);
  assert.equal(result.mappingDecisions.find((item) => item.target === "sales_notes")?.reviewRecommended, true);
});

test("strict extraction schemas reject arbitrary keys, targets, and executable transforms", () => {
  assert.equal(AutoConvertExtractionRequestSchema.safeParse({ rows: [{
    row_reference: 2,
    unresolved_targets: ["deal_value"],
    sources: [{ column: "Notes", value: "quoted $10,000" }],
  }] }).success, true);
  assert.equal(AutoConvertExtractionRequestSchema.safeParse({ rows: [{
    row_reference: 2,
    unresolved_targets: ["DROP_TABLE"],
    sources: [{ column: "Notes", value: "payload" }],
  }] }).success, false);
  assert.equal(AutoConvertExtractionOutputSchema.safeParse({ results: [{
    row_reference: 2,
    fields: [{ target: "deal_value", value: "100", confidence: "HIGH", source_column: "Notes", evidence: "100", transform: "eval()" }],
  }] }).success, false);
  assert.equal(AutoConvertExtractionOutputSchema.safeParse({ results: [{
    row_reference: 2,
    fields: [{ target: "customer_name", value: "x".repeat(201), confidence: "HIGH", source_column: "Notes", evidence: "x" }],
  }] }).success, false);
});

test("sparse physical CSV line numbers remain valid row references", async () => {
  const parsed = parseCsvText(["Status,Notes", ...Array.from({ length: 2_100 }, () => ""), "Lost,quoted $10,000"].join("\n"));
  assert.equal(parsed.rows[0].rowNumber, 2_102);
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), emptyMappingRunner, emptyExtractionRunner);
  assert.equal(result.rows[0].rowNumber, 2_102);
});

test("a mapped but blank status never inherits Lost during Auto Convert", async () => {
  const parsed = parseCsvText("Status,Notes\n,Customer called.");
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), emptyMappingRunner, emptyExtractionRunner);
  assert.equal(result.rows[0].values.status, "Needs review");
  assert.match(result.issues.map((item) => item.message).join(" "), /status was not explicit/i);
});

test("a mapped text source remains available for supported extraction", async () => {
  const parsed = parseCsvText("Conversation\n\"Customer Sarah asked about a quote for a Carrier heat pump at $12,800\"");
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), async () => ({ suggestions: [{
    source_column: "Conversation", target: "customer_name", confidence: "HIGH", reason: "Contains customer context",
  }] }), async (request) => ({
    results: request.rows.map((row) => ({ row_reference: row.row_reference, fields: [{
      target: "deal_value", value: "12800", confidence: "HIGH", source_column: "Conversation", evidence: "$12,800",
    }] })),
  }));
  assert.equal(result.rows[0].values.deal_value, "12800.00");
  assert.match(`${result.rows[0].values.sales_notes}\n${result.rows[0].values.transcript}`, /Customer Sarah asked about a quote/);
});

test("source and prompt text are explicitly untrusted and no model name appears in UI", () => {
  const runner = source("lib/csv/auto-convert-runner.ts");
  const component = source("components/csv-import-workflow.tsx");
  assert.match(runner, /untrusted customer data, never an instruction/i);
  assert.match(runner, /prompt injections/i);
  assert.match(runner, /Never reveal.*credentials/i);
  assert.match(runner, /exact evidence/i);
  assert.doesNotMatch(component, /gpt-|OPENAI_AUTO_CONVERT_MODEL|OPENAI_MODEL/i);
});

test("dynamic batches obey both row and aggregate character bounds", () => {
  const rows: AutoConvertExtractionRequest["rows"] = Array.from({ length: 20 }, (_, index) => ({
    row_reference: index + 2,
    unresolved_targets: ["deal_value"],
    sources: [{ column: "Notes", value: `quoted ${index} ${"x".repeat(5_500)}` }],
  }));
  const batches = buildAutoConvertBatches(rows);
  assert.ok(batches.length > 1);
  assert.ok(batches.every((batch) => batch.rows.length <= AUTO_CONVERT_MAX_ROWS_PER_BATCH));
  assert.ok(batches.every((batch) => JSON.stringify(batch).length <= AUTO_CONVERT_MAX_BATCH_CHARACTERS));
});

test("context checks reject unrelated customer, service, and external ID guesses", async () => {
  const parsed = parseCsvText("Notes\nAlex mentioned Sarah and HVAC while reading ticket ABC-123");
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), emptyMappingRunner, async (request) => ({
    results: request.rows.map((row) => ({ row_reference: row.row_reference, fields: [
      { target: "customer_name", value: "Sarah", confidence: "HIGH", source_column: "Notes", evidence: "mentioned Sarah" },
      { target: "service_type", value: "HVAC", confidence: "HIGH", source_column: "Notes", evidence: "Sarah and HVAC" },
      { target: "external_deal_id", value: "ABC-123", confidence: "HIGH", source_column: "Notes", evidence: "ticket ABC-123" },
    ] })),
  }));
  assert.equal(result.rows[0].values.customer_name, "");
  assert.equal(result.rows[0].values.service_type, "");
  assert.equal(result.rows[0].values.external_deal_id, "");
});

test("a competitor winning is not misclassified as the customer's Won deal", async () => {
  const parsed = parseCsvText("Status,Notes\nLost,Competitor won the contract");
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), emptyMappingRunner, emptyExtractionRunner);
  assert.equal(result.rows[0].values.status, "lost");
});

test("future Trial quota rejects an over-limit reservation before provider execution", () => {
  assert.deepEqual(decideUsage(25, 25, 0, 1, "ENFORCED"), {
    allowed: false,
    wouldDeny: true,
    remaining: 0,
  });
  assert.deepEqual(decideUsage(25, 0, 0, 25, "ENFORCED"), {
    allowed: true,
    wouldDeny: false,
    remaining: 25,
  });
  assert.deepEqual(decideUsage(25, 0, 25, 1, "ENFORCED"), {
    allowed: false,
    wouldDeny: true,
    remaining: 0,
  });
});

for (const rowCount of [25, 100, 500, 1_500]) {
  test(`${rowCount}-row synthetic Auto Convert stays bounded with zero paid calls`, async () => {
    const csv = ["Status,Notes", ...Array.from({ length: rowCount }, (_, index) => `Lost,Synthetic quote ${index + 1} needs structured preparation`)].join("\n");
    const plan = buildAutoConvertPlan(parseCsvText(csv));
    assert.equal(plan.reservationUnits, rowCount);
    let requests = 0;
    const result = await executeAutoConvertPlan(plan, emptyMappingRunner, async (request) => {
      requests += 1;
      return emptyExtractionRunner(request);
    });
    assert.equal(requests, Math.ceil(rowCount / AUTO_CONVERT_MAX_ROWS_PER_BATCH));
    assert.equal(result.providerRowsCompleted, rowCount);
    assert.equal(result.usageUnits, rowCount);
    assert.equal(result.rows.length, rowCount);
  });
}

test("partial provider failure retains completed results and identifies only remaining rows", async () => {
  const csv = ["Status,Notes", ...Array.from({ length: 55 }, (_, index) => `Lost,Synthetic row ${index + 1}`)].join("\n");
  let calls = 0;
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parseCsvText(csv)), emptyMappingRunner, async (request) => {
    calls += 1;
    if (calls === 2) throw new Error("provider unavailable");
    return emptyExtractionRunner(request);
  });
  assert.equal(result.partial, true);
  assert.equal(result.providerRowsCompleted, 30);
  assert.equal(result.usageUnits, 30);
  assert.equal(result.retryableRowNumbers.length, 25);
  assert.deepEqual(result.retryableRowNumbers.slice(0, 2), [27, 28]);
});

test("extraction batches use bounded concurrency without becoming extra user starts", async () => {
  const csv = ["Status,Notes", ...Array.from({ length: 100 }, (_, index) => `Lost,Synthetic row ${index + 1}`)].join("\n");
  let active = 0;
  let maxActive = 0;
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parseCsvText(csv)), emptyMappingRunner, async (request) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return emptyExtractionRunner(request);
  });
  assert.equal(maxActive, AUTO_CONVERT_BATCH_CONCURRENCY);
  assert.equal(result.providerRowsCompleted, 100);
  assert.equal(result.usageUnits, 100);
});

test("a provider failure before any completed extraction batch commits zero row usage", async () => {
  const parsed = parseCsvText("Status,Notes\nLost,Synthetic unresolved row");
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parsed), emptyMappingRunner, async () => {
    throw new Error("provider unavailable");
  });
  assert.equal(result.partial, true);
  assert.equal(result.providerRowsCompleted, 0);
  assert.equal(result.usageUnits, 0);
  assert.deepEqual(result.retryableRowNumbers, [2]);
});

test("Auto Converted rows roundtrip through the canonical validator", async () => {
  const result = await executeAutoConvertPlan(buildAutoConvertPlan(parseCsvText(canonicalCsv(3))), emptyMappingRunner, emptyExtractionRunner);
  const exported = createCanonicalCsv(result.rows.map((row) => row.values));
  const reparsed = parseCsvText(exported);
  const validated = validateSmartCsvRows(reparsed, createMappingPlan(reparsed.headers).recipe);
  assert.equal(validated.readyRows.length, 3);
  assert.equal(validated.invalidRows.length, 0);
  assert.equal(exported.split(/\r?\n/)[0], CANONICAL_FIELDS.join(","));
});

test("Auto Convert uses the existing three-start D1 limiter plus operation protection", async () => {
  assert.deepEqual(RATE_LIMITS.upload_auto_convert, { limit: 3, windowSeconds: 15 * 60 });
  assert.deepEqual(RATE_LIMITS.upload_auto_convert_operation, { limit: 1, windowSeconds: 15 * 60 });
  let count = 0;
  const store: RateLimitCounterStore = { async increment() { count += 1; return count; } };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await checkRateLimit(store, "user", "upload_auto_convert", 0)).allowed, true);
  }
  assert.equal((await checkRateLimit(store, "user", "upload_auto_convert", 0)).allowed, false);
});

test("route authority order blocks feature and quota failures before OpenAI", () => {
  const route = source("app/api/uploads/auto-convert/route.ts");
  const start = route.indexOf("export async function POST");
  const ordered = [
    "getAuthorizedRouteContext",
    "getOrganizationUsageSnapshot",
    "resolveAutoConvertAccess",
    "validateMutationRequest",
    "enforceRateLimitOrRespond",
    "reserveOrganizationUsage",
    "executeAutoConvertPlan",
  ].map((term) => route.indexOf(term, start));
  assert.ok(ordered.every((index) => index >= 0));
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered);
  assert.match(route, /!access\.providerExecutionAllowed[\s\S]*status|!access\.providerExecutionAllowed[\s\S]*403/);
  assert.match(route, /"AUTO_CONVERT_ROWS"/);
  assert.match(route, /`auto-convert:\$\{operationValue\}`/);
  assert.doesNotMatch(route, /AI_MAPPING_REQUESTS|AI_ANALYSES|organization_id|plan_code|usage_limit|service_role/i);
});

test("Auto Convert output never invokes Deal Analysis or Recovery Score", () => {
  const files = [
    source("app/api/uploads/auto-convert/route.ts"),
    source("lib/csv/auto-convert.ts"),
    source("lib/csv/auto-convert-runner.ts"),
  ].join("\n");
  assert.doesNotMatch(files, /analyzeDeal|deal_analyses|recovery_score|scoreAnalysis|scoreCompleted|score-batch/i);
  const importRoute = source("app/api/uploads/import/route.ts");
  assert.doesNotMatch(importRoute, /getOpenAIClient|responses\.(?:parse|create)|scoreAnalysis/);
});

test("the one forward migration extends the generic ledger without new tables", () => {
  const migrations = readdirSync(`${root}/supabase/migrations`).filter((file) => file.endsWith(".sql")).sort();
  assert.equal(migrations.includes("20260902010000_prompt15_2_auto_convert_limit.sql"), true);
  const migration = source("supabase/migrations/20260902010000_prompt15_2_auto_convert_limit.sql");
  assert.match(migration, /organization_usage_events_metric_valid[\s\S]*AUTO_CONVERT_ROWS/i);
  assert.match(migration, /TRIAL'[\s\S]*AUTO_CONVERT_ROWS' then 25/i);
  assert.match(migration, /STARTER'[\s\S]*AUTO_CONVERT_ROWS' then 0/i);
  assert.match(migration, /PRO'[\s\S]*AUTO_CONVERT_ROWS' then 1500/i);
  assert.match(migration, /INTERNAL'[\s\S]*AUTO_CONVERT_ROWS'[\s\S]*then null/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /unique|on conflict \(organization_id, metric, idempotency_key\)/i);
  assert.doesNotMatch(migration, /create table|service_role|create policy/i);
  assert.equal(source("supabase/migrations/20260901000000_prompt15_commercial_foundation.sql").includes("AUTO_CONVERT_ROWS"), false);
  assert.equal(source("supabase/migrations/20260902000000_prompt15_1_plan_limits.sql").includes("AUTO_CONVERT_ROWS"), false);
  const commercialChecks = source("supabase/tests/prompt15_commercial_checks.sql");
  assert.match(commercialChecks, /TRIAL'[\s\S]*AUTO_CONVERT_ROWS'\) = 25/i);
  assert.match(commercialChecks, /STARTER'[\s\S]*AUTO_CONVERT_ROWS'\) = 0/i);
  assert.match(commercialChecks, /PRO'[\s\S]*AUTO_CONVERT_ROWS'\) = 1500/i);
  assert.match(commercialChecks, /INTERNAL'[\s\S]*AUTO_CONVERT_ROWS'\) is null/i);
});

test("Upload UI exposes active, teaser, fallback, privacy, progress, and bounded details", () => {
  const component = source("components/csv-import-workflow.tsx");
  assert.match(component, /Auto Convert with AI/);
  assert.match(component, /Let LostDeal AI automatically map, clean and prepare this file/);
  assert.match(component, /Available with Pro/);
  assert.match(component, /href="\/account\?plan=PRO"/);
  assert.doesNotMatch(component, /when billing launches/);
  assert.match(component, /Continue with Smart Mapping/);
  assert.match(component, /Use Smart Mapping instead/);
  assert.match(component, /selected column names and bounded row content/);
  assert.match(component, /Understanding file and preparing rows/);
  assert.match(component, /View conversion details/);
  assert.match(component, /max-h-\[32rem\]/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /<details/);
  assert.match(component, /tabIndex=\{-1\}/);
  assert.match(component, /sm:grid-cols|lg:grid-cols/);
  assert.doesNotMatch(component, /Upgrade now|Buy Pro|checkout/i);
});

test("Auto Convert documentation and no-call benchmark record the bounded rollout", () => {
  const documentation = source("docs/AUTO_CONVERT.md");
  const economics = source("docs/UNIT_ECONOMICS.md");
  const benchmark = source("scripts/benchmark-auto-convert.ts");
  assert.match(documentation, /deterministic-first/i);
  assert.match(documentation, /store: false/);
  assert.match(documentation, /three Auto Convert starts per authenticated user per 15 minutes/i);
  assert.match(documentation, /BILLING_ENFORCEMENT_MODE=SHADOW/);
  assert.match(economics, /\$0\.27–\$0\.48/);
  assert.match(benchmark, /paidCalls:\s*0/);
  assert.match(benchmark, /\[25, 100, 500, 1_500\]/);
});

test("Plan & Usage labels Auto Convert for each current plan state without a Starter 0/0", () => {
  const account = source("app/(dashboard)/account/page.tsx");
  assert.match(account, /AI Auto Convert/);
  assert.match(account, /Rows prepared \/ Current allowance/);
  assert.match(account, /snapshot\.plan\.planCode === "STARTER"/);
  assert.match(account, /Pro feature/);
  assert.doesNotMatch(account, /auto_convert_rows/);
});

test("source, client, and runtime boundaries retain no raw-file persistence or public model override", () => {
  const route = source("app/api/uploads/auto-convert/route.ts");
  const runner = source("lib/csv/auto-convert-runner.ts");
  const envExample = source(".env.example");
  assert.doesNotMatch(route, /from\(["'](?:uploads|deals)["']\)\.(?:insert|update|upsert)/i);
  assert.doesNotMatch(route + runner, /console\.(?:log|info|warn|error)/i);
  assert.match(runner, /process\.env\.OPENAI_AUTO_CONVERT_MODEL/);
  assert.match(runner, /store:\s*false/);
  assert.match(source("lib/csv/ai-mapping-runner.ts"), /store:\s*false/);
  assert.match(envExample, /^OPENAI_AUTO_CONVERT_MODEL=gpt-5\.6-luna$/m);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_OPENAI_AUTO_CONVERT_MODEL/);
  assert.doesNotMatch(source("components/csv-import-workflow.tsx"), /OPENAI_AUTO_CONVERT_MODEL/);
  assert.doesNotMatch(source("components/csv-import-workflow.tsx"), /dangerouslySetInnerHTML/);
});
