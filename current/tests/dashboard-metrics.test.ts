import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  calculateDashboardMetrics,
  selectTopRecoveryOpportunities,
  tenantRecentImports,
} from "@/lib/dashboard/metrics";
import type {
  DashboardAnalysisRecord,
  DashboardDealRecord,
  DashboardUploadRecord,
} from "@/lib/dashboard/types";

const ORG_A = "org-a";
const ORG_B = "org-b";

function analysis(overrides: Partial<DashboardAnalysisRecord> = {}): DashboardAnalysisRecord {
  return {
    id: "analysis-default",
    lostReason: "PRICE",
    recoveryScore: 50,
    recoveryPriority: "MEDIUM",
    recommendedAction: "Review the deal.",
    scoringCalculatedAt: "2026-08-20T12:00:00.000Z",
    ...overrides,
  };
}

type DealOverrides = Omit<Partial<DashboardDealRecord>, "analysis"> & {
  analysis?: DashboardAnalysisRecord | null;
};

function deal(id: string, overrides: DealOverrides = {}): DashboardDealRecord {
  return {
    id,
    organizationId: ORG_A,
    customerName: `Customer ${id}`,
    dealValue: 1_000,
    quoteDate: "2026-08-01",
    serviceType: "HVAC",
    analysisStatus: "completed",
    createdAt: "2026-08-20T10:00:00.000Z",
    analysis: analysis({ id: `analysis-${id}` }),
    ...overrides,
  };
}

