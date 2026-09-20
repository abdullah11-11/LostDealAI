import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  ANALYSIS_BENCHMARK_CASES,
  evaluateDeepBenchmark,
  evaluateStandardBenchmark,
} from "@/lib/ai/analysis-benchmark";
import { analyzeDeepDeal, type DeepAnalysisModelRunner } from "@/lib/ai/deep-analysis";
import {
  DeepAnalysisDetailsSchema,
  DeepDealAnalysisSchema,
  type DeepDealAnalysis,
} from "@/lib/ai/deep-analysis-schema";
import {
  analyzeDeepDealWithStore,
  type DeepAnalysisPersistenceData,
  type DeepAnalysisStore,
} from "@/lib/ai/deep-analysis-workflow";
import { AI_CONFIG } from "@/lib/ai/config";
import { LOSTDEAL_DEEP_ANALYSIS_INSTRUCTIONS } from "@/lib/ai/deep-instructions";
import { DealAnalysisError } from "@/lib/ai/errors";
import type { SourceDealRow } from "@/lib/ai/analysis-workflow";
import {
  resolveDeepAnalysisAccess,
  resolveStandardAnalysisAccess,
  TRIAL_DEEP_ANALYSIS_LIMIT,
} from "@/lib/billing/analysis-access";
import { PLAN_CATALOG } from "@/lib/billing/plans";
import { checkRateLimit, RATE_LIMITS, type RateLimitCounterStore } from "@/lib/security/rate-limit-core";

const root = process.cwd();
const sourceFile = (path: string) => readFileSync(`${root}/${path}`, "utf8");

const trustedSource = {
  dealValue: "8500",
  quoteDate: "2026-08-01",
  serviceType: "HVAC replacement",
  status: "lost",
  salesNotes: "Customer likes the system. The monthly payment is the blocker and they asked about financing.",
  transcript: "Customer: I like the system. The monthly payment is too high for us right now.",
};

function validDeepAnalysis(): DeepDealAnalysis {
  return {
    lost_reason: "FINANCING",
    lost_reason_detail: "The monthly payment and financing structure prevented the purchase.",
    buying_intent_score: 82,
    confidence_score: 91,
    evidence: [{ source: "TRANSCRIPT", excerpt: "I like the system. The monthly payment is too high for us right now." }],
    positive_signals: ["Customer explicitly likes the proposed system."],
    negative_signals: ["Monthly payment does not fit the customer's current situation."],
    recommended_action: "Review available payment structures without promising terms or leading with a discount.",
    recommended_timing: "Near term, after confirming which approved payment structures are available.",
    recommended_channel: "HUMAN_CALL",
    follow_up_message: "Thank you for reviewing the system with us. Would it be helpful to review the available payment structures together?",
    deep: {
      primary_blocker: {
        reason: "FINANCING",
        explanation: "The source identifies the monthly payment, rather than the product itself, as the direct blocker.",
        evidence_indices: [0],
      },
      secondary_blockers: [],
      recovery_thesis: {
        explanation: "The deal may remain recoverable because product interest is explicit while the payment structure is the supported obstacle.",
        evidence_indices: [0],
      },
      customer_readiness: {
        level: "MEDIUM",
        explanation: "The customer shows product interest but cannot proceed under the current monthly payment.",
        evidence_indices: [0],
      },
      objection_hierarchy: [{
        reason: "FINANCING",
        explanation: "Monthly affordability is the only supported objection.",
        evidence_indices: [0],
      }],
      decision_dynamics: {
        explanation: "No supported decision-maker issue identified.",
        evidence_indices: [],
      },
      timing_interpretation: {
        category: "INSUFFICIENT_EVIDENCE",
        explanation: "The source does not identify a specific timing event.",
        evidence_indices: [],
      },
      price_value_interpretation: {
        category: "FINANCING_OR_PAYMENT_STRUCTURE",
        explanation: "The evidence supports a monthly payment issue, not a rejection of total value.",
        evidence_indices: [0],
      },
      competitor_dynamics: {
        category: "NO_MEANINGFUL_EVIDENCE",
        explanation: "No competitor is identified in the source.",
        evidence_indices: [],
      },
      recovery_strategy: {
        objective: "Determine whether an approved payment structure can resolve the supported blocker.",
        recommended_angle: "Lead with clarification of available payment structures and preserve product value.",
        lead_with: "The customer's stated monthly-payment concern.",
        avoid_leading_with: "An immediate discount or invented financing promise.",
        next_best_step: "Review approved options internally, then have a concise human call with the customer.",
        evidence_indices: [0],
      },
      recovery_risk: {
        level: "MEDIUM",
        explanation: "Recovery depends on whether a suitable approved payment structure exists.",
        evidence_indices: [0],
      },
      margin_discount_caution: {
        assessment: "PREMATURE",
        explanation: "The evidence identifies monthly affordability, so an immediate discount could miss the actual issue.",
        evidence_indices: [0],
      },
      follow_up_strategy: {
        communication_objective: "Confirm whether reviewing approved payment structures would be useful.",
        tone: "Consultative and low pressure.",
        key_point_to_address: "The stated monthly-payment concern.",
        key_point_to_avoid: "Unapproved terms, guarantees, or an automatic discount.",
        recommended_sequence: [
          "Acknowledge the customer's product interest.",
          "Confirm the payment concern.",
          "Offer to review only approved structures.",
        ],
        evidence_indices: [0],
      },
    },
  };
}

