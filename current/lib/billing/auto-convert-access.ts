import type { BillingEnforcementMode } from "@/lib/billing/config";
import {
  hasPlanFeature,
  isFutureTrialPreviewEligible,
  type PlanCode,
} from "@/lib/billing/plans";

export type AutoConvertAccessState =
  | "ACTIVE"
  | "LOCKED"
  | "BILLING_PENDING"
  | "INACTIVE";

export type AutoConvertAccess = Readonly<{
  state: AutoConvertAccessState;
  entitled: boolean;
  providerExecutionAllowed: boolean;
  trialPreviewEligible: boolean;
}>;

function verifiedCommercialStatus(planCode: PlanCode, status: string | null): boolean {
  if (planCode === "TRIAL") return status === "trialing";
  if (planCode === "PRO") return status === "active";
  return false;
}

/**
 * Capability gating is intentionally independent of SHADOW quota behavior.
 * Before verified billing launches, only the existing INTERNAL owner workspace
 * may spend provider credit on Auto Convert.
 */
export function resolveAutoConvertAccess(
  planCode: PlanCode,
  subscriptionStatus: string | null,
  mode: BillingEnforcementMode,
): AutoConvertAccess {
  const trialPreviewEligible = isFutureTrialPreviewEligible(planCode, "autoConvert");
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

  const entitled = hasPlanFeature(planCode, "autoConvert") || trialPreviewEligible;
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
