import "server-only";

import { DEALS_PAGE_SIZE, DEAL_SORT_COLUMNS, type DealLostReason, type DealPriority } from "@/lib/deals/constants";
import {
  buildSafeDealSearchFilter,
  validateDynamicDealFilters,
  type DealsQueryState,
} from "@/lib/deals/query-state";
import { normalizeScoringMetadata, type NormalizedScoringMetadata } from "@/lib/deals/intelligence";
import { buildRecoveryScoreOrderRequest, reorderRowsById } from "@/lib/deals/recovery-sort";
import { DeepAnalysisDetailsSchema, type DeepAnalysisDetails } from "@/lib/ai/deep-analysis-schema";
import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type DealAnalysisSummary = {
  lost_reason: DealLostReason;
  recovery_score: number | null;
  recovery_priority: DealPriority | null;
  confidence_score: number;
};

export type DealEvidence = {
  source: "SALES_NOTES" | "TRANSCRIPT";
  excerpt: string;
};

export type DealAnalysisDetail = DealAnalysisSummary & {
  lost_reason_detail: string | null;
  buying_intent_score: number;
  evidence: DealEvidence[];
  positive_signals: string[];
  negative_signals: string[];
  recommended_action: string | null;
  recommended_timing: string | null;
  recommended_channel: string | null;
  follow_up_message: string | null;
  score_explanation: string | null;
  scoring_metadata: NormalizedScoringMetadata | null;
  analysis_mode: "STANDARD" | "DEEP";
  analysis_schema_version: string;
  deep_analysis: DeepAnalysisDetails | null;
  deep_analyzed_at: string | null;
  analysis_usage_status: "LEGACY" | "PENDING" | "COMMITTED";
};

export type DealListItem = {
  id: string;
  external_deal_id: string | null;
  customer_name: string | null;
  deal_value: string;
  quote_date: string | null;
  status: string;
  salesperson: string | null;
  service_type: string | null;
  lead_source: string | null;
  analysis_status: string;
  created_at: string;
  analysis: DealAnalysisSummary | null;
};

export type DealDetail = DealListItem & {
  sales_notes: string | null;
  transcript: string | null;
  analysis_error: string | null;
  requested_analysis_mode: "STANDARD" | "DEEP";
  deep_persistence_available: boolean;
  analysis: DealAnalysisDetail | null;
};

export type DealListData = {
  deals: DealListItem[];
  filteredCount: number;
  organizationCount: number;
  pendingCount: number;
  analyzedCount: number;
  unscoredCount: number;
  page: number;
  pageCount: number;
  services: string[];
  salespeople: string[];
  state: DealsQueryState;
  error: boolean;
};

const ANALYSIS_FIELDS = "lost_reason,recovery_score,recovery_priority,confidence_score";
const LEGACY_DETAIL_ANALYSIS_FIELDS = `${ANALYSIS_FIELDS},lost_reason_detail,buying_intent_score,evidence,positive_signals,negative_signals,recommended_action,recommended_timing,recommended_channel,follow_up_message,score_explanation,model_metadata`;
const DETAIL_ANALYSIS_FIELDS = `${LEGACY_DETAIL_ANALYSIS_FIELDS},analysis_mode,analysis_schema_version,deep_analysis,deep_analyzed_at`;
const RUNTIME_DETAIL_ANALYSIS_FIELDS = `${DETAIL_ANALYSIS_FIELDS},analysis_usage_status`;
const LIST_FIELDS = "id,external_deal_id,customer_name,deal_value,quote_date,status,salesperson,service_type,lead_source,analysis_status,created_at";

function normalizeAnalysis(value: unknown): DealAnalysisSummary | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object") return null;
  const row = candidate as Record<string, unknown>;
  if (typeof row.lost_reason !== "string" || typeof row.confidence_score !== "number") return null;
  return {
    lost_reason: row.lost_reason as DealLostReason,
    recovery_score: typeof row.recovery_score === "number" ? row.recovery_score : null,
    recovery_priority: typeof row.recovery_priority === "string" ? row.recovery_priority as DealPriority : null,
    confidence_score: row.confidence_score,
  };
}