function weakDeepAnalysis(): DeepDealAnalysis {
  return {
    lost_reason: "OTHER",
    lost_reason_detail: "The source is insufficient to determine why the deal did not close.",
    buying_intent_score: 10,
    confidence_score: 8,
    evidence: [],
    positive_signals: [],
    negative_signals: [],
    recommended_action: "Complete a human review before deciding whether outreach is appropriate.",
    recommended_timing: "After human review.",
    recommended_channel: "OTHER",
    follow_up_message: null,
    deep: {
      primary_blocker: { reason: "OTHER", explanation: "Insufficient evidence to identify a primary blocker.", evidence_indices: [] },
      secondary_blockers: [],
      recovery_thesis: { explanation: "Insufficient evidence to determine whether recovery is strategically appropriate.", evidence_indices: [] },
      customer_readiness: { level: "LOW", explanation: "Customer readiness cannot be determined from the source.", evidence_indices: [] },
      objection_hierarchy: [],
      decision_dynamics: { explanation: "No supported decision-maker issue identified.", evidence_indices: [] },
      timing_interpretation: { category: "INSUFFICIENT_EVIDENCE", explanation: "Insufficient timing evidence.", evidence_indices: [] },
      price_value_interpretation: { category: "INSUFFICIENT_EVIDENCE", explanation: "Insufficient price or value evidence.", evidence_indices: [] },
      competitor_dynamics: { category: "NO_MEANINGFUL_EVIDENCE", explanation: "No meaningful competitor evidence is available.", evidence_indices: [] },
      recovery_strategy: {
        objective: "Complete a human source review.",
        recommended_angle: "Do not infer a recovery angle from the current record.",
        lead_with: "A request for missing internal context, not customer outreach.",
        avoid_leading_with: "Any unsupported objection or offer.",
        next_best_step: "Review the deal record before deciding whether to contact the customer.",
        evidence_indices: [],
      },
      recovery_risk: { level: "HIGH", explanation: "Insufficient evidence makes outreach poorly informed.", evidence_indices: [] },
      margin_discount_caution: { assessment: "UNSUPPORTED_BY_EVIDENCE", explanation: "No evidence supports discounting.", evidence_indices: [] },
      follow_up_strategy: {
        communication_objective: "Determine whether any customer outreach is appropriate after human review.",
        tone: "Cautious.",
        key_point_to_address: "Missing context.",
        key_point_to_avoid: "Unsupported claims about the loss.",
        recommended_sequence: ["Review the source record before outreach."],
        evidence_indices: [],
      },
    },
  };
}

function runner(analysis = validDeepAnalysis()): DeepAnalysisModelRunner {
  return async () => ({
    analysis,
    responseId: "resp_deep_synthetic",
    model: "gpt-5.6-sol",
    usage: { inputTokens: 800, outputTokens: 650, totalTokens: 1450 },
  });
}

