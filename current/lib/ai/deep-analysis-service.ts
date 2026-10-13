import "server-only";

import type { AnalysisErrorCode } from "@/lib/ai/errors";
import { DealAnalysisError } from "@/lib/ai/errors";
import {
  analyzeDeepDealWithStore,
  type DeepAnalysisPersistenceData,
  type DeepAnalysisResult,
  type DeepAnalysisStore,
  type ExistingDeepAnalysisState,
} from "@/lib/ai/deep-analysis-workflow";
import type { DeepAnalysisModelRunner } from "@/lib/ai/deep-analysis";
import { DeepAnalysisDetailsSchema } from "@/lib/ai/deep-analysis-schema";
import { DealAnalysisSchema } from "@/lib/ai/deal-analysis-schema";
import { runOpenAIDeepAnalysis } from "@/lib/ai/deep-openai-runner";
import {
  finalizeAuthorizedAnalysisUsage,
  isAnalysisRuntimeSchemaReady,
  normalizeStoredAnalysisUsage,
  persistAuthorizedAnalysis,
  transitionAuthorizedAnalysis,
  claimAnalysisRun,
  recoverAnalysisRun,
  failAnalysisRun,
} from "@/lib/ai/analysis-persistence";
import { reserveOrganizationUsage, releaseUnusedUsage, type UsageReservation } from "@/lib/billing/usage";
import { scoreAuthorizedDeal } from "@/lib/scoring/score-service";
import { createClient } from "@/lib/supabase/server";
import type { SourceDealRow } from "@/lib/ai/analysis-workflow";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

const CORE_FIELDS = "lost_reason,lost_reason_detail,buying_intent_score,confidence_score,evidence,positive_signals,negative_signals,recommended_action,recommended_timing,recommended_channel,follow_up_message,recovery_score,recovery_priority,score_explanation";
const DEEP_FIELDS = `${CORE_FIELDS},analysis_mode,analysis_schema_version,deep_analysis,deep_analyzed_at,analysis_usage_key,analysis_usage_status`;

function normalizeSourceDeal(value: unknown): SourceDealRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string"
    || typeof row.analysis_status !== "string"
    || typeof row.status !== "string"
    || (typeof row.deal_value !== "number" && typeof row.deal_value !== "string")
  ) return null;
  return {
    id: row.id,
    deal_value: row.deal_value,
    quote_date: typeof row.quote_date === "string" ? row.quote_date : null,
    service_type: typeof row.service_type === "string" ? row.service_type : null,
    status: row.status,
    sales_notes: typeof row.sales_notes === "string" ? row.sales_notes : null,
    transcript: typeof row.transcript === "string" ? row.transcript : null,
    analysis_status: row.analysis_status,
  };
}

