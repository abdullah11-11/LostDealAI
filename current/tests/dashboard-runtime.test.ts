import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

import { DashboardLoadError, loadDashboardData } from "@/lib/dashboard/load";
import { normalizeDashboardDeal } from "@/lib/dashboard/normalize";
import type { DashboardDealRecord, DashboardDiagnostic, DashboardUploadRecord } from "@/lib/dashboard/types";

const ORGANIZATION_ID = "org-owner-symptom";

function rawDeal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "deal-owner-symptom",
    organization_id: ORGANIZATION_ID,
    customer_name: "Synthetic Customer",
    deal_value: "8400.00",
    quote_date: "2026-08-18",
    service_type: "Heat Pump",
    analysis_status: "completed",
    created_at: "2026-08-18T09:00:00.000Z",
    deal_analyses: {
      id: "analysis-owner-symptom",
      lost_reason: "TIMING",
      recovery_score: 74,
      recovery_priority: "HIGH",
      recommended_action: "Reconnect with a revised timeline.",
      model_metadata: {
        scoring: {
          calculated_at: "2026-08-24T12:30:00.000Z",
          version: "1.0",
        },
      },
    },
    ...overrides,
  };
}

function normalized(value: unknown): DashboardDealRecord {
  const result = normalizeDashboardDeal(value);
  assert.ok(result, "Expected a valid normalized dashboard deal.");
  return result;
}

function recentUpload(): DashboardUploadRecord {
  return {
    id: "upload-owner-symptom",
    organizationId: ORGANIZATION_ID,
    filename: "synthetic-owner-symptom.csv",
    status: "completed",
    totalRows: 2,
    validRows: 2,
    invalidRows: 0,
    createdAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-18T08:01:00.000Z",
  };
}

test("Prompt 7 plus Prompt 8 owner-symptom row normalizes and produces exact scored metrics", async () => {
  const source = normalized(rawDeal());
  const result = await loadDashboardData(ORGANIZATION_ID, {
    fetchDeals: async () => [source],
    fetchRecentImports: async () => [recentUpload()],
  });

  assert.equal(result.errors.core, false);
  assert.equal(result.metrics.totalDeals, 1);
  assert.equal(result.metrics.totalLostDealValue, 8_400);
  assert.equal(result.metrics.analyzedDeals, 1);
  assert.equal(result.metrics.scoredDeals, 1);
  assert.equal(result.metrics.highPriorityDeals, 1);
  assert.equal(result.metrics.highPriorityDealValue, 8_400);
  assert.equal(result.metrics.averageRecoveryScore, 74);
  assert.deepEqual(result.metrics.lossReasons, [{ reason: "TIMING", count: 1, percentage: 100 }]);
  assert.deepEqual(result.topOpportunities.map((deal) => deal.id), ["deal-owner-symptom"]);
  assert.equal(result.metrics.freshness.latestCalculatedAt, "2026-08-24T12:30:00.000Z");
});

test("analysis relationship object, array, and null shapes normalize without throwing", () => {
  const objectShape = normalized(rawDeal());
  const validAnalysis = (rawDeal().deal_analyses as Record<string, unknown>);
  const arrayShape = normalized(rawDeal({
    id: "deal-array-shape",
    deal_analyses: [{ unexpected: true }, validAnalysis],
  }));
  const nullShape = normalized(rawDeal({ id: "deal-null-shape", deal_analyses: null }));

  assert.equal(objectShape.analysis?.recoveryScore, 74);
  assert.equal(arrayShape.analysis?.id, "analysis-owner-symptom");
  assert.equal(nullShape.analysis, null);
});

test("a malformed required deal identity is excluded while optional deal fields remain null-safe", () => {
  assert.equal(normalizeDashboardDeal(rawDeal({ id: null })), null);
  const optionalNulls = normalized(rawDeal({
    id: "deal-optional-nulls",
    customer_name: null,
    quote_date: null,
    service_type: null,
    deal_value: "not-a-number",
  }));
  assert.equal(optionalNulls.customerName, null);
  assert.equal(optionalNulls.quoteDate, null);
  assert.equal(optionalNulls.serviceType, null);
  assert.equal(optionalNulls.dealValue, 0);
});

