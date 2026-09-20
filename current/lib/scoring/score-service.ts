import "server-only";

import { DealAnalysisSchema, type DealAnalysis } from "@/lib/ai/deal-analysis-schema";
import { persistAuthorizedRecoveryScore } from "@/lib/ai/analysis-persistence";
import {
  scoreBatchWithStore,
  scoreDealWithStore,
  type RecoveryScoringStore,
  type ScoreBatchMode,
  type ScoreBatchResult,
  type ScorableAnalysisRow,
  type SingleScoreResult,
} from "@/lib/scoring/score-analysis";
import { SCORING_BATCH_LIMIT } from "@/lib/scoring/constants";
import { currentUtcDate } from "@/lib/scoring/recovery-score";
import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

const STORED_ANALYSIS_FIELDS = [
  "lost_reason",
  "lost_reason_detail",
  "buying_intent_score",
  "confidence_score",
  "evidence",
  "positive_signals",
  "negative_signals",
  "recommended_action",
  "recommended_timing",
  "recommended_channel",
  "follow_up_message",
  "recovery_score",
  "model_metadata",
].join(",");

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function relatedValue(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
}

function parseStoredAnalysis(value: unknown): { analysis: DealAnalysis; row: Record<string, unknown> } | null {
  const row = relatedValue(value);
  if (!row) return null;
  const parsed = DealAnalysisSchema.safeParse({
    lost_reason: row.lost_reason,
    lost_reason_detail: row.lost_reason_detail,
    buying_intent_score: row.buying_intent_score,
    confidence_score: row.confidence_score,
    evidence: row.evidence,
    positive_signals: row.positive_signals,
    negative_signals: row.negative_signals,
    recommended_action: row.recommended_action,
    recommended_timing: row.recommended_timing,
    recommended_channel: row.recommended_channel,
    follow_up_message: row.follow_up_message,
  });
  return parsed.success ? { analysis: parsed.data, row } : null;
}

function normalizeScorableDeal(value: unknown): ScorableAnalysisRow | null {
  if (!value || typeof value !== "object") return null;
  const deal = value as Record<string, unknown>;
  if (typeof deal.id !== "string" || typeof deal.analysis_status !== "string") return null;
  const stored = parseStoredAnalysis(deal.deal_analyses);
  if (!stored) return null;
  return {
    ...stored.analysis,
    dealId: deal.id,
    quoteDate: typeof deal.quote_date === "string" ? deal.quote_date : null,
    analysisStatus: deal.analysis_status,
    recoveryScore: typeof stored.row.recovery_score === "number" ? stored.row.recovery_score : null,
    modelMetadata: recordValue(stored.row.model_metadata),
  };
}

export function createSupabaseScoringStore(
  supabase: ServerSupabaseClient,
  organizationId: string,
): RecoveryScoringStore {
  return {
    async fetch(dealId) {
      const { data, error } = await supabase
        .from("deals")
        .select(`id,quote_date,analysis_status,deal_analyses(${STORED_ANALYSIS_FIELDS})`)
        .eq("organization_id", organizationId)
        .eq("id", dealId)
        .maybeSingle();
      if (error) throw new Error("SCORING_FETCH_FAILED");
      return normalizeScorableDeal(data);
    },

    async persist(dealId, persistence) {
      return persistAuthorizedRecoveryScore(supabase, organizationId, dealId, persistence);
    },

    async countCandidates(mode, afterDealId) {
      let query = supabase
        .from("deals")
        .select("id,deal_analyses!inner(recovery_score)", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("analysis_status", "completed");
      if (mode === "unscored") query = query.is("deal_analyses.recovery_score", null);
      if (afterDealId) query = query.gt("id", afterDealId);
      const { count, error } = await query;
      if (error) throw new Error("SCORING_COUNT_FAILED");
      return count ?? 0;
    },

    async listCandidateIds(mode, afterDealId, limit) {
      let query = supabase
        .from("deals")
        .select("id,deal_analyses!inner(recovery_score)")
        .eq("organization_id", organizationId)
        .eq("analysis_status", "completed");
      if (mode === "unscored") query = query.is("deal_analyses.recovery_score", null);
      if (afterDealId) query = query.gt("id", afterDealId);
      const { data, error } = await query.order("id", { ascending: true }).limit(Math.min(limit, SCORING_BATCH_LIMIT));
      if (error) throw new Error("SCORING_LIST_FAILED");
      return (data ?? []).map((row) => row.id).filter((id): id is string => typeof id === "string");
    },
  };
}

export async function scoreAuthorizedDeal(
  supabase: ServerSupabaseClient,
  organizationId: string,
  dealId: string,
  asOfDate = currentUtcDate(),
): Promise<SingleScoreResult> {
  return scoreDealWithStore(createSupabaseScoringStore(supabase, organizationId), dealId, asOfDate);
}

export async function scoreOrganizationAnalyses(
  supabase: ServerSupabaseClient,
  organizationId: string,
  mode: ScoreBatchMode,
  afterDealId: string | null,
  asOfDate = currentUtcDate(),
): Promise<ScoreBatchResult> {
  return scoreBatchWithStore(createSupabaseScoringStore(supabase, organizationId), mode, asOfDate, afterDealId);
}