test("Deep schema is strict, version-bounded in code, and caps all arrays", () => {
  assert.equal(DeepDealAnalysisSchema.safeParse(validDeepAnalysis()).success, true);
  assert.equal(DeepDealAnalysisSchema.safeParse({ ...validDeepAnalysis(), arbitrary: true }).success, false);
  const tooMany = validDeepAnalysis();
  tooMany.deep.secondary_blockers = Array.from({ length: 4 }, () => ({
    reason: "TIMING" as const,
    explanation: "Supported timing factor.",
    evidence_indices: [0],
  }));
  assert.equal(DeepDealAnalysisSchema.safeParse(tooMany).success, false);
  assert.equal(AI_CONFIG.deepSchemaVersion, "deep-1.0");
  assert.equal(AI_CONFIG.standardSchemaVersion, "standard-1.0");
});

test("Deep validation returns compatible core fields and customer-visible metadata only", async () => {
  const result = await analyzeDeepDeal(trustedSource, runner());
  assert.equal(result.analysis.lost_reason, "FINANCING");
  assert.equal(result.analysis.buying_intent_score, 82);
  assert.equal(result.analysis.confidence_score, 91);
  assert.equal(result.analysis.deep.primary_blocker.reason, "FINANCING");
  assert.equal(result.metadata.analysis_mode, "DEEP");
  assert.equal(result.metadata.schema_version, "deep-1.0");
  assert.equal("recovery_score" in result.analysis, false);
  assert.equal("reasoning" in result.metadata, false);
});

test("every Deep evidence reference must resolve to an exact grounded core excerpt", async () => {
  const invalid = validDeepAnalysis();
  invalid.deep.recovery_strategy.evidence_indices = [7];
  await assert.rejects(analyzeDeepDeal(trustedSource, runner(invalid)), (error) => error instanceof DealAnalysisError && error.code === "AI_RESPONSE_INVALID");

  const fabricated = validDeepAnalysis();
  fabricated.evidence[0].excerpt = "Fabricated quote";
  await assert.rejects(analyzeDeepDeal(trustedSource, runner(fabricated)), (error) => error instanceof DealAnalysisError && error.code === "AI_RESPONSE_INVALID");
});

test("Deep rejects unsupported hidden motivation, numeric discounts, and decision-maker invention", async () => {
  const hidden = validDeepAnalysis();
  hidden.deep.recovery_thesis.explanation = "The customer secretly wants the deal.";
  await assert.rejects(analyzeDeepDeal(trustedSource, runner(hidden)));

  const discount = validDeepAnalysis();
  discount.deep.margin_discount_caution.explanation = "Offer a 20% discount immediately.";
  await assert.rejects(analyzeDeepDeal(trustedSource, runner(discount)));

  const decisionMaker = validDeepAnalysis();
  decisionMaker.deep.decision_dynamics.explanation = "A spouse probably needs to approve.";
  await assert.rejects(analyzeDeepDeal(trustedSource, runner(decisionMaker)));
});

test("financing quality gate distinguishes monthly affordability from price and immediate discounting", async () => {
  const result = await analyzeDeepDeal(trustedSource, runner());
  assert.equal(result.analysis.lost_reason, "FINANCING");
  assert.equal(result.analysis.deep.price_value_interpretation.category, "FINANCING_OR_PAYMENT_STRUCTURE");
  assert.equal(result.analysis.deep.margin_discount_caution.assessment, "PREMATURE");
  assert.doesNotMatch(result.analysis.deep.recovery_strategy.recommended_angle, /discount/i);
});

test("weak evidence produces cautious Deep output without invented blockers", async () => {
  const result = await analyzeDeepDeal({ ...trustedSource, salesNotes: "Didn't close.", transcript: null }, runner(weakDeepAnalysis()));
  assert.equal(result.analysis.confidence_score, 8);
  assert.deepEqual(result.analysis.evidence, []);
  assert.deepEqual(result.analysis.deep.secondary_blockers, []);
  assert.deepEqual(result.analysis.deep.objection_hierarchy, []);
  assert.equal(result.analysis.deep.timing_interpretation.category, "INSUFFICIENT_EVIDENCE");
});