function normalizeEvidence(value: unknown): DealEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if ((row.source !== "SALES_NOTES" && row.source !== "TRANSCRIPT") || typeof row.excerpt !== "string") return [];
    return [{ source: row.source, excerpt: row.excerpt }];
  });
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeDetailAnalysis(value: unknown): DealAnalysisDetail | null {
  const summary = normalizeAnalysis(value);
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!summary || !candidate || typeof candidate !== "object") return null;
  const row = candidate as Record<string, unknown>;
  if (typeof row.buying_intent_score !== "number") return null;
  const nullableString = (field: string) => typeof row[field] === "string" ? row[field] as string : null;
  const metadata = row.model_metadata && typeof row.model_metadata === "object" && !Array.isArray(row.model_metadata)
    ? row.model_metadata as Record<string, unknown>
    : null;
  const scoring = metadata?.scoring && typeof metadata.scoring === "object" && !Array.isArray(metadata.scoring)
    ? metadata.scoring as Record<string, unknown>
    : null;
  const scoringMetadata = normalizeScoringMetadata(scoring);
  const deep = DeepAnalysisDetailsSchema.safeParse(row.deep_analysis);
  return {
    ...summary,
    lost_reason_detail: nullableString("lost_reason_detail"),
    buying_intent_score: row.buying_intent_score,
    evidence: normalizeEvidence(row.evidence),
    positive_signals: normalizeStringArray(row.positive_signals),
    negative_signals: normalizeStringArray(row.negative_signals),
    recommended_action: nullableString("recommended_action"),
    recommended_timing: nullableString("recommended_timing"),
    recommended_channel: nullableString("recommended_channel"),
    follow_up_message: nullableString("follow_up_message"),
    score_explanation: nullableString("score_explanation"),
    scoring_metadata: scoringMetadata,
    analysis_mode: row.analysis_mode === "DEEP" ? "DEEP" : "STANDARD",
    analysis_schema_version: nullableString("analysis_schema_version") ?? "standard-1.0",
    deep_analysis: deep.success ? deep.data : null,
    deep_analyzed_at: nullableString("deep_analyzed_at"),
    analysis_usage_status: row.analysis_usage_status === "PENDING" || row.analysis_usage_status === "COMMITTED"
      ? row.analysis_usage_status
      : "LEGACY",
  };
}

function missingDeepColumns(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const row = error as Record<string, unknown>;
  const message = `${row.code ?? ""} ${row.message ?? ""} ${row.details ?? ""}`;
  return /(42703|PGRST204|requested_analysis_mode|analysis_schema_version|deep_analysis|deep_analyzed_at|analysis_usage_status)/i.test(message);
}

function normalizeRecoverySortIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).deal_id !== "string") {
      return null;
    }
    ids.push((item as Record<string, unknown>).deal_id as string);
  }
  return ids;
}

function normalizeListRow(value: unknown): DealListItem | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.deal_value !== "number" && typeof row.deal_value !== "string" ||
    typeof row.analysis_status !== "string" ||
    typeof row.created_at !== "string"
  ) return null;
  const nullableString = (field: string) => typeof row[field] === "string" ? row[field] as string : null;
  return {
    id: row.id,
    external_deal_id: nullableString("external_deal_id"),
    customer_name: nullableString("customer_name"),
    deal_value: String(row.deal_value),
    quote_date: nullableString("quote_date"),
    status: nullableString("status") ?? "lost",
    salesperson: nullableString("salesperson"),
    service_type: nullableString("service_type"),
    lead_source: nullableString("lead_source"),
    analysis_status: row.analysis_status,
    created_at: row.created_at,
    analysis: normalizeAnalysis(row.deal_analyses),
  };
}

function distinctOptions(values: Array<string | null>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))))
    .sort((left, right) => left.localeCompare(right, "en-US"));
}

