import { AI_CONFIG } from "@/lib/ai/config";
import {
  analyzeDeal,
  type AnalysisModelRunner,
  type CompletedDealAnalysis,
  type TrustedDealSource,
} from "@/lib/ai/analyze-deal";
import { runWithConcurrency } from "@/lib/ai/batch";
import type { DealAnalysis } from "@/lib/ai/deal-analysis-schema";
import {
  DealAnalysisError,
  toDealAnalysisError,
  type AnalysisDiagnosticCategory,
  type AnalysisErrorCode,
} from "@/lib/ai/errors";

export type SourceDealRow = {
  id: string;
  deal_value: number | string;
  quote_date: string | null;
  service_type: string | null;
  status: string;
  sales_notes: string | null;
  transcript: string | null;
  analysis_status: string;
};

export type AnalysisPersistenceData = DealAnalysis & {
  recovery_score: null;
  recovery_priority: null;
  score_explanation: null;
  model_metadata: CompletedDealAnalysis["metadata"];
  analysis_usage_key: string | null;
  analysis_usage_status: "LEGACY" | "PENDING";
};

export type ExistingAnalysisState = {
  valid: boolean;
  scored: boolean;
  usageKey: string | null;
  usageStatus: "LEGACY" | "PENDING" | "COMMITTED";
};

export type AnalysisUsageReservation = {
  available: boolean;
  allowed: boolean;
  isNew: boolean;
  requiresFinalization: boolean;
  usageKey: string;
};

export type DealAnalysisStore = {
  fetch(dealId: string): Promise<SourceDealRow | null>;
  inspectExisting(dealId: string): Promise<ExistingAnalysisState | null>;
  repairCompleted(dealId: string): Promise<boolean>;
  scoreCompleted(dealId: string): Promise<boolean>;
  reserveUsage?(dealId: string): Promise<AnalysisUsageReservation>;
  finalizeUsage?(dealId: string, usageKey: string): Promise<boolean>;
  claim(dealId: string): Promise<boolean>;
  recoverInterrupted?(dealId: string): Promise<boolean>;
  persistAndComplete(dealId: string, data: AnalysisPersistenceData): Promise<boolean>;
  fail(dealId: string, code: AnalysisErrorCode, diagnostic: AnalysisDiagnosticCategory | null): Promise<void>;
  countPending(): Promise<number>;
  listPending(limit: number): Promise<string[]>;
};

export type SafeAnalysisUsage = {
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export type SingleDealAnalysisResult =
  | { status: "completed"; fresh: false }
  | { status: "completed"; fresh: true; usage: SafeAnalysisUsage }
  | { status: "processing" }
  | { status: "usage_pending" }
  | { status: "quota_exceeded" }
  | { status: "not_found" }
  | { status: "failed"; code: AnalysisErrorCode };

export type BatchAnalysisResult = {
  selected: number;
  completed: number;
  failed: number;
  skipped: number;
  remainingPending: number;
};

function trustedSource(deal: SourceDealRow): TrustedDealSource {
  return {
    dealValue: String(deal.deal_value),
    quoteDate: deal.quote_date,
    serviceType: deal.service_type,
    status: deal.status,
    salesNotes: deal.sales_notes,
    transcript: deal.transcript,
  };
}

export function toPersistenceData(
  result: CompletedDealAnalysis,
  usageKey: string | null = null,
  requiresFinalization = false,
): AnalysisPersistenceData {
  return {
    ...result.analysis,
    recovery_score: null,
    recovery_priority: null,
    score_explanation: null,
    model_metadata: result.metadata,
    analysis_usage_key: usageKey,
    analysis_usage_status: requiresFinalization ? "PENDING" : "LEGACY",
  };
}

async function finalizeUsageWithBoundedRetry(
  store: DealAnalysisStore,
  dealId: string,
  usageKey: string,
): Promise<boolean> {
  if (!store.finalizeUsage) return false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (await store.finalizeUsage(dealId, usageKey)) return true;
    } catch {
      // One immediate idempotent retry covers a transient RPC response failure.
    }
  }
  return false;
}