test("null and malformed model_metadata degrade to missing freshness timestamps", async () => {
  const metadataValues: unknown[] = [null, [], "unexpected", { scoring: null }, { scoring: [] }, { scoring: { calculated_at: 42 } }];
  const deals = metadataValues.map((modelMetadata, index) => normalized(rawDeal({
    id: `deal-metadata-${index}`,
    deal_analyses: {
      ...(rawDeal().deal_analyses as Record<string, unknown>),
      id: `analysis-metadata-${index}`,
      model_metadata: modelMetadata,
    },
  })));
  const result = await loadDashboardData(ORGANIZATION_ID, {
    fetchDeals: async () => deals,
    fetchRecentImports: async () => [],
  });

  assert.equal(result.errors.core, false);
  assert.equal(result.metrics.scoredDeals, metadataValues.length);
  assert.equal(result.metrics.freshness.timestampedDeals, 0);
  assert.equal(result.metrics.freshness.missingTimestampCount, metadataValues.length);
  assert.equal(result.metrics.freshness.latestCalculatedAt, null);
});

test("old completed analysis without a score or scoring metadata remains analyzed and unscored", async () => {
  const oldAnalysis = normalized(rawDeal({
    deal_analyses: {
      id: "analysis-old",
      lost_reason: "PRICE",
      recovery_score: null,
      recovery_priority: null,
      recommended_action: "Follow up later.",
      model_metadata: { model: "older-prompt-7-shape" },
    },
  }));
  const result = await loadDashboardData(ORGANIZATION_ID, {
    fetchDeals: async () => [oldAnalysis],
    fetchRecentImports: async () => [],
  });

  assert.equal(result.errors.core, false);
  assert.equal(result.metrics.analyzedDeals, 1);
  assert.equal(result.metrics.scoredDeals, 0);
  assert.equal(result.metrics.completedButUnscored, 1);
  assert.deepEqual(result.topOpportunities, []);
});