export async function getDealListData(
  supabase: ServerSupabaseClient,
  organizationId: string,
  requestedState: DealsQueryState,
): Promise<DealListData> {
  const [
    { data: optionRows, error: optionError },
    { count: organizationCount, error: countError },
    { count: pendingCount, error: pendingCountError },
    { count: analyzedCount, error: analyzedCountError },
    { count: unscoredCount, error: unscoredCountError },
  ] = await Promise.all([
    supabase
      .from("deals")
      .select("service_type,salesperson")
      .eq("organization_id", organizationId)
      .range(0, 1_999),
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId),
    supabase
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("analysis_status", "pending"),
    supabase
      .from("deals")
      .select("id,deal_analyses!inner(recovery_score)", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("analysis_status", "completed"),
    supabase
      .from("deals")
      .select("id,deal_analyses!inner(recovery_score)", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("analysis_status", "completed")
      .is("deal_analyses.recovery_score", null),
  ]);

  if (optionError || countError || pendingCountError || analyzedCountError || unscoredCountError) {
    return {
      deals: [], filteredCount: 0, organizationCount: 0, pendingCount: 0, analyzedCount: 0, unscoredCount: 0, page: 1, pageCount: 1,
      services: [], salespeople: [], state: requestedState, error: true,
    };
  }

  const services = distinctOptions((optionRows ?? []).map((row) => row.service_type));
  const salespeople = distinctOptions((optionRows ?? []).map((row) => row.salesperson));
  const state = validateDynamicDealFilters(requestedState, services, salespeople);
  const hasAnalysisFilter = Boolean(state.priority || state.reason);
  const selection = `${LIST_FIELDS},deal_analyses${hasAnalysisFilter ? "!inner" : ""}(${ANALYSIS_FIELDS})`;

  let countQuery = supabase
    .from("deals")
    .select(selection, { count: "exact", head: true })
    .eq("organization_id", organizationId);

  const searchFilter = buildSafeDealSearchFilter(state.q);
  if (searchFilter) countQuery = countQuery.or(searchFilter);
  if (state.analysis) countQuery = countQuery.eq("analysis_status", state.analysis);
  if (state.priority) countQuery = countQuery.eq("deal_analyses.recovery_priority", state.priority);
  if (state.reason) countQuery = countQuery.eq("deal_analyses.lost_reason", state.reason);
  if (state.service) countQuery = countQuery.eq("service_type", state.service);
  if (state.salesperson) countQuery = countQuery.eq("salesperson", state.salesperson);

  const { count, error: filteredCountError } = await countQuery;
  if (filteredCountError) {
    return {
      deals: [], filteredCount: 0, organizationCount: organizationCount ?? 0,
      pendingCount: pendingCount ?? 0, analyzedCount: analyzedCount ?? 0, unscoredCount: unscoredCount ?? 0, page: state.page, pageCount: 1, services, salespeople, state, error: true,
    };
  }

  const filteredCount = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(filteredCount / DEALS_PAGE_SIZE));
  const effectivePage = Math.min(state.page, pageCount);
  const from = (effectivePage - 1) * DEALS_PAGE_SIZE;
  const to = from + DEALS_PAGE_SIZE - 1;
  const primaryColumn = DEAL_SORT_COLUMNS[state.sort];

  if (state.sort === "recovery_score") {
    const { data: orderedRows, error: orderingError } = await supabase.rpc(
      "list_deal_ids_by_recovery_score",
      buildRecoveryScoreOrderRequest(organizationId, state, from, DEALS_PAGE_SIZE),
    );
    const orderedIds = normalizeRecoverySortIds(orderedRows);
    if (orderingError || !orderedIds) {
      return {
        deals: [], filteredCount: 0, organizationCount: organizationCount ?? 0,
        pendingCount: pendingCount ?? 0, analyzedCount: analyzedCount ?? 0, unscoredCount: unscoredCount ?? 0, page: state.page, pageCount: 1, services, salespeople, state, error: true,
      };
    }

    let orderedDeals: DealListItem[] = [];
    if (orderedIds.length > 0) {
      const { data: selectedRows, error: selectedRowsError } = await supabase
        .from("deals")
        .select(selection)
        .eq("organization_id", organizationId)
        .in("id", orderedIds);
      if (selectedRowsError) {
        return {
          deals: [], filteredCount: 0, organizationCount: organizationCount ?? 0,
          pendingCount: pendingCount ?? 0, analyzedCount: analyzedCount ?? 0, unscoredCount: unscoredCount ?? 0, page: state.page, pageCount: 1, services, salespeople, state, error: true,
        };
      }
      const normalizedRows = (selectedRows ?? [])
        .map(normalizeListRow)
        .filter((deal): deal is DealListItem => Boolean(deal));
      const reordered = reorderRowsById(normalizedRows, orderedIds);
      if (!reordered) {
        return {
          deals: [], filteredCount: 0, organizationCount: organizationCount ?? 0,
          pendingCount: pendingCount ?? 0, analyzedCount: analyzedCount ?? 0, unscoredCount: unscoredCount ?? 0, page: state.page, pageCount: 1, services, salespeople, state, error: true,
        };
      }
      orderedDeals = reordered;
    }

    return {
      deals: orderedDeals,
      filteredCount,
      organizationCount: organizationCount ?? 0,
      pendingCount: pendingCount ?? 0,
      analyzedCount: analyzedCount ?? 0,
      unscoredCount: unscoredCount ?? 0,
      page: effectivePage,
      pageCount,
      services,
      salespeople,
      state: { ...state, page: effectivePage },
      error: false,
    };
  }

  let query = supabase
    .from("deals")
    .select(selection)
    .eq("organization_id", organizationId);
  if (searchFilter) query = query.or(searchFilter);
  if (state.analysis) query = query.eq("analysis_status", state.analysis);
  if (state.priority) query = query.eq("deal_analyses.recovery_priority", state.priority);
  if (state.reason) query = query.eq("deal_analyses.lost_reason", state.reason);
  if (state.service) query = query.eq("service_type", state.service);
  if (state.salesperson) query = query.eq("salesperson", state.salesperson);
  query = query.order(primaryColumn, { ascending: state.direction === "asc", nullsFirst: false });
  query = query.order("id", { ascending: true }).range(from, to);

  const { data, error } = await query;
  if (error) {
    return {
      deals: [], filteredCount: 0, organizationCount: organizationCount ?? 0,
      pendingCount: pendingCount ?? 0, analyzedCount: analyzedCount ?? 0, unscoredCount: unscoredCount ?? 0, page: state.page, pageCount: 1, services, salespeople, state, error: true,
    };
  }

  return {
    deals: (data ?? []).map(normalizeListRow).filter((deal): deal is DealListItem => Boolean(deal)),
    filteredCount,
    organizationCount: organizationCount ?? 0,
    pendingCount: pendingCount ?? 0,
    analyzedCount: analyzedCount ?? 0,
    unscoredCount: unscoredCount ?? 0,
    page: effectivePage,
    pageCount,
    services,
    salespeople,
    state: { ...state, page: effectivePage },
    error: false,
  };
}

