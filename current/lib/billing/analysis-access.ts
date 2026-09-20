import type { BillingEnforcementMode } from "@/lib/billing/config";
import {
  hasPlanFeature,
  isFutureTrialPreviewEligible,
  type PlanCode,
} from "@/lib/billing/plans";

export const TRIAL_DEEP_ANALYSIS_LIMIT = 2;

export type AnalysisAccessState = "ACTIVE" | "LOCKED" | "BILLING_PENDING" | "INACTIVE";

export type AnalysisAccess = Readonly<{
  state: AnalysisAccessState;
  entitled: boolean;
  providerExecutionAllowed: boolean;
  trialPreviewEligible: boolean;
}>;

function verifiedCommercialStatus(planCode: PlanCode, status: string | null): boolean {
  if (planCode === "TRIAL") return status === "trialing";
  if (planCode === "PRO") return status === "active";
  return false;
}

export function resolveStandardAnalysisAccess(planCode: PlanCode): AnalysisAccess {
  const entitled = hasPlanFeature(planCode, "standardAnalysis");
  return {
    state: entitled ? "ACTIVE" : "INACTIVE",
    entitled,
    providerExecutionAllowed: entitled,
    trialPreviewEligible: false,
  };
}

/**
 * Deep Analysis remains provider-inactive for commercial Trial/Pro records in
 * SHADOW. Only INTERNAL can spend on Deep before verified billing activation.
 */
export function resolveDeepAnalysisAccess(
  planCode: PlanCode,
  subscriptionStatus: string | null,
  mode: BillingEnforcementMode,
): AnalysisAccess {
  const trialPreviewEligible = isFutureTrialPreviewEligible(planCode, "deepAnalysis");
  if (planCode === "INTERNAL") {
    return {
      state: "ACTIVE",
      entitled: true,
      providerExecutionAllowed: true,
      trialPreviewEligible: false,
    };
  }
  if (planCode === "STARTER") {
    return {
      state: "LOCKED",
      entitled: false,
      providerExecutionAllowed: false,
      trialPreviewEligible: false,
    };
  }
  if (planCode === "BUSINESS") {
    return {
      state: "INACTIVE",
      entitled: false,
      providerExecutionAllowed: false,
      trialPreviewEligible: false,
    };
  }

  const entitled = hasPlanFeature(planCode, "deepAnalysis") || trialPreviewEligible;
  const active = entitled
    && mode === "ENFORCED"
    && verifiedCommercialStatus(planCode, subscriptionStatus);
  return {
    state: active ? "ACTIVE" : "BILLING_PENDING",
    entitled,
    providerExecutionAllowed: active,
    trialPreviewEligible,
  };
}