test("Recent Imports failure is isolated from core metrics and Top Opportunities", async () => {
  const diagnostics: DashboardDiagnostic[] = [];
  const result = await loadDashboardData(ORGANIZATION_ID, {
    fetchDeals: async () => [normalized(rawDeal())],
    fetchRecentImports: async () => {
      throw new DashboardLoadError("DASHBOARD_IMPORTS_QUERY_FAILED", "42501");
    },
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  assert.equal(result.errors.core, false);
  assert.equal(result.errors.recentImports, true);
  assert.equal(result.metrics.totalDeals, 1);
  assert.equal(result.topOpportunities.length, 1);
  assert.deepEqual(result.recentImports, []);
  assert.deepEqual(diagnostics, [{ stage: "DASHBOARD_IMPORTS_QUERY_FAILED", code: "42501" }]);
});

test("Top Opportunities failure is isolated from core metrics and Recent Imports", async () => {
  const diagnostics: DashboardDiagnostic[] = [];
  const result = await loadDashboardData(ORGANIZATION_ID, {
    fetchDeals: async () => [normalized(rawDeal())],
    fetchRecentImports: async () => [recentUpload()],
    selectTopOpportunities: () => {
      throw new Error("private detail that must not cross the boundary");
    },
    reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  assert.equal(result.errors.core, false);
  assert.equal(result.errors.topOpportunities, true);
  assert.equal(result.metrics.totalDeals, 1);
  assert.deepEqual(result.topOpportunities, []);
  assert.equal(result.recentImports.length, 1);
  assert.deepEqual(diagnostics, [{ stage: "DASHBOARD_TOP_OPPORTUNITIES_FAILED", code: "UNKNOWN" }]);
});

test("critical Deals failure alone produces the full-dashboard error contract", async () => {
  const result = await loadDashboardData(ORGANIZATION_ID, {
    fetchDeals: async () => {
      throw new DashboardLoadError("DASHBOARD_DEALS_QUERY_FAILED", "42501");
    },
    fetchRecentImports: async () => [],
  });

  assert.equal(result.errors.core, true);
  assert.equal(result.metrics.totalDeals, 0);
  assert.deepEqual(result.topOpportunities, []);
});

test("every load performs fresh reads after pending, analyzed, and scored state transitions", async () => {
  let source = rawDeal({ analysis_status: "pending", deal_analyses: null });
  let readCount = 0;
  const load = () => loadDashboardData(ORGANIZATION_ID, {
    fetchDeals: async () => {
      readCount += 1;
      return [normalized(source)];
    },
    fetchRecentImports: async () => [],
  });

  const pending = await load();
  assert.equal(pending.metrics.statusCounts.pending, 1);
  assert.equal(pending.metrics.analyzedDeals, 0);
  assert.equal(pending.metrics.scoredDeals, 0);

  source = rawDeal({
    deal_analyses: {
      id: "analysis-transition",
      lost_reason: "TIMING",
      recovery_score: null,
      recovery_priority: null,
      recommended_action: "Reconnect.",
      model_metadata: null,
    },
  });
  const analyzed = await load();
  assert.equal(analyzed.metrics.statusCounts.pending, 0);
  assert.equal(analyzed.metrics.analyzedDeals, 1);
  assert.equal(analyzed.metrics.scoredDeals, 0);
  assert.equal(analyzed.metrics.completedButUnscored, 1);

  source = rawDeal();
  const scored = await load();
  assert.equal(scored.metrics.analyzedDeals, 1);
  assert.equal(scored.metrics.scoredDeals, 1);
  assert.equal(scored.metrics.averageRecoveryScore, 74);
  assert.equal(scored.metrics.priorities.find((item) => item.priority === "HIGH")?.count, 1);
  assert.deepEqual(scored.topOpportunities.map((deal) => deal.id), ["deal-owner-symptom"]);
  assert.equal(readCount, 3);
});

test("legacy Top Opportunities relationship order reproduces PGRST118 for the detected non-to-one relation", async () => {
  const migration = await readFile("supabase/migrations/20260810000000_initial_lostdeal_schema.sql", "utf8");
  const start = migration.indexOf("create table public.deal_analyses");
  const end = migration.indexOf("create index", start);
  const analysesDefinition = migration.slice(start, end);
  assert.match(analysesDefinition, /unique \(deal_id\)/);
  assert.match(analysesDefinition, /foreign key \(organization_id, deal_id\)/);
  assert.doesNotMatch(analysesDefinition, /unique \(organization_id, deal_id\)/);

  let requestedOrder = "";
  const client = createClient("https://example.supabase.co", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        requestedOrder = url.searchParams.get("order") ?? "";
        return new Response(JSON.stringify({
          code: "PGRST118",
          message: "Related ordering requires a to-one relationship.",
          details: null,
          hint: null,
        }), { status: 400, headers: { "content-type": "application/json" } });
      },
    },
  });
  const { error } = await client
    .from("deals")
    .select("id,deal_analyses!inner(recovery_score,lost_reason)")
    .order("deal_analyses(recovery_score)", { ascending: false, nullsFirst: false });

  assert.equal(requestedOrder, "deal_analyses(recovery_score).desc.nullslast");
  assert.equal(error?.code, "PGRST118");

  const server = await readFile("lib/dashboard/server.ts", "utf8");
  assert.doesNotMatch(server, /deal_analyses\(recovery_score\)/);
  assert.doesNotMatch(server, /fetchTopOpportunities/);
});

test("dashboard source tables retain authenticated SELECT grants and tenant RLS policies", async () => {
  const migration = await readFile("supabase/migrations/20260810000000_initial_lostdeal_schema.sql", "utf8");
  for (const table of ["deals", "deal_analyses", "uploads"]) {
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to authenticated;`));
    assert.match(migration, new RegExp(`create policy ${table}_select_org_member`));
  }
  assert.match(migration, /alter table public\.deals enable row level security;/);
  assert.match(migration, /alter table public\.deal_analyses enable row level security;/);
  assert.match(migration, /alter table public\.uploads enable row level security;/);
});
