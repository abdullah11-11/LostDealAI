export const PLAN_CODES = ["INTERNAL", "TRIAL", "STARTER", "PRO", "BUSINESS"] as const;

export type PlanCode = (typeof PLAN_CODES)[number];

export const USAGE_METRICS = [
  "IMPORTED_DEALS",
  "AI_ANALYSES",
  "AI_MAPPING_REQUESTS",
  "AUTO_CONVERT_ROWS",
] as const;

export type UsageMetric = (typeof USAGE_METRICS)[number];

export const PLAN_FEATURES = [
  "standardAnalysis",
  "smartImport",
  "aiSmartMapping",
  "autoConvert",
  "deepAnalysis",
  "normalizedCsvExport",
  "dealIntelligence",
  "batchAnalysis",
  "connectedDataSource",
] as const;

export type PlanFeature = (typeof PLAN_FEATURES)[number];
export type PreviewablePlanFeature = "autoConvert" | "deepAnalysis";
export type PlanAvailability = "INTERNAL" | "TRIAL" | "AVAILABLE" | "COMING_SOON";

export const UNLIMITED = Object.freeze({ kind: "UNLIMITED" } as const);
export type Unlimited = typeof UNLIMITED;
export type UsageLimit = number | Unlimited;

export type PlanEntitlements = Readonly<{
  planCode: PlanCode;
  displayName: string;
  priceLabel: string | null;
  monthlyPriceUsd: number | null;
  positioning: string;
  availability: PlanAvailability;
  purchasable: boolean;
  /** Null means this non-purchasable plan has no active commercial usage schedule. */
  usage: Readonly<Record<UsageMetric, UsageLimit>> | null;
  features: Readonly<Record<PlanFeature, boolean>>;
  futureTrialPreviews: Readonly<Record<PreviewablePlanFeature, boolean>>;
}>;

const CURRENT_CORE_FEATURES = Object.freeze({
  standardAnalysis: true,
  smartImport: true,
  aiSmartMapping: true,
  autoConvert: false,
  deepAnalysis: false,
  normalizedCsvExport: true,
  dealIntelligence: true,
  batchAnalysis: true,
  connectedDataSource: false,
});

const PRO_FEATURES = Object.freeze({
  ...CURRENT_CORE_FEATURES,
  // Future server-authoritative entitlements only. Prompt 15.2 and Prompt 15.3
  // must still implement and explicitly gate the corresponding operations.
  autoConvert: true,
  deepAnalysis: true,
});

const NO_FUTURE_PREVIEWS = Object.freeze({ autoConvert: false, deepAnalysis: false });

export const PLAN_CATALOG: Readonly<Record<PlanCode, PlanEntitlements>> = Object.freeze({
  INTERNAL: Object.freeze({
    planCode: "INTERNAL",
    displayName: "Internal",
    priceLabel: null,
    monthlyPriceUsd: null,
    positioning: "Owner and internal use only.",
    availability: "INTERNAL",
    purchasable: false,
    usage: Object.freeze({
      IMPORTED_DEALS: UNLIMITED,
      AI_ANALYSES: UNLIMITED,
      AI_MAPPING_REQUESTS: UNLIMITED,
      AUTO_CONVERT_ROWS: UNLIMITED,
    }),
    features: PRO_FEATURES,
    futureTrialPreviews: NO_FUTURE_PREVIEWS,
  }),
  TRIAL: Object.freeze({
    planCode: "TRIAL",
    displayName: "Trial",
    priceLabel: "$0 / 14 days",
    monthlyPriceUsd: 0,
    positioning: "Try the LostDeal experience before subscribing.",
    availability: "TRIAL",
    purchasable: false,
    usage: Object.freeze({
      IMPORTED_DEALS: 50,
      AI_ANALYSES: 10,
      AI_MAPPING_REQUESTS: 3,
      AUTO_CONVERT_ROWS: 25,
    }),
    features: CURRENT_CORE_FEATURES,
    futureTrialPreviews: Object.freeze({ autoConvert: true, deepAnalysis: true }),
  }),
  STARTER: Object.freeze({
    planCode: "STARTER",
    displayName: "Starter",
    priceLabel: "$15/month",
    monthlyPriceUsd: 15,
    positioning: "Find the lost deals worth recovering.",
    availability: "AVAILABLE",
    purchasable: true,
    usage: Object.freeze({
      IMPORTED_DEALS: 250,
      AI_ANALYSES: 30,
      AI_MAPPING_REQUESTS: 3,
      AUTO_CONVERT_ROWS: 0,
    }),
    features: CURRENT_CORE_FEATURES,
    futureTrialPreviews: NO_FUTURE_PREVIEWS,
  }),
  PRO: Object.freeze({
    planCode: "PRO",
    displayName: "Pro",
    priceLabel: "$45/month",
    monthlyPriceUsd: 45,
    positioning: "Let AI prepare and deeply analyze your lost sales data.",
    availability: "AVAILABLE",
    purchasable: true,
    usage: Object.freeze({
      IMPORTED_DEALS: 1_500,
      AI_ANALYSES: 250,
      AI_MAPPING_REQUESTS: 30,
      AUTO_CONVERT_ROWS: 1_500,
    }),
    features: PRO_FEATURES,
    futureTrialPreviews: NO_FUTURE_PREVIEWS,
  }),
  BUSINESS: Object.freeze({
    planCode: "BUSINESS",
    displayName: "Business",
    priceLabel: "Coming Soon",
    monthlyPriceUsd: null,
    positioning: "Connect your business and continuously identify recoverable lost revenue.",
    availability: "COMING_SOON",
    purchasable: false,
    usage: null,
    features: PRO_FEATURES,
    futureTrialPreviews: NO_FUTURE_PREVIEWS,
  }),
});

export function isPlanCode(value: unknown): value is PlanCode {
  return typeof value === "string" && PLAN_CODES.includes(value as PlanCode);
}

export function isUsageMetric(value: unknown): value is UsageMetric {
  return typeof value === "string" && USAGE_METRICS.includes(value as UsageMetric);
}

export function isUnlimited(limit: UsageLimit): limit is Unlimited {
  return limit === UNLIMITED || (typeof limit === "object" && limit.kind === "UNLIMITED");
}

/** Unknown or database-corrupted plan codes fail closed instead of inheriting access. */
export function getEntitlements(planCode: unknown): PlanEntitlements | null {
  return isPlanCode(planCode) ? PLAN_CATALOG[planCode] : null;
}

export function hasPlanFeature(planCode: unknown, feature: PlanFeature): boolean {
  return getEntitlements(planCode)?.features[feature] === true;
}

export function isFutureTrialPreviewEligible(
  planCode: unknown,
  feature: PreviewablePlanFeature,
): boolean {
  return getEntitlements(planCode)?.futureTrialPreviews[feature] === true;
}

export function usageLimitFor(planCode: PlanCode, metric: UsageMetric): UsageLimit | null {
  return PLAN_CATALOG[planCode].usage?.[metric] ?? null;
}
