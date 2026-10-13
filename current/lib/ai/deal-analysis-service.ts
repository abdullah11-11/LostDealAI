import "server-only";

import {
  analyzeDealWithStore,
  analyzePendingWithStore,
  type BatchAnalysisResult,
  type DealAnalysisStore,
  type ExistingAnalysisState,
  type SingleDealAnalysisResult,
  type SourceDealRow,
} from "@/lib/ai/analysis-workflow";
import type { AnalysisModelRunner } from "@/lib/ai/analyze-deal";
import { DealAnalysisSchema } from "@/lib/ai/deal-analysis-schema";
import { DealAnalysisError } from "@/lib/ai/errors";
import { runOpenAIAnalysis } from "@/lib/ai/openai-runner";
import {
  finalizeAuthorizedAnalysisUsage,
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

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

const EXISTING_ANALYSIS_FIELDS = "lost_reason,lost_reason_detail,buying_intent_score,confidence_score,evidence,positive_signals,negative_signals,recommended_action,recommended_timing,recommended_channel,follow_up_message,recovery_score,recovery_priority,score_explanation,analysis_usage_key,analysis_usage_status";

function validExistingAnalysis(value: unknown): ExistingAnalysisState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
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
  return parsed.success ? {
    valid: true,
    scored: typeof row.recovery_score === "number" && typeof row.recovery_priority === "string" && typeof row.score_explanation === "string",
    ...normalizeStoredAnalysisUsage(row),
  } : { valid: false, scored: false, ...normalizeStoredAnalysisUsage(row) };
}

function normalizeSourceDeal(value: unknown): SourceDealRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.analysis_status !== "string" ||
    typeof row.status !== "string" ||
    (typeof row.deal_value !== "number" && typeof row.deal_value !== "string")
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

export function createSupabaseAnalysisStore(
  supabase: ServerSupabaseClient,
  organizationId: string,
): DealAnalysisStore {
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
        .select(EXISTING_ANALYSIS_FIELDS)
        .eq("organization_id", organizationId)
        .eq("deal_id", dealId)
        .maybeSingle();
      if (error) throw new DealAnalysisError("ANALYSIS_FAILED");
      return validExistingAnalysis(data);
    },

    async repairCompleted(dealId) {
      return transitionAuthorizedAnalysis(
        supabase,
        organizationId,
        dealId,
        "REPAIR_STANDARD",
      );
    },

    async scoreCompleted(dealId) {
      const result = await scoreAuthorizedDeal(supabase, organizationId, dealId);
      return result.status === "completed";
    },

    async reserveUsage(dealId) {
      const reservation = await reserveOrganizationUsage(
        supabase,
        organizationId,
        "AI_ANALYSES",
        1,
        `analysis:${dealId}`,
      );
      const usageKey = `analysis:${dealId}`;
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
        const claimed = await claimAnalysisRun(supabase, organizationId, dealId, "STANDARD", token);
        if (claimed) claims.set(dealId, token);
        else if (reservations.has(dealId)) await releaseUnusedUsage(supabase, organizationId, reservations.get(dealId)!);
        return claimed;
      } catch {
        await failAnalysisRun(supabase, organizationId, dealId, token, "STANDARD", "ANALYSIS_FAILED", null).catch(() => false);
        if (reservations.has(dealId)) await releaseUnusedUsage(supabase, organizationId, reservations.get(dealId)!);
        throw new DealAnalysisError("ANALYSIS_FAILED");
      }
    },
    async recoverInterrupted(dealId) { return recoverAnalysisRun(supabase, organizationId, dealId); },

    async persistAndComplete(dealId, persistence) {
      return persistAuthorizedAnalysis(supabase, organizationId, dealId,
        { ...persistence, model_metadata: { ...persistence.model_metadata, runtime_claim_id: claims.get(dealId) } });
    },

    async fail(dealId, code, diagnostic) {
      const token = claims.get(dealId);
      const failed = token && await failAnalysisRun(supabase, organizationId, dealId, token, "STANDARD", code, diagnostic);
      const reservation = reservations.get(dealId);
      if (failed && reservation) await releaseUnusedUsage(supabase, organizationId, reservation);
    },

    async countPending() {
      const { count, error } = await supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("analysis_status", "pending");
      if (error) throw new DealAnalysisError("ANALYSIS_FAILED");
      return count ?? 0;
    },

    async listPending(limit) {
      const { data, error } = await supabase
        .from("deals")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("analysis_status", "pending")
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new DealAnalysisError("ANALYSIS_FAILED");
      return (data ?? []).map((row) => row.id).filter((id): id is string => typeof id === "string");
    },
  };
}

export async function analyzeAuthorizedDeal(
  supabase: ServerSupabaseClient,
  organizationId: string,
  dealId: string,
  runModel: AnalysisModelRunner = runOpenAIAnalysis,
): Promise<SingleDealAnalysisResult> {
  return analyzeDealWithStore(createSupabaseAnalysisStore(supabase, organizationId), dealId, runModel);
}

export async function analyzePendingDeals(
  supabase: ServerSupabaseClient,
  organizationId: string,
  runModel: AnalysisModelRunner = runOpenAIAnalysis,
): Promise<BatchAnalysisResult> {
  return analyzePendingWithStore(createSupabaseAnalysisStore(supabase, organizationId), runModel);
}
