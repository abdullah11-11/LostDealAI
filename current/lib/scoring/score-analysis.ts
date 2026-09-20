import { SCORING_BATCH_CONCURRENCY, SCORING_BATCH_LIMIT } from "@/lib/scoring/constants";
import { calculateRecoveryScore } from "@/lib/scoring/recovery-score";
import type { PersistedScoringMetadata } from "@/lib/scoring/types";
import type { DealAnalysis } from "@/lib/ai/deal-analysis-schema";

export type ScorableAnalysisRow = DealAnalysis & {
  dealId: string;
  quoteDate: string | null;
  analysisStatus: string;
  recoveryScore: number | null;
  modelMetadata: Record<string, unknown>;
};

export type ScorePersistenceData = {
  recovery_score: number;
  recovery_priority: "HIGH" | "MEDIUM" | "LOW";
  score_explanation: string;
  model_metadata: Record<string, unknown> & { scoring: PersistedScoringMetadata };
};

export type ScoreBatchMode = "unscored" | "refresh";

export type RecoveryScoringStore = {
  fetch(dealId: string): Promise<ScorableAnalysisRow | null>;
  persist(dealId: string, data: ScorePersistenceData): Promise<boolean>;
  countCandidates(mode: ScoreBatchMode, afterDealId: string | null): Promise<number>;
  listCandidateIds(mode: ScoreBatchMode, afterDealId: string | null, limit: number): Promise<string[]>;
};

export type SingleScoreResult =
  | { status: "completed"; score: number; priority: "HIGH" | "MEDIUM" | "LOW" }
  | { status: "not_found" }
  | { status: "not_scorable" }
  | { status: "failed" };

export type ScoreBatchResult = {
  selected: number;
  completed: number;
  failed: number;
  skipped: number;
  remaining: number;
  nextCursor: string | null;
};

function toPersistenceData(
  analysis: ScorableAnalysisRow,
  asOfDate: string,
  calculatedAt: string,
): ScorePersistenceData {
  const score = calculateRecoveryScore({
    buyingIntentScore: analysis.buying_intent_score,
    confidenceScore: analysis.confidence_score,
    lostReason: analysis.lost_reason,
    recommendedChannel: analysis.recommended_channel,
    evidenceCount: analysis.evidence.length,
    quoteDate: analysis.quoteDate,
    asOfDate,
  });
  const scoring: PersistedScoringMetadata = {
    version: score.scoringVersion,
    calculated_at: calculatedAt,
    as_of_date: score.asOfDate,
    buying_intent_score: score.buyingIntentScore,
    buying_intent_weight: score.buyingIntentWeight,
    buying_intent_contribution: score.buyingIntentContribution,
    reason: score.lostReason,
    reason_recoverability: score.reasonRecoverability,
    reason_weight: score.reasonWeight,
    reason_contribution: score.reasonContribution,
    quote_date: score.quoteDate,
    quote_age_days: score.quoteAgeDays,
    recency_score: score.recencyScore,
    recency_weight: score.recencyWeight,
    recency_contribution: score.recencyContribution,
    confidence_score: score.confidenceScore,
    confidence_multiplier: score.confidenceMultiplier,
    base_score: score.baseScore,
    pre_cap_score: score.preCapScore,
    applied_caps: score.appliedCaps,
    notes: score.notes,
    final_score: score.recoveryScore,
    priority: score.recoveryPriority,
  };
  return {
    recovery_score: score.recoveryScore,
    recovery_priority: score.recoveryPriority,
    score_explanation: score.scoreExplanation,
    model_metadata: { ...analysis.modelMetadata, scoring },
  };
}

export async function scoreDealWithStore(
  store: RecoveryScoringStore,
  dealId: string,
  asOfDate: string,
  calculatedAt = new Date().toISOString(),
): Promise<SingleScoreResult> {
  try {
    const analysis = await store.fetch(dealId);
    if (!analysis) return { status: "not_found" };
    if (analysis.analysisStatus !== "completed") return { status: "not_scorable" };
    const persistence = toPersistenceData(analysis, asOfDate, calculatedAt);
    if (!await store.persist(dealId, persistence)) return { status: "failed" };
    return {
      status: "completed",
      score: persistence.recovery_score,
      priority: persistence.recovery_priority,
    };
  } catch {
    return { status: "failed" };
  }
}

async function scoreWithConcurrency<T>(items: string[], worker: (id: string) => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCORING_BATCH_CONCURRENCY, items.length) }, consume));
  return results;
}

export async function scoreBatchWithStore(
  store: RecoveryScoringStore,
  mode: ScoreBatchMode,
  asOfDate: string,
  afterDealId: string | null = null,
): Promise<ScoreBatchResult> {
  const candidateCount = await store.countCandidates(mode, afterDealId);
  const ids = await store.listCandidateIds(mode, afterDealId, SCORING_BATCH_LIMIT);
  const calculatedAt = new Date().toISOString();
  const outcomes = await scoreWithConcurrency(ids, (id) => scoreDealWithStore(store, id, asOfDate, calculatedAt));
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "rejected" || outcome.value.status === "failed") failed += 1;
    else if (outcome.value.status === "completed") completed += 1;
    else skipped += 1;
  }
  const remaining = Math.max(0, candidateCount - ids.length);
  return {
    selected: ids.length,
    completed,
    failed,
    skipped,
    remaining,
    nextCursor: remaining > 0 ? ids.at(-1) ?? null : null,
  };
}

