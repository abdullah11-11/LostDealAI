import {
  analyzeDeepDeal,
  type CompletedDeepDealAnalysis,
  type DeepAnalysisModelRunner,
} from "@/lib/ai/deep-analysis";
import type { DeepAnalysisDetails } from "@/lib/ai/deep-analysis-schema";
import type { DealAnalysis } from "@/lib/ai/deal-analysis-schema";
import type { SourceDealRow } from "@/lib/ai/analysis-workflow";
import {
  DealAnalysisError,
  getDeepSemanticFailureClass,
  toDealAnalysisError,
  type AnalysisDiagnosticCategory,
  type AnalysisErrorCode,
} from "@/lib/ai/errors";
import type {
  AnalysisUsageReservation,
  SafeAnalysisUsage,
} from "@/lib/ai/analysis-workflow";

export type DeepAnalysisPersistenceData = DealAnalysis & {
  recovery_score: null;
  recovery_priority: null;
  score_explanation: null;
  analysis_mode: "DEEP";
  analysis_schema_version: string;
  deep_analysis: DeepAnalysisDetails;
  deep_analyzed_at: string;
  model_metadata: CompletedDeepDealAnalysis["metadata"];
  analysis_usage_key: string | null;
  analysis_usage_status: "LEGACY" | "PENDING";
};

export type ExistingDeepAnalysisState = {
  deepValid: boolean;
  scored: boolean;
  usageKey: string | null;
  usageStatus: "LEGACY" | "PENDING" | "COMMITTED";
};

export type DeepAnalysisStore = {
  fetch(dealId: string): Promise<SourceDealRow | null>;
  inspectExisting(dealId: string): Promise<ExistingDeepAnalysisState | null>;
  repairCompleted(dealId: string): Promise<boolean>;
  scoreCompleted(dealId: string): Promise<boolean>;
  reserveUsage(dealId: string, operationId: string): Promise<AnalysisUsageReservation>;
  finalizeUsage(dealId: string, usageKey: string): Promise<boolean>;
  claim(dealId: string): Promise<boolean>;
  persistAndComplete(dealId: string, data: DeepAnalysisPersistenceData): Promise<boolean>;
  fail(dealId: string, code: AnalysisErrorCode, diagnostic: AnalysisDiagnosticCategory | null): Promise<void>;
};

export type DeepAnalysisResult =
  | { status: "completed"; fresh: false }
  | { status: "completed"; fresh: true; usage: SafeAnalysisUsage }
  | { status: "processing" }
  | { status: "usage_pending" }
  | { status: "quota_exceeded" }
  | { status: "not_found" }
  | { status: "failed"; code: AnalysisErrorCode };

function trustedSource(deal: SourceDealRow) {
  return {
    dealValue: String(deal.deal_value),
    quoteDate: deal.quote_date,
    serviceType: deal.service_type,
    status: deal.status,
    salesNotes: deal.sales_notes,
    transcript: deal.transcript,
  };
}

export function toDeepPersistenceData(
  result: CompletedDeepDealAnalysis,
  usageKey: string | null = null,
  requiresFinalization = false,
): DeepAnalysisPersistenceData {
  const { deep, ...core } = result.analysis;
  return {
    ...core,
    recovery_score: null,
    recovery_priority: null,
    score_explanation: null,
    analysis_mode: "DEEP",
    analysis_schema_version: result.metadata.schema_version,
    deep_analysis: deep,
    deep_analyzed_at: result.metadata.analyzed_at,
    model_metadata: result.metadata,
    analysis_usage_key: usageKey,
    analysis_usage_status: requiresFinalization ? "PENDING" : "LEGACY",
  };
}

async function finalizeUsageWithBoundedRetry(
  store: DeepAnalysisStore,
  dealId: string,
  usageKey: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await store.finalizeUsage(dealId, usageKey)) return true;
    } catch {
      // The RPC is idempotent, so one immediate bounded retry is safe.
    }
  }
  return false;
}