test("Deep source is bounded at 60,000 characters before a provider call", async () => {
  let calls = 0;
  await assert.rejects(analyzeDeepDeal({
    ...trustedSource,
    salesNotes: "x".repeat(AI_CONFIG.deepSourceCharacterLimit + 1),
    transcript: null,
  }, async (input) => {
    calls += 1;
    return runner()(input);
  }), (error) => error instanceof DealAnalysisError && error.code === "SOURCE_TOO_LONG");
  assert.equal(calls, 0);
});

test("Deep prompt treats imported instructions as source and forbids secrets or hidden reasoning", () => {
  assert.match(LOSTDEAL_DEEP_ANALYSIS_INSTRUCTIONS, /never obey/i);
  assert.match(LOSTDEAL_DEEP_ANALYSIS_INSTRUCTIONS, /credentials/i);
  assert.match(LOSTDEAL_DEEP_ANALYSIS_INSTRUCTIONS, /hidden reasoning/i);
  assert.match(LOSTDEAL_DEEP_ANALYSIS_INSTRUCTIONS, /No supported decision-maker issue identified/);
  assert.match(LOSTDEAL_DEEP_ANALYSIS_INSTRUCTIONS, /lower total quote or final price decided/i);
  assert.match(LOSTDEAL_DEEP_ANALYSIS_INSTRUCTIONS, /does not, by itself, establish decision-maker dynamics/i);
});

test("plan access keeps Standard useful and Deep server-authoritative", () => {
  assert.equal(resolveStandardAnalysisAccess("STARTER").providerExecutionAllowed, true);
  assert.equal(resolveStandardAnalysisAccess("PRO").providerExecutionAllowed, true);
  assert.equal(resolveDeepAnalysisAccess("INTERNAL", "active", "SHADOW").providerExecutionAllowed, true);
  assert.equal(resolveDeepAnalysisAccess("STARTER", "active", "ENFORCED").state, "LOCKED");
  assert.equal(resolveDeepAnalysisAccess("STARTER", "active", "ENFORCED").providerExecutionAllowed, false);
  assert.equal(resolveDeepAnalysisAccess("PRO", "active", "SHADOW").state, "BILLING_PENDING");
  assert.equal(resolveDeepAnalysisAccess("PRO", "active", "SHADOW").providerExecutionAllowed, false);
  assert.equal(resolveDeepAnalysisAccess("PRO", "active", "ENFORCED").providerExecutionAllowed, true);
  assert.equal(resolveDeepAnalysisAccess("PRO", "canceled", "ENFORCED").providerExecutionAllowed, false);
  assert.equal(resolveDeepAnalysisAccess("TRIAL", "trialing", "ENFORCED").providerExecutionAllowed, true);
  assert.equal(resolveDeepAnalysisAccess("TRIAL", "active", "ENFORCED").providerExecutionAllowed, false);
  assert.equal(resolveDeepAnalysisAccess("BUSINESS", "active", "ENFORCED").providerExecutionAllowed, false);
});

