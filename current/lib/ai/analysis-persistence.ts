import "server-only";

import type { DealAnalysis } from "@/lib/ai/deal-analysis-schema";
import type { DeepAnalysisDetails } from "@/lib/ai/deep-analysis-schema";
import type { AnalysisDiagnosticCategory, AnalysisErrorCode } from "@/lib/ai/errors";
import { getBillingUsageAuthoritySecret } from "@/lib/billing/config";
import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type StoredAnalysisUsage = {
  usageKey: string | null;
  usageStatus: "LEGACY" | "PENDING" | "COMMITTED";
};

type AnalysisTransition =
  | "CLAIM_STANDARD"
  | "CLAIM_DEEP"
  | "REPAIR_STANDARD"
  | "REPAIR_DEEP"
  | "FAIL_STANDARD"
  | "FAIL_DEEP";

export type ProtectedAnalysisPersistence = DealAnalysis & {
  analysis_mode?: "STANDARD" | "DEEP";
  analysis_schema_version?: string;
  deep_analysis?: DeepAnalysisDetails | null;
  deep_analyzed_at?: string | null;
  model_metadata: Record<string, unknown>;
  analysis_usage_key: string | null;
  analysis_usage_status: "LEGACY" | "PENDING";
};

export function normalizeStoredAnalysisUsage(value: Record<string, unknown>): StoredAnalysisUsage {
  const usageStatus = value.analysis_usage_status;
  return {
    usageKey: typeof value.analysis_usage_key === "string" ? value.analysis_usage_key : null,
    usageStatus: usageStatus === "PENDING" || usageStatus === "COMMITTED" ? usageStatus : "LEGACY",
  };
}

export async function isAnalysisRuntimeSchemaReady(supabase: ServerSupabaseClient): Promise<boolean> {
  const [dealCheck, analysisCheck] = await Promise.all([
    supabase.from("deals").select("analysis_error_detail", { head: true }).limit(1),
    supabase.from("deal_analyses").select("analysis_usage_key,analysis_usage_status", { head: true }).limit(1),
  ]);
  return !dealCheck.error && !analysisCheck.error;
}

function authoritySecret(): string | null {
  return getBillingUsageAuthoritySecret();
}

export async function transitionAuthorizedAnalysis(
  supabase: ServerSupabaseClient,
  organizationId: string,
  dealId: string,
  transition: AnalysisTransition,
  errorCode: AnalysisErrorCode | null = null,
  diagnostic: AnalysisDiagnosticCategory | null = null,
): Promise<boolean> {
  const secret = authoritySecret();
  if (!secret) return false;
  const { data, error } = await supabase.rpc("transition_deal_analysis", {
    target_authority_secret: secret,
    target_organization_id: organizationId,
    target_deal_id: dealId,
    target_transition: transition,
    target_error_code: errorCode,
    target_error_detail: diagnostic,
  });
  return !error && data === true;
}

export async function persistAuthorizedAnalysis(
  supabase: ServerSupabaseClient,
  organizationId: string,
  dealId: string,
  persistence: ProtectedAnalysisPersistence,
): Promise<boolean> {
  const secret = authoritySecret();
  if (!secret) return false;
  const analysisMode = persistence.analysis_mode === "DEEP" ? "DEEP" : "STANDARD";
  const analysis: DealAnalysis = {
    lost_reason: persistence.lost_reason,
    lost_reason_detail: persistence.lost_reason_detail,
    buying_intent_score: persistence.buying_intent_score,
    confidence_score: persistence.confidence_score,
    evidence: persistence.evidence,
    positive_signals: persistence.positive_signals,
    negative_signals: persistence.negative_signals,
    recommended_action: persistence.recommended_action,
    recommended_timing: persistence.recommended_timing,
    recommended_channel: persistence.recommended_channel,
    follow_up_message: persistence.follow_up_message,
  };
  const { data, error } = await supabase.rpc("persist_deal_analysis", {
    target_authority_secret: secret,
    target_organization_id: organizationId,
    target_deal_id: dealId,
    target_analysis: analysis,
    target_analysis_mode: analysisMode,
    target_schema_version: persistence.analysis_schema_version ?? "standard-1.0",
    target_deep_analysis: persistence.deep_analysis ?? null,
    target_deep_analyzed_at: persistence.deep_analyzed_at ?? null,
    target_model_metadata: persistence.model_metadata,
    target_usage_key: persistence.analysis_usage_key,
    target_usage_required: persistence.analysis_usage_status === "PENDING",
  });
  return !error && data === true;
}

export async function finalizeAuthorizedAnalysisUsage(
  supabase: ServerSupabaseClient,
  organizationId: string,
  usageKey: string,
): Promise<boolean> {
  const secret = authoritySecret();
  if (!secret) return false;
  const { data, error } = await supabase.rpc("finalize_analysis_usage", {
    target_authority_secret: secret,
    target_organization_id: organizationId,
    target_metric: "AI_ANALYSES",
    target_idempotency_key: usageKey,
    target_committed_units: 1,
  });
  return !error && data === true;
}

export async function persistAuthorizedRecoveryScore(
  supabase: ServerSupabaseClient,
  organizationId: string,
  dealId: string,
  persistence: {
    recovery_score: number;
    recovery_priority: "HIGH" | "MEDIUM" | "LOW";
    score_explanation: string;
    model_metadata: Record<string, unknown>;
  },
): Promise<boolean> {
  const secret = authoritySecret();
  if (!secret) return false;
  const { data, error } = await supabase.rpc("persist_deal_recovery_score", {
    target_authority_secret: secret,
    target_organization_id: organizationId,
    target_deal_id: dealId,
    target_recovery_score: persistence.recovery_score,
    target_recovery_priority: persistence.recovery_priority,
    target_score_explanation: persistence.score_explanation,
    target_model_metadata: persistence.model_metadata,
  });
  return !error && data === true;
}