export async function analyzeDealWithStore(
  store: DealAnalysisStore,
  dealId: string,
  runModel: AnalysisModelRunner,
): Promise<SingleDealAnalysisResult> {
  const deal = await store.fetch(dealId);
  if (!deal) return { status: "not_found" };

  let existing: ExistingAnalysisState | null;
  try {
    existing = await store.inspectExisting(dealId);
  } catch {
    return { status: "failed", code: "ANALYSIS_FAILED" };
  }
  if (existing?.valid) {
    if (existing.usageStatus === "PENDING") {
      if (!existing.usageKey || !await finalizeUsageWithBoundedRetry(store, dealId, existing.usageKey)) {
        return { status: "usage_pending" };
      }
    }
    if (deal.analysis_status !== "completed" && !await store.repairCompleted(dealId)) {
      return { status: "failed", code: "ANALYSIS_FAILED" };
    }
    if (!existing.scored) {
      try {
        await store.scoreCompleted(dealId);
      } catch {
        // Scoring is a separate deterministic stage and must not invalidate analysis.
      }
    }
    return { status: "completed", fresh: false };
  }

  if (deal.analysis_status === "completed") return { status: "completed", fresh: false };
  if (deal.analysis_status === "processing") {
    if (!store.recoverInterrupted || !await store.recoverInterrupted(dealId)) return { status: "processing" };
  }

  let usageKey: string | null = null;
  let requiresFinalization = false;
  if (store.reserveUsage) {
    try {
      const reservation = await store.reserveUsage(dealId);
      if (!reservation.available) return { status: "failed", code: "ANALYSIS_FAILED" };
      if (!reservation.allowed) return { status: "quota_exceeded" };
      if (!reservation.isNew) return { status: "processing" };
      usageKey = reservation.usageKey;
      requiresFinalization = reservation.requiresFinalization;
    } catch {
      return { status: "failed", code: "ANALYSIS_FAILED" };
    }
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
    if (stored?.valid) {
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
    if (latest.analysis_status === "completed") return { status: "completed", fresh: false };
    return { status: "processing" };
  }

  let result: CompletedDealAnalysis;
  try {
    result = await analyzeDeal(trustedSource(deal), runModel);
    const durableUsageKey = requiresFinalization ? usageKey : null;
    if (!await store.persistAndComplete(
      dealId,
      toPersistenceData(result, durableUsageKey, requiresFinalization),
    )) {
      throw new DealAnalysisError("ANALYSIS_FAILED", false, "persistence_failure");
    }
  } catch (error) {
    const safeError = toDealAnalysisError(error);
    await store.fail(dealId, safeError.code, safeError.diagnosticCategory);
    return { status: "failed", code: safeError.code };
  }

  if (requiresFinalization && usageKey && !await finalizeUsageWithBoundedRetry(store, dealId, usageKey)) {
    await store.scoreCompleted(dealId).catch(() => false);
    return { status: "usage_pending" };
  }

  try {
    await store.scoreCompleted(dealId);
  } catch {
    // Keep completed AI analysis intact; users can retry deterministic scoring.
  }
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

export async function analyzePendingWithStore(
  store: DealAnalysisStore,
  runModel: AnalysisModelRunner,
): Promise<BatchAnalysisResult> {
  const pendingCount = await store.countPending();
  const ids = await store.listPending(AI_CONFIG.batchSizeLimit);
  const results = await runWithConcurrency(ids, (id) => analyzeDealWithStore(store, id, runModel));
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  for (const result of results) {
    if (result.status === "rejected") failed += 1;
    else if (result.value.status === "completed") completed += 1;
    else if (result.value.status === "failed" || result.value.status === "usage_pending") failed += 1;
    else skipped += 1;
  }
  return {
    selected: ids.length,
    completed,
    failed,
    skipped,
    remainingPending: Math.max(0, pendingCount - ids.length),
  };
}