test("Trial preview is two Deep operations inside the existing AI_ANALYSES meter", () => {
  assert.equal(TRIAL_DEEP_ANALYSIS_LIMIT, 2);
  assert.equal(PLAN_CATALOG.TRIAL.usage?.AI_ANALYSES, 10);
  assert.equal(PLAN_CATALOG.STARTER.usage?.AI_ANALYSES, 30);
  assert.equal(PLAN_CATALOG.PRO.usage?.AI_ANALYSES, 250);
  const migration = sourceFile("supabase/migrations/20260902020000_prompt15_3_deep_analysis.sql");
  assert.match(migration, /target_metric = 'AI_ANALYSES'/);
  assert.match(migration, /idempotency_key like 'deep-analysis:%'/);
  assert.match(migration, /deep_committed_total \+ deep_reserved_total \+ target_units <= 2/);
  assert.doesNotMatch(migration, /DEEP_CREDITS|DEEP_ANALYSES[')]/);
});

function sourceRow(id: string, status = "pending"): SourceDealRow {
  return {
    id,
    deal_value: 8500,
    quote_date: "2026-08-01",
    service_type: "HVAC replacement",
    status: "lost",
    sales_notes: trustedSource.salesNotes,
    transcript: trustedSource.transcript,
    analysis_status: status,
  };
}

function memoryStore(seed: SourceDealRow[], options: { quota?: boolean } = {}) {
  const rows = new Map(seed.map((row) => [row.id, { ...row }]));
  const persisted = new Map<string, DeepAnalysisPersistenceData>();
  const scored = new Set<string>();
  const committedUsage = new Set<string>();
  let commits = 0;
  const store: DeepAnalysisStore = {
    async fetch(dealId) { return rows.get(dealId) ?? null; },
    async inspectExisting(dealId) {
      const value = persisted.get(dealId);
      return value ? {
        deepValid: DeepAnalysisDetailsSchema.safeParse(value.deep_analysis).success,
        scored: scored.has(dealId),
        usageKey: value.analysis_usage_key,
        usageStatus: value.analysis_usage_key && committedUsage.has(value.analysis_usage_key)
          ? "COMMITTED"
          : value.analysis_usage_status,
      } : null;
    },
    async repairCompleted(dealId) {
      const row = rows.get(dealId);
      if (!row) return false;
      row.analysis_status = "completed";
      return true;
    },
    async scoreCompleted(dealId) {
      if (!persisted.has(dealId)) return false;
      scored.add(dealId);
      return true;
    },
    async reserveUsage(dealId, operationId) {
      return {
        available: true,
        allowed: options.quota !== false,
        isNew: true,
        requiresFinalization: true,
        usageKey: `deep-analysis:${dealId}:${operationId}`,
      };
    },
    async finalizeUsage(_dealId, usageKey) {
      if (!committedUsage.has(usageKey)) commits += 1;
      committedUsage.add(usageKey);
      return true;
    },
    async claim(dealId) {
      const row = rows.get(dealId);
      if (!row || row.analysis_status === "processing") return false;
      row.analysis_status = "processing";
      return true;
    },
    async persistAndComplete(dealId, data) {
      const row = rows.get(dealId);
      if (!row || row.analysis_status !== "processing") return false;
      persisted.set(dealId, data);
      row.analysis_status = "completed";
      return true;
    },
    async fail(dealId) {
      const row = rows.get(dealId);
      if (row?.analysis_status === "processing") row.analysis_status = "failed";
    },
  };
  return { store, rows, persisted, scored, commits: () => commits };
}

test("eligible Pro/Internal can run Deep directly as one provider operation", async () => {
  const fixture = memoryStore([sourceRow("direct")]);
  let calls = 0;
  const result = await analyzeDeepDealWithStore(fixture.store, "direct", crypto.randomUUID(), false, async (input) => {
    calls += 1;
    return runner()(input);
  });
  assert.equal(result.status, "completed");
  assert.equal(result.status === "completed" && result.fresh, true);
  assert.equal(calls, 1);
  assert.equal(fixture.commits(), 1);
  assert.equal(fixture.persisted.get("direct")?.analysis_mode, "DEEP");
  assert.equal(fixture.persisted.get("direct")?.recovery_score, null);
  assert.equal(fixture.scored.has("direct"), true);
});

test("existing Standard can explicitly upgrade to Deep without a Standard provider call", async () => {
  const fixture = memoryStore([sourceRow("upgrade", "completed")]);
  let calls = 0;
  const result = await analyzeDeepDealWithStore(fixture.store, "upgrade", crypto.randomUUID(), false, async (input) => {
    calls += 1;
    return runner()(input);
  });
  assert.equal(result.status, "completed");
  assert.equal(calls, 1);
  assert.equal(fixture.persisted.get("upgrade")?.analysis_schema_version, "deep-1.0");
});

test("stored Deep reload reuses persistence with zero provider calls", async () => {
  const fixture = memoryStore([sourceRow("stored", "completed")]);
  const completed = await analyzeDeepDeal(trustedSource, runner());
  const { deep, ...core } = completed.analysis;
  fixture.persisted.set("stored", {
    ...core,
    recovery_score: null,
    recovery_priority: null,
    score_explanation: null,
    analysis_mode: "DEEP",
    analysis_schema_version: "deep-1.0",
    deep_analysis: deep,
    deep_analyzed_at: completed.metadata.analyzed_at,
    model_metadata: completed.metadata,
    analysis_usage_key: null,
    analysis_usage_status: "LEGACY",
  });
  let calls = 0;
  const result = await analyzeDeepDealWithStore(fixture.store, "stored", crypto.randomUUID(), false, async (input) => {
    calls += 1;
    return runner()(input);
  });
  assert.deepEqual(result, { status: "completed", fresh: false });
  assert.equal(calls, 0);
});

test("explicit Deep re-run is one new operation and preserves valid replacement semantics", async () => {
  const fixture = memoryStore([sourceRow("rerun", "completed")]);
  const first = await analyzeDeepDealWithStore(fixture.store, "rerun", crypto.randomUUID(), false, runner());
  assert.equal(first.status, "completed");
  let calls = 0;
  const second = await analyzeDeepDealWithStore(fixture.store, "rerun", crypto.randomUUID(), true, async (input) => {
    calls += 1;
    return runner()(input);
  });
  assert.equal(second.status, "completed");
  assert.equal(calls, 1);
  assert.equal(fixture.commits(), 2);
});

test("quota, cross-tenant and processing states stop before provider execution", async () => {
  let calls = 0;
  const paid: DeepAnalysisModelRunner = async (input) => { calls += 1; return runner()(input); };
  const denied = memoryStore([sourceRow("quota")], { quota: false });
  assert.deepEqual(await analyzeDeepDealWithStore(denied.store, "quota", crypto.randomUUID(), false, paid), { status: "quota_exceeded" });
  const authorized = memoryStore([sourceRow("processing", "processing")]);
  assert.deepEqual(await analyzeDeepDealWithStore(authorized.store, "outside", crypto.randomUUID(), false, paid), { status: "not_found" });
  assert.deepEqual(await analyzeDeepDealWithStore(authorized.store, "processing", crypto.randomUUID(), false, paid), { status: "processing" });
  assert.equal(calls, 0);
});

test("rapid duplicate Deep submit creates at most one provider call", async () => {
  const fixture = memoryStore([sourceRow("duplicate")]);
  let calls = 0;
  const delayed: DeepAnalysisModelRunner = async (input) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return runner()(input);
  };
  const operationId = crypto.randomUUID();
  const results = await Promise.all([
    analyzeDeepDealWithStore(fixture.store, "duplicate", operationId, false, delayed),
    analyzeDeepDealWithStore(fixture.store, "duplicate", operationId, false, delayed),
  ]);
  assert.equal(calls, 1);
  assert.equal(results.filter((item) => item.status === "completed" && item.fresh).length, 1);
  assert.equal(results.filter((item) => item.status === "processing").length, 1);
});

test("provider failure persists no corrupted Deep object and remains retryable", async () => {
  const fixture = memoryStore([sourceRow("failure")]);
  const failed = await analyzeDeepDealWithStore(fixture.store, "failure", crypto.randomUUID(), false, async () => {
    throw new DealAnalysisError("AI_TEMPORARILY_UNAVAILABLE");
  });
  assert.equal(failed.status, "failed");
  assert.equal(fixture.persisted.has("failure"), false);
  assert.equal(fixture.rows.get("failure")?.analysis_status, "failed");
  const retry = await analyzeDeepDealWithStore(fixture.store, "failure", crypto.randomUUID(), false, runner());
  assert.equal(retry.status, "completed");
});

test("Deep endpoint security order denies before provider service", () => {
  const route = sourceFile("app/api/deals/analyze-deep/route.ts");
  const auth = route.indexOf("getAuthorizedRouteContext");
  const origin = route.indexOf("validateMutationRequest", auth);
  const authorization = route.indexOf("authorizeDealReference", origin);
  const rate = route.indexOf("enforceRateLimitOrRespond", authorization);
  const entitlement = route.indexOf("resolveDeepAnalysisAccess", rate);
  const schema = route.indexOf("isDeepAnalysisSchemaReady", entitlement);
  const providerService = route.indexOf("analyzeAuthorizedDeepDeal", schema);
  assert.ok(auth < origin && origin < authorization && authorization < rate && rate < entitlement && entitlement < schema && schema < providerService);
});

test("Deep uses the existing D1 limiter with a stricter four-per-fifteen-minute policy", async () => {
  assert.deepEqual(RATE_LIMITS.analyze_deep, { limit: 4, windowSeconds: 15 * 60 });
  let count = 0;
  const store: RateLimitCounterStore = { async increment() { count += 1; return count; } };
  for (let index = 0; index < 4; index += 1) assert.equal((await checkRateLimit(store, "user", "analyze_deep", 0)).allowed, true);
  assert.equal((await checkRateLimit(store, "user", "analyze_deep", 0)).allowed, false);
});

test("normal imports, dashboard, scoring and page loads contain no automatic Deep call", () => {
  for (const path of [
    "app/api/uploads/import/route.ts",
    "app/api/uploads/auto-convert/route.ts",
    "app/(dashboard)/dashboard/page.tsx",
    "app/api/deals/score/route.ts",
    "app/(dashboard)/deals/[id]/page.tsx",
  ]) {
    const source = sourceFile(path);
    assert.doesNotMatch(source, /runOpenAIDeepAnalysis\(|analyzeAuthorizedDeepDeal\(/, path);
  }
});

test("Deep UI names product behavior, not model names, and preserves progressive disclosure", () => {
  const page = sourceFile("app/(dashboard)/deals/[id]/page.tsx");
  const button = sourceFile("components/deep-analysis-button.tsx");
  assert.match(page, /Deep Recovery Summary/);
  assert.match(page, /Recovery Strategy/);
  assert.match(page, /Decision Dynamics/);
  assert.match(page, /LocalTabs/);
  assert.match(button, /aria-live="polite"/);
  assert.doesNotMatch(`${page}\n${button}`, /Terra Analysis|Sol Analysis|Luna Analysis|GPT Analysis/);
});

test("the benchmark contains 12 synthetic cases and all requested quality categories", () => {
  assert.equal(ANALYSIS_BENCHMARK_CASES.length, 12);
  assert.deepEqual(new Set(ANALYSIS_BENCHMARK_CASES.map((item) => item.sourceShape)), new Set(["NOTES_ONLY", "TRANSCRIPT_ONLY", "NOTES_AND_TRANSCRIPT"]));
  const reasons = new Set(ANALYSIS_BENCHMARK_CASES.map((item) => item.gold.primaryReason));
  for (const reason of ["FINANCING", "PRICE", "TIMING", "DECISION_MAKER", "COMPETITOR", "NO_FOLLOW_UP", "NO_RESPONSE", "TRUST", "PRODUCT_FIT", "AVAILABILITY", "OTHER"]) {
    assert.equal(reasons.has(reason as never), true, reason);
  }
  assert.ok(ANALYSIS_BENCHMARK_CASES.some((item) => item.id.includes("multiple")));
  assert.ok(ANALYSIS_BENCHMARK_CASES.some((item) => item.id.includes("weak")));
  assert.ok(ANALYSIS_BENCHMARK_CASES.some((item) => item.id.includes("injection")));
});

test("benchmark scoring is explicit and deterministic rather than model self-judgment", () => {
  const financing = ANALYSIS_BENCHMARK_CASES.find((item) => item.id === "financing-not-price");
  assert.ok(financing);
  const benchmarkAnalysis = validDeepAnalysis();
  benchmarkAnalysis.evidence = [{
    source: "TRANSCRIPT",
    excerpt: "I cannot make that monthly payment work right now.",
  }];
  const standard = evaluateStandardBenchmark(financing, benchmarkAnalysis);
  const deep = evaluateDeepBenchmark(financing, benchmarkAnalysis);
  assert.equal(standard.checks.primary_reason, true);
  assert.equal(standard.checks.evidence_grounded, true);
  assert.equal(deep.checks.discount, true);
  assert.ok(deep.total > standard.total);
});

test("Prompt 15.3 remains immutable and later hotfixes add only their forward migrations", () => {
  const migrations = readdirSync(`${root}/supabase/migrations`).filter((file) => file.includes("prompt15_3"));
  assert.deepEqual(migrations, [
    "20260902020000_prompt15_3_deep_analysis.sql",
    "20260905070000_prompt15_3_1_runtime_hardening.sql",
    "20260905083511_prompt15_3_2_usage_reservation_runtime_hotfix.sql",
    "20260906080228_prompt15_3_3_recovery_sort_rpc_auth_hotfix.sql",
    "20260908055554_prompt15_3_5_deep_semantic_diagnostic_hardening.sql",
  ]);
  const prompt153 = sourceFile(`supabase/migrations/${migrations[0]}`);
  const hardening = sourceFile(`supabase/migrations/${migrations[1]}`);
  const usageHotfix = sourceFile(`supabase/migrations/${migrations[2]}`);
  const sortHotfix = sourceFile(`supabase/migrations/${migrations[3]}`);
  const semanticDiagnosticHotfix = sourceFile(`supabase/migrations/${migrations[4]}`);
  assert.doesNotMatch(prompt153, /create table|create policy|service_role/i);
  assert.match(prompt153, /add column analysis_mode/);
  assert.match(prompt153, /add column deep_analysis jsonb/);
  assert.match(prompt153, /grant update \(requested_analysis_mode\)/);
  assert.doesNotMatch(hardening, /create table|service_role/i);
  assert.match(hardening, /create function public\.finalize_analysis_usage/);
  assert.doesNotMatch(usageHotfix, /create table|create policy|service_role/i);
  assert.match(usageHotfix, /runtime_now timestamptz := clock_timestamp\(\)/);
  assert.doesNotMatch(sortHotfix, /create table|create policy|service_role/i);
  assert.match(sortHotfix, /security definer/i);
  assert.doesNotMatch(semanticDiagnosticHotfix, /create table|create policy|service_role/i);
  assert.match(semanticDiagnosticHotfix, /timing_category_evidence_mismatch/);
});

test("Prompt 8 scoring stays isolated from Deep fields and AI", () => {
  const scorer = sourceFile("lib/scoring/recovery-score.ts");
  const scoreService = sourceFile("lib/scoring/score-service.ts");
  assert.doesNotMatch(`${scorer}\n${scoreService}`, /deep_analysis|secondary_blockers|responses\.(?:parse|create)|openai/i);
});

test("model configuration is server-only with explicit legacy fallback and Auto Convert unchanged", () => {
  const config = sourceFile("lib/ai/config.ts");
  const autoConvert = sourceFile("lib/csv/auto-convert-runner.ts");
  const env = sourceFile(".env.example");
  assert.match(config, /OPENAI_STANDARD_ANALYSIS_MODEL/);
  assert.match(config, /OPENAI_DEEP_ANALYSIS_MODEL/);
  assert.match(config, /OPENAI_MODEL/);
  assert.match(config, /TESTED_COST_SAFE_ANALYSIS_FALLBACK = "gpt-5\.6-terra"/);
  assert.match(config, /legacyAnalysisModel === TESTED_COST_SAFE_ANALYSIS_FALLBACK/);
  assert.match(config, /model: legacyAnalysisModel/);
  assert.match(env, /OPENAI_AUTO_CONVERT_MODEL=/);
  assert.match(autoConvert, /OPENAI_AUTO_CONVERT_MODEL/);
  assert.doesNotMatch(`${config}\n${env}`, /NEXT_PUBLIC_OPENAI/);
});

test("Prompt 15.3 documentation records the bounded benchmark, selected models, economics and migration", () => {
  const benchmark = sourceFile("docs/ANALYSIS_MODEL_BENCHMARK.md");
  const deep = sourceFile("docs/DEEP_RECOVERY_ANALYSIS.md");
  const economics = sourceFile("docs/UNIT_ECONOMICS.md");
  const setup = sourceFile("docs/SUPABASE_SETUP.md");
  assert.match(benchmark, /Exactly \*\*20 completed Stage 1 provider calls\*\*/);
  assert.match(benchmark, /\*\*\$0\.246432\*\*/);
  assert.match(benchmark, /Standard — `gpt-5\.6-terra`; Deep — `gpt-5\.6-terra`/);
  assert.match(deep, /Historical Deep output remains stored and viewable/);
  assert.match(deep, /Deep route verifies column readiness/);
  assert.match(economics, /250 analyses cost about \*\*\$4\.01\*\*/);
  assert.match(setup, /20260902020000_prompt15_3_deep_analysis\.sql/);
});
