import "server-only";

import { DashboardLoadError, loadDashboardData } from "@/lib/dashboard/load";
import { normalizeDashboardDeal, normalizeDashboardUpload } from "@/lib/dashboard/normalize";
import type {
  DashboardData,
  DashboardDealRecord,
  DashboardDiagnostic,
  DashboardUploadRecord,
} from "@/lib/dashboard/types";
import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export const DASHBOARD_QUERY_PAGE_SIZE = 1_000;
export const TOP_OPPORTUNITY_LIMIT = 5;
export const RECENT_IMPORT_LIMIT = 5;

export const DASHBOARD_ANALYSIS_FIELDS = "id,lost_reason,recovery_score,recovery_priority,recommended_action,model_metadata";
export const DASHBOARD_DEAL_FIELDS = `id,organization_id,customer_name,deal_value,quote_date,service_type,analysis_status,created_at,deal_analyses(${DASHBOARD_ANALYSIS_FIELDS})`;

function safeDatabaseCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "UNKNOWN";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : "UNKNOWN";
}

function reportDashboardDiagnostic(diagnostic: DashboardDiagnostic): void {
  console.error(JSON.stringify({
    event: "LOSTDEAL_DASHBOARD_DIAGNOSTIC",
    stage: diagnostic.stage,
    code: diagnostic.code,
    timestamp: new Date().toISOString(),
    ...(diagnostic.skippedRows === undefined ? {} : { skippedRows: diagnostic.skippedRows }),
  }));
}

async function fetchAllDashboardDeals(
  supabase: ServerSupabaseClient,
  organizationId: string,
): Promise<DashboardDealRecord[]> {
  const records: DashboardDealRecord[] = [];
  let offset = 0;
  let expectedCount: number | null = null;

  do {
    const { data, error, count } = await supabase
      .from("deals")
      .select(DASHBOARD_DEAL_FIELDS, { count: "exact" })
      .eq("organization_id", organizationId)
      .order("id", { ascending: true })
      .range(offset, offset + DASHBOARD_QUERY_PAGE_SIZE - 1);
    if (error) throw new DashboardLoadError("DASHBOARD_DEALS_QUERY_FAILED", safeDatabaseCode(error));
    expectedCount = count ?? expectedCount;
    const rawPage = data ?? [];
    const page = rawPage.map(normalizeDashboardDeal).filter((deal): deal is DashboardDealRecord => Boolean(deal));
    const skippedRows = rawPage.length - page.length;
    if (skippedRows > 0) {
      reportDashboardDiagnostic({
        stage: "DASHBOARD_DEAL_NORMALIZATION_SKIPPED",
        code: "INVALID_ROW",
        skippedRows,
      });
    }
    records.push(...page);
    const returnedRows = rawPage.length;
    if (returnedRows === 0) break;
    offset += returnedRows;
  } while (expectedCount === null || offset < expectedCount);

  return records;
}

async function fetchRecentImports(
  supabase: ServerSupabaseClient,
  organizationId: string,
): Promise<DashboardUploadRecord[]> {
  const { data, error } = await supabase
    .from("uploads")
    .select("id,organization_id,filename,status,total_rows,valid_rows,invalid_rows,created_at,updated_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(RECENT_IMPORT_LIMIT);
  if (error) throw new DashboardLoadError("DASHBOARD_IMPORTS_QUERY_FAILED", safeDatabaseCode(error));
  const rawImports = data ?? [];
  const imports = rawImports.map(normalizeDashboardUpload).filter((upload): upload is DashboardUploadRecord => Boolean(upload));
  const skippedRows = rawImports.length - imports.length;
  if (skippedRows > 0) {
    reportDashboardDiagnostic({
      stage: "DASHBOARD_IMPORT_NORMALIZATION_SKIPPED",
      code: "INVALID_ROW",
      skippedRows,
    });
  }
  return imports;
}

export async function getDashboardData(
  supabase: ServerSupabaseClient,
  organizationId: string,
): Promise<DashboardData> {
  return loadDashboardData(
    organizationId,
    {
      fetchDeals: () => fetchAllDashboardDeals(supabase, organizationId),
      fetchRecentImports: () => fetchRecentImports(supabase, organizationId),
      reportDiagnostic: reportDashboardDiagnostic,
    },
    TOP_OPPORTUNITY_LIMIT,
    RECENT_IMPORT_LIMIT,
  );
}