export async function analyzeDeepDealWithStore(
  store: DeepAnalysisStore,
  dealId: string,
  operationId: string,
  rerun: boolean,
  runModel: DeepAnalysisModelRunner,
): Promise<DeepAnalysisResult> {
  const deal = await store.fetch(dealId);
  if (!deal) return { status: "not_found" };

  let existing: ExistingDeepAnalysisState | null;
  try {
    existing = await store.inspectExisting(dealId);
  } catch {
    return { status: "failed", code: "ANALYSIS_FAILED" };
  }
  if (existing?.usageStatus === "PENDING") {
    if (!existing.usageKey || !await finalizeUsageWithBoundedRetry(store, dealId, existing.usageKey)) {
      return { status: "usage_pending" };
    }
    if (existing.deepValid) {
      if (deal.analysis_status !== "completed" && !await store.repairCompleted(dealId)) {
        return { status: "failed", code: "ANALYSIS_FAILED" };
      }
      if (!existing.scored) await store.scoreCompleted(dealId).catch(() => false);
      return { status: "completed", fresh: false };
    }
  }
  if (existing?.deepValid && !rerun) {
    if (deal.analysis_status !== "completed" && !await store.repairCompleted(dealId)) {
      return { status: "failed", code: "ANALYSIS_FAILED" };
    }
    if (!existing.scored) await store.scoreCompleted(dealId).catch(() => false);
    return { status: "completed", fresh: false };
  }
  if (deal.analysis_status === "processing") return { status: "processing" };

  let reservation: AnalysisUsageReservation;
  try {
    reservation = await store.reserveUsage(dealId, operationId);
    if (!reservation.available) return { status: "failed", code: "ANALYSIS_FAILED" };
    if (!reservation.allowed) return { status: "quota_exceeded" };
    if (!reservation.isNew) return { status: "processing" };
  } catch {
    return { status: "failed", code: "ANALYSIS_FAILED" };
  }

  let claimed = false;
  try {
    claimed = await store.claim(dealId);
  } catch {
    return { status: "failed", code: "ANALYSIS_FAILED" };
  }
  if (!claimed) {
    const latest = await store.fetch(dealId);
    if (!latest) return { status: "not_found" };
    const stored = await store.inspectExisting(dealId).catch(() => null);
    if (stored?.deepValid) {
      if (stored.usageStatus === "PENDING") {
        if (!stored.usageKey || !await finalizeUsageWithBoundedRetry(store, dealId, stored.usageKey)) {
          return { status: "usage_pending" };
        }
      }
      if (latest.analysis_status !== "completed" && !await store.repairCompleted(dealId)) {
        return { status: "failed", code: "ANALYSIS_FAILED" };
      }
      if (!stored.scored) await store.scoreCompleted(dealId).catch(() => false);
      return { status: "completed", fresh: false };
    }
    return { status: "processing" };
  }

  let result: CompletedDeepDealAnalysis;
  try {
    result = await analyzeDeepDeal(trustedSource(deal), runModel);
    if (!await store.persistAndComplete(
      dealId,
      toDeepPersistenceData(
        result,
        reservation.requiresFinalization ? reservation.usageKey : null,
        reservation.requiresFinalization,
      ),
    )) {
      throw new DealAnalysisError("ANALYSIS_FAILED", false, "persistence_failure");
    }
  } catch (error) {
    const safeError = toDealAnalysisError(error);
    const semanticFailureClass = getDeepSemanticFailureClass(safeError);
    if (semanticFailureClass) {
      console.error(JSON.stringify({
        event: "deep_semantic_validation_failure",
        semantic_failure_class: semanticFailureClass,
      }));
    }
    await store.fail(dealId, safeError.code, safeError.diagnosticCategory);
    return { status: "failed", code: safeError.code };
  }

  if (
    reservation.requiresFinalization
    && !await finalizeUsageWithBoundedRetry(store, dealId, reservation.usageKey)
  ) {
    await store.scoreCompleted(dealId).catch(() => false);
    return { status: "usage_pending" };
  }
  await store.scoreCompleted(dealId).catch(() => false);

  return {
    status: "completed",
    fresh: true,
    usage: {
      model: result.metadata.model,
      ...(result.metadata.input_tokens !== undefined ? { input_tokens: result.metadata.input_tokens } : {}),
      ...(result.metadata.output_tokens !== undefined ? { output_tokens: result.metadata.output_tokens } : {}),
      ...(result.metadata.total_tokens !== undefined ? { total_tokens: result.metadata.total_tokens } : {}),
    },
  };
}