function upload(id: string, organizationId: string, createdAt: string): DashboardUploadRecord {
  return {
    id,
    organizationId,
    filename: `${id}.csv`,
    status: "completed",
    totalRows: 10,
    validRows: 9,
    invalidRows: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

test("real KPI fixture reconciles exact totals and excludes unscored deals from the average", () => {
  const records = [
    deal("a", { dealValue: 10_000, analysis: analysis({ id: "analysis-a", recoveryScore: 80, recoveryPriority: "HIGH", lostReason: "TIMING" }) }),
    deal("b", { dealValue: 5_000, analysis: analysis({ id: "analysis-b", recoveryScore: 60, recoveryPriority: "MEDIUM", lostReason: "PRICE" }) }),
    deal("c", { dealValue: 2_000, analysis: analysis({ id: "analysis-c", recoveryScore: null, recoveryPriority: null, lostReason: "FINANCING", scoringCalculatedAt: null }) }),
  ];
  const metrics = calculateDashboardMetrics(records, ORG_A);

  assert.equal(metrics.totalDeals, 3);
  assert.equal(metrics.totalLostDealValue, 17_000);
  assert.equal(metrics.analyzedDeals, 3);
  assert.equal(metrics.scoredDeals, 2);
  assert.equal(metrics.completedButUnscored, 1);
  assert.equal(metrics.highPriorityDeals, 1);
  assert.equal(metrics.highPriorityDealValue, 10_000);
  assert.equal(metrics.averageRecoveryScore, 70);
  assert.equal(metrics.lossReasons.reduce((sum, item) => sum + item.count, 0), metrics.lossReasonDenominator);
  assert.equal(metrics.priorities.reduce((sum, item) => sum + item.count, 0), metrics.priorityDenominator);
});

test("analysis and scoring coverage use separate denominators", () => {
  const records = Array.from({ length: 10 }, (_, index) => {
    if (index < 6) {
      return deal(`analyzed-${index}`, {
        analysis: analysis({
          id: `analysis-${index}`,
          recoveryScore: index < 5 ? 50 + index : null,
          recoveryPriority: index < 5 ? "MEDIUM" : null,
        }),
      });
    }
    return deal(`pending-${index}`, { analysisStatus: "pending", analysis: null });
  });
  const metrics = calculateDashboardMetrics(records, ORG_A);
  assert.equal(metrics.totalDeals, 10);
  assert.equal(metrics.analyzedDeals, 6);
  assert.equal(metrics.analysisCoveragePercentage, 60);
  assert.equal(metrics.scoredDeals, 5);
  assert.equal(metrics.completedButUnscored, 1);
  assert.deepEqual(metrics.statusCounts, { completed: 6, pending: 4, processing: 0, failed: 0, unknown: 0 });
  assert.equal(metrics.reconciledStatusDeals, 10);
});

test("empty, no-analysis, unscored, and partial workspaces remain zero-safe", () => {
  const empty = calculateDashboardMetrics([], ORG_A);
  assert.equal(empty.totalDeals, 0);
  assert.equal(empty.analysisCoveragePercentage, 0);
  assert.equal(empty.averageRecoveryScore, null);
  assert.deepEqual(empty.lossReasons, []);

  const noAnalysis = calculateDashboardMetrics([
    deal("pending", { analysisStatus: "pending", analysis: null }),
    deal("failed", { analysisStatus: "failed", analysis: null }),
  ], ORG_A);
  assert.equal(noAnalysis.analyzedDeals, 0);
  assert.equal(noAnalysis.scoredDeals, 0);
  assert.equal(noAnalysis.statusCounts.pending, 1);
  assert.equal(noAnalysis.statusCounts.failed, 1);

  const unscored = calculateDashboardMetrics([
    deal("unscored", { analysis: analysis({ id: "unscored-analysis", recoveryScore: null, recoveryPriority: null }) }),
  ], ORG_A);
  assert.equal(unscored.analyzedDeals, 1);
  assert.equal(unscored.scoredDeals, 0);
  assert.equal(unscored.completedButUnscored, 1);

  const partial = calculateDashboardMetrics([
    deal("complete-scored"),
    deal("complete-unscored", { analysis: analysis({ id: "partial-unscored", recoveryScore: null, recoveryPriority: null }) }),
    deal("pending-partial", { analysisStatus: "pending", analysis: null }),
    deal("processing-partial", { analysisStatus: "processing", analysis: null }),
  ], ORG_A);
  assert.equal(partial.totalDeals, 4);
  assert.equal(partial.analyzedDeals, 2);
  assert.equal(partial.scoredDeals, 1);
  assert.equal(partial.analysisCoveragePercentage, 50);
});

test("status reconciliation handles unknown and invalid completed records defensively", () => {
  const metrics = calculateDashboardMetrics([
    deal("valid"),
    deal("completed-without-analysis", { analysis: null }),
    deal("unknown", { analysisStatus: "unexpected", analysis: null }),
    deal("failed-with-score", { analysisStatus: "failed", analysis: analysis({ id: "failed-analysis", recoveryScore: 72, recoveryPriority: "HIGH" }) }),
  ], ORG_A);
  assert.equal(metrics.totalDeals, 4);
  assert.equal(metrics.statusCounts.completed, 2);
  assert.equal(metrics.statusCounts.failed, 1);
  assert.equal(metrics.statusCounts.unknown, 1);
  assert.equal(metrics.reconciledStatusDeals, 3);
  assert.equal(metrics.invalidCompletedAnalysisCount, 1);
  assert.equal(metrics.analyzedDeals, 1);
  assert.equal(metrics.scoredDeals, 2);
});

test("priority distribution excludes unscored and missing-priority deals and sums valid values", () => {
  const metrics = calculateDashboardMetrics([
    deal("high", { dealValue: 9_000, analysis: analysis({ id: "high-analysis", recoveryScore: 90, recoveryPriority: "HIGH" }) }),
    deal("medium", { dealValue: 4_000, analysis: analysis({ id: "medium-analysis", recoveryScore: 60, recoveryPriority: "MEDIUM" }) }),
    deal("low", { dealValue: 2_000, analysis: analysis({ id: "low-analysis", recoveryScore: 20, recoveryPriority: "LOW" }) }),
    deal("unscored-high", { dealValue: 99_000, analysis: analysis({ id: "unscored-high-analysis", recoveryScore: null, recoveryPriority: "HIGH" }) }),
    deal("scored-no-priority", { dealValue: 8_000, analysis: analysis({ id: "no-priority-analysis", recoveryScore: 70, recoveryPriority: null }) }),
  ], ORG_A);
  assert.equal(metrics.scoredDeals, 4);
  assert.equal(metrics.priorityDenominator, 3);
  assert.equal(metrics.invalidScoredPriorityCount, 1);
  assert.deepEqual(metrics.priorities.map(({ priority, count, percentage, dealValue }) => ({ priority, count, percentage, dealValue })), [
    { priority: "HIGH", count: 1, percentage: 33.3, dealValue: 9_000 },
    { priority: "MEDIUM", count: 1, percentage: 33.3, dealValue: 4_000 },
    { priority: "LOW", count: 1, percentage: 33.3, dealValue: 2_000 },
  ]);
  assert.equal(metrics.highPriorityDeals, 1);
  assert.equal(metrics.highPriorityDealValue, 9_000);
});

test("loss reasons use completed valid analyses, exact percentages, and deterministic tie ordering", () => {
  const metrics = calculateDashboardMetrics([
    deal("price-1", { analysis: analysis({ id: "price-1-analysis", lostReason: "PRICE" }) }),
    deal("price-2", { analysis: analysis({ id: "price-2-analysis", lostReason: "PRICE" }) }),
    deal("timing", { analysis: analysis({ id: "timing-analysis", lostReason: "TIMING" }) }),
    deal("financing", { analysis: analysis({ id: "financing-analysis", lostReason: "FINANCING" }) }),
    deal("pending-reason", { analysisStatus: "pending", analysis: analysis({ id: "pending-analysis", lostReason: "PRICE" }) }),
  ], ORG_A);
  assert.equal(metrics.lossReasonDenominator, 4);
  assert.deepEqual(metrics.lossReasons, [
    { reason: "PRICE", count: 2, percentage: 50 },
    { reason: "FINANCING", count: 1, percentage: 25 },
    { reason: "TIMING", count: 1, percentage: 25 },
  ]);
});

test("duplicate join rows contribute each deal at most once", () => {
  const original = deal("duplicate", { dealValue: 7_500, analysis: analysis({ id: "duplicate-analysis", recoveryScore: 80, recoveryPriority: "HIGH" }) });
  const metrics = calculateDashboardMetrics([original, { ...original }, deal("unique", { dealValue: 2_500 })], ORG_A);
  assert.equal(metrics.totalDeals, 2);
  assert.equal(metrics.totalLostDealValue, 10_000);
  assert.equal(metrics.scoredDeals, 2);
  assert.equal(metrics.highPriorityDeals, 1);
  assert.equal(metrics.averageRecoveryScore, 65);
});

test("top opportunities use score, value, quote date, stable ID, and a hard limit", () => {
  const records = [
    deal("z-score", { dealValue: 1, quoteDate: null, analysis: analysis({ id: "z-score-analysis", recoveryScore: 99, recoveryPriority: "HIGH" }) }),
    deal("a-stable", { dealValue: 10_000, quoteDate: "2026-08-10", analysis: analysis({ id: "a-stable-analysis", recoveryScore: 90, recoveryPriority: "HIGH" }) }),
    deal("b-stable", { dealValue: 10_000, quoteDate: "2026-08-10", analysis: analysis({ id: "b-stable-analysis", recoveryScore: 90, recoveryPriority: "HIGH" }) }),
    deal("newer-date", { dealValue: 10_000, quoteDate: "2026-08-12", analysis: analysis({ id: "newer-date-analysis", recoveryScore: 90, recoveryPriority: "HIGH" }) }),
    deal("more-value", { dealValue: 20_000, quoteDate: "2026-07-01", analysis: analysis({ id: "more-value-analysis", recoveryScore: 90, recoveryPriority: "HIGH" }) }),
    deal("sixth", { dealValue: 500, analysis: analysis({ id: "sixth-analysis", recoveryScore: 30, recoveryPriority: "LOW" }) }),
    deal("unscored", { analysis: analysis({ id: "unscored-top-analysis", recoveryScore: null, recoveryPriority: null }) }),
  ];
  assert.deepEqual(selectTopRecoveryOpportunities(records, ORG_A).map((item) => item.id), [
    "z-score", "more-value", "newer-date", "a-stable", "b-stable",
  ]);
});

test("scoring freshness reports multiple dates and missing timestamps without fabrication", () => {
  const metrics = calculateDashboardMetrics([
    deal("early", { analysis: analysis({ id: "early-analysis", scoringCalculatedAt: "2026-08-20T10:00:00.000Z" }) }),
    deal("late", { analysis: analysis({ id: "late-analysis", scoringCalculatedAt: "2026-08-22T10:00:00.000Z" }) }),
    deal("missing", { analysis: analysis({ id: "missing-analysis", scoringCalculatedAt: null }) }),
  ], ORG_A);
  assert.equal(metrics.freshness.scoredDeals, 3);
  assert.equal(metrics.freshness.timestampedDeals, 2);
  assert.equal(metrics.freshness.missingTimestampCount, 1);
  assert.equal(metrics.freshness.earliestCalculatedAt, "2026-08-20T10:00:00.000Z");
  assert.equal(metrics.freshness.latestCalculatedAt, "2026-08-22T10:00:00.000Z");
  assert.equal(metrics.freshness.multipleCalculationDates, true);
});

test("KPIs, top opportunities, loss reasons, and recent imports are tenant isolated", () => {
  const records = [
    deal("a-1", { dealValue: 10_000, analysis: analysis({ id: "a-1-analysis", lostReason: "PRICE", recoveryScore: 80, recoveryPriority: "HIGH" }) }),
    deal("a-2", { dealValue: 12_000, analysis: analysis({ id: "a-2-analysis", lostReason: "PRICE", recoveryScore: 60, recoveryPriority: "MEDIUM" }) }),
    deal("a-3", { dealValue: 8_000, analysis: analysis({ id: "a-3-analysis", lostReason: "TIMING", recoveryScore: null, recoveryPriority: null }) }),
    deal("b-1", { organizationId: ORG_B, dealValue: 50_000, analysis: analysis({ id: "b-1-analysis", lostReason: "COMPETITOR", recoveryScore: 100, recoveryPriority: "HIGH" }) }),
    deal("b-2", { organizationId: ORG_B, dealValue: 40_000, analysis: analysis({ id: "b-2-analysis", lostReason: "COMPETITOR", recoveryScore: 95, recoveryPriority: "HIGH" }) }),
  ];
  const metricsA = calculateDashboardMetrics(records, ORG_A);
  assert.equal(metricsA.totalDeals, 3);
  assert.equal(metricsA.totalLostDealValue, 30_000);
  assert.equal(metricsA.highPriorityDeals, 1);
  assert.deepEqual(metricsA.lossReasons.map(({ reason, count }) => ({ reason, count })), [
    { reason: "PRICE", count: 2 },
    { reason: "TIMING", count: 1 },
  ]);
  assert.deepEqual(selectTopRecoveryOpportunities(records, ORG_A).map((item) => item.id), ["a-1", "a-2"]);
  assert.equal(selectTopRecoveryOpportunities(records, ORG_A).some((item) => item.organizationId === ORG_B), false);

  const recent = tenantRecentImports([
    upload("a-old", ORG_A, "2026-08-01T00:00:00.000Z"),
    upload("b-new", ORG_B, "2026-08-30T00:00:00.000Z"),
    upload("a-new", ORG_A, "2026-08-20T00:00:00.000Z"),
    upload("a-new", ORG_A, "2026-08-20T00:00:00.000Z"),
  ], ORG_A);
  assert.deepEqual(recent.map((item) => item.id), ["a-new", "a-old"]);
});

test("10,000 lightweight records calculate efficiently without browser or transcript data", () => {
  const records = Array.from({ length: 10_000 }, (_, index) => deal(`large-${String(index).padStart(5, "0")}`, {
    dealValue: index + 1,
    quoteDate: index % 9 === 0 ? null : `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
    analysisStatus: index % 4 === 0 ? "pending" : "completed",
    analysis: index % 4 === 0 ? null : analysis({
      id: `large-analysis-${index}`,
      recoveryScore: index % 7 === 0 ? null : index % 101,
      recoveryPriority: index % 7 === 0 ? null : index % 3 === 0 ? "HIGH" : index % 3 === 1 ? "MEDIUM" : "LOW",
      lostReason: index % 2 === 0 ? "PRICE" : "TIMING",
    }),
  }));
  const startedAt = performance.now();
  const metrics = calculateDashboardMetrics(records, ORG_A);
  const top = selectTopRecoveryOpportunities(records, ORG_A);
  const elapsed = performance.now() - startedAt;
  assert.equal(metrics.totalDeals, 10_000);
  assert.equal(top.length, 5);
  assert.ok(elapsed < 2_500, `Dashboard metric calculation took ${elapsed.toFixed(1)}ms.`);
  assert.equal(Object.hasOwn(records[0], "transcript"), false);
  assert.equal(Object.hasOwn(records[0], "salesNotes"), false);
});

test("dashboard implementation is server-only, lightweight, read-only, and causes no automatic AI or scoring work", async () => {
  const [page, server, load, normalize, metrics, packageJson] = await Promise.all([
    readFile("app/(dashboard)/dashboard/page.tsx", "utf8"),
    readFile("lib/dashboard/server.ts", "utf8"),
    readFile("lib/dashboard/load.ts", "utf8"),
    readFile("lib/dashboard/normalize.ts", "utf8"),
    readFile("lib/dashboard/metrics.ts", "utf8"),
    readFile("package.json", "utf8"),
  ]);
  const dashboardSources = `${page}\n${server}\n${load}\n${normalize}\n${metrics}`;
  assert.match(page, /requireOrganization\("\/dashboard"\)/);
  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(server, /\.eq\("organization_id", organizationId\)/);
  assert.match(server, /count: "exact"/);
  assert.match(server, /\.range\(offset, offset \+ DASHBOARD_QUERY_PAGE_SIZE - 1\)/);
  assert.match(server, /\.limit\(RECENT_IMPORT_LIMIT\)/);
  assert.equal((server.match(/\.from\(/g) ?? []).length, 2);
  assert.doesNotMatch(server, /fetchTopOpportunities|TOP_OPPORTUNITY_FIELDS|deal_analyses\(recovery_score\)/);
  assert.match(load, /selectTopRecoveryOpportunities/);
  assert.match(load, /DASHBOARD_IMPORTS_QUERY_FAILED/);
  assert.match(load, /DASHBOARD_TOP_OPPORTUNITIES_FAILED/);
  assert.doesNotMatch(server, /Promise\.all/);
  assert.doesNotMatch(server, /transcript|sales_notes|evidence/);
  assert.doesNotMatch(dashboardSources, /from ["']openai["']|getOpenAIClient|runOpenAIAnalysis|analyzeDealWithStore/);
  assert.doesNotMatch(dashboardSources, /scoreBatchWithStore|scoreDealWithStore|calculateRecoveryScore/);
  assert.doesNotMatch(dashboardSources, /\.(?:insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(dashboardSources, /service_role|SUPABASE_SERVICE_ROLE|supabase_secret/i);
  assert.match(server, /LOSTDEAL_DASHBOARD_DIAGNOSTIC/);
  assert.doesNotMatch(server, /error\.message|JSON\.stringify\(error\)|organizationId.*console|customer.*console/i);
  assert.doesNotMatch(page, /Demo \/ Sample Data|Sample data|fictional/i);
  assert.doesNotMatch(page, /Expected Revenue|Expected Recovery Value|Predicted Revenue|Revenue Forecast|Recovery Probability/i);
  assert.doesNotMatch(page, /dealValue\s*\*|deal_value\s*\*/);
  assert.match(page, /Recovery Score is a prioritization indicator based on deal signals, loss reason, recency and analysis confidence\. It is not a prediction or guarantee of conversion\./);
  assert.equal(JSON.parse(packageJson).dependencies.recharts, undefined);
  assert.equal(JSON.parse(packageJson).dependencies["chart.js"], undefined);
});