function inspectDeep(value: unknown): ExistingDeepAnalysisState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const core = DealAnalysisSchema.safeParse({
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
  if (!core.success) {
    return { deepValid: false, scored: false, ...normalizeStoredAnalysisUsage(row) };
  }
  const deep = DeepAnalysisDetailsSchema.safeParse(row.deep_analysis);
  return {
    deepValid: row.analysis_mode === "DEEP"
      && row.analysis_schema_version === "deep-1.0"
      && typeof row.deep_analyzed_at === "string"
      && deep.success,
    scored: typeof row.recovery_score === "number"
      && typeof row.recovery_priority === "string"
      && typeof row.score_explanation === "string",
    ...normalizeStoredAnalysisUsage(row),
  };
}

export async function isDeepAnalysisSchemaReady(supabase: ServerSupabaseClient): Promise<boolean> {
  const [dealCheck, analysisCheck, runtimeReady] = await Promise.all([
    supabase.from("deals").select("requested_analysis_mode", { head: true }).limit(1),
    supabase.from("deal_analyses").select("analysis_mode,analysis_schema_version,deep_analysis,deep_analyzed_at", { head: true }).limit(1),
    isAnalysisRuntimeSchemaReady(supabase),
  ]);
  return !dealCheck.error && !analysisCheck.error && runtimeReady;
}

export function createSupabaseDeepAnalysisStore(
  supabase: ServerSupabaseClient,
  organizationId: string,
): DeepAnalysisStore {
  const claims = new Map<string, string>();
  const reservations = new Map<string, UsageReservation>();
  return {
    async fetch(dealId) {
      const { data, error } = await supabase
        .from("deals")
        .select("id,deal_value,quote_date,service_type,status,sales_notes,transcript,analysis_status")
        .eq("organization_id", organizationId)
        .eq("id", dealId)
        .maybeSingle();
      if (error) throw new DealAnalysisError("ANALYSIS_FAILED");
      return normalizeSourceDeal(data);
    },

    async inspectExisting(dealId) {
      const { data, error } = await supabase
        .from("deal_analyses")
        .select(DEEP_FIELDS)
        .eq("organization_id", organizationId)
        .eq("deal_id", dealId)
        .maybeSingle();
      if (error) throw new DealAnalysisError("ANALYSIS_FAILED");
      return inspectDeep(data);
    },

    async repairCompleted(dealId) {
      return transitionAuthorizedAnalysis(
        supabase,
        organizationId,
        dealId,
        "REPAIR_DEEP",
      );
    },

    async scoreCompleted(dealId) {
      return (await scoreAuthorizedDeal(supabase, organizationId, dealId)).status === "completed";
    },

    async reserveUsage(dealId, operationId) {
      const reservation = await reserveOrganizationUsage(
        supabase,
        organizationId,
        "AI_ANALYSES",
        1,
        `deep-analysis:${dealId}:${operationId}`,
      );
      const usageKey = `deep-analysis:${dealId}:${operationId}`;
      if (reservation.isNew) reservations.set(dealId, reservation);
      if (!reservation.allowed) await releaseUnusedUsage(supabase, organizationId, reservation);
      const reservable = reservation.mode === "OFF"
        || !reservation.isNew
        || (reservation.available && Boolean(reservation.reservationToken));
      return {
        available: reservable,
        allowed: reservation.allowed && reservable,
        isNew: reservation.isNew,
        requiresFinalization: reservation.mode !== "OFF",
        usageKey,
      };
    },

    async finalizeUsage(_dealId, usageKey) {
      return finalizeAuthorizedAnalysisUsage(supabase, organizationId, usageKey);
    },

    async claim(dealId) {
      const token = crypto.randomUUID();
      try {
        const claimed = await claimAnalysisRun(supabase, organizationId, dealId, "DEEP", token);
        if (claimed) claims.set(dealId, token);
        else if (reservations.has(dealId)) await releaseUnusedUsage(supabase, organizationId, reservations.get(dealId)!);
        return claimed;
      } catch {
        await failAnalysisRun(supabase, organizationId, dealId, token, "DEEP", "ANALYSIS_FAILED", null).catch(() => false);
        if (reservations.has(dealId)) await releaseUnusedUsage(supabase, organizationId, reservations.get(dealId)!);
        throw new DealAnalysisError("ANALYSIS_FAILED");
      }
    },
    async recoverInterrupted(dealId) { return recoverAnalysisRun(supabase, organizationId, dealId); },

    async persistAndComplete(dealId, persistence: DeepAnalysisPersistenceData) {
      return persistAuthorizedAnalysis(supabase, organizationId, dealId,
        { ...persistence, model_metadata: { ...persistence.model_metadata, runtime_claim_id: claims.get(dealId) } });
    },

    async fail(dealId, code: AnalysisErrorCode, diagnostic) {
      const token = claims.get(dealId);
      const failed = token && await failAnalysisRun(supabase, organizationId, dealId, token, "DEEP", code, diagnostic);
      const reservation = reservations.get(dealId);
      if (failed && reservation) await releaseUnusedUsage(supabase, organizationId, reservation);
    },
  };
}

export async function analyzeAuthorizedDeepDeal(
  supabase: ServerSupabaseClient,
  organizationId: string,
  dealId: string,
  operationId: string,
  rerun: boolean,
  runModel: DeepAnalysisModelRunner = runOpenAIDeepAnalysis,
): Promise<DeepAnalysisResult> {
  return analyzeDeepDealWithStore(
    createSupabaseDeepAnalysisStore(supabase, organizationId),
    dealId,
    operationId,
    rerun,
    runModel,
  );
}