export async function getDealDetail(
  supabase: ServerSupabaseClient,
  organizationId: string,
  dealId: string,
): Promise<{ deal: DealDetail | null; error: boolean }> {
  const enriched = await supabase
    .from("deals")
    .select(`${LIST_FIELDS},sales_notes,transcript,analysis_error,requested_analysis_mode,deal_analyses(${RUNTIME_DETAIL_ANALYSIS_FIELDS})`)
    .eq("organization_id", organizationId)
    .eq("id", dealId)
    .maybeSingle();

  let data: unknown = enriched.data;
  let error: unknown = enriched.error;

  let deepPersistenceAvailable = !error;
  if (error && missingDeepColumns(error)) {
    const prompt153 = await supabase
      .from("deals")
      .select(`${LIST_FIELDS},sales_notes,transcript,analysis_error,requested_analysis_mode,deal_analyses(${DETAIL_ANALYSIS_FIELDS})`)
      .eq("organization_id", organizationId)
      .eq("id", dealId)
      .maybeSingle();
    data = prompt153.data as unknown;
    error = prompt153.error as unknown;
    deepPersistenceAvailable = false;
  }
  if (error && missingDeepColumns(error)) {
    const legacy = await supabase
      .from("deals")
      .select(`${LIST_FIELDS},sales_notes,transcript,analysis_error,deal_analyses(${LEGACY_DETAIL_ANALYSIS_FIELDS})`)
      .eq("organization_id", organizationId)
      .eq("id", dealId)
      .maybeSingle();
    data = legacy.data as unknown;
    error = legacy.error as unknown;
  }

  if (error) return { deal: null, error: true };
  const normalized = normalizeListRow(data);
  if (!normalized || !data || typeof data !== "object") return { deal: null, error: false };
  const detail = data as Record<string, unknown>;
  return {
    deal: {
      ...normalized,
      sales_notes: typeof detail.sales_notes === "string" ? detail.sales_notes : null,
      transcript: typeof detail.transcript === "string" ? detail.transcript : null,
      analysis_error: typeof detail.analysis_error === "string" ? detail.analysis_error : null,
      requested_analysis_mode: detail.requested_analysis_mode === "DEEP" ? "DEEP" : "STANDARD",
      deep_persistence_available: deepPersistenceAvailable,
      analysis: normalizeDetailAnalysis(detail.deal_analyses),
    },
    error: false,
  };
}
