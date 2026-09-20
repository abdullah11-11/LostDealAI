import { PLAN_CATALOG, type PlanCode, type UsageLimit, isUnlimited } from "@/lib/billing/plans";

export type PublicMarketingPlan = Readonly<{
  code: Extract<PlanCode, "STARTER" | "PRO">;
  name: string;
  price: string;
  monthlyPriceUsd: number;
  outcome: string;
  positioning: string;
  recommended: boolean;
  features: readonly string[];
  allowances: Readonly<{
    importedDeals: string;
    aiAnalyses: string;
    aiMappingRequests: string;
    autoConvertRows: string | null;
  }>;
}>;

function formatAllowance(limit: UsageLimit | null | undefined): string {
  if (limit === null || limit === undefined) return "Not included";
  return isUnlimited(limit) ? "Unlimited" : limit.toLocaleString("en-US");
}

function publicPlan(code: "STARTER" | "PRO"): PublicMarketingPlan {
  const plan = PLAN_CATALOG[code];
  if (plan.monthlyPriceUsd === null || !plan.usage) {
    throw new Error(`${code} is missing its public commercial definition.`);
  }

  const isPro = code === "PRO";
  return Object.freeze({
    code,
    name: plan.displayName,
    price: `$${plan.monthlyPriceUsd}`,
    monthlyPriceUsd: plan.monthlyPriceUsd,
    outcome: isPro ? "Automate preparation and go deeper." : "Understand and prioritize.",
    positioning: isPro
      ? "For teams with messy exports or larger lost-deal pipelines that want deeper recovery intelligence."
      : "For small teams that want to understand and prioritize lost opportunities.",
    recommended: isPro,
    features: Object.freeze(isPro
      ? [
          "Everything in Starter",
          "AI Auto Convert",
          "Deep Recovery Analysis",
        ]
      : [
          "Standard Analysis",
          "Recovery Score",
          "Smart Import",
          "Evidence-grounded recommendations",
        ]),
    allowances: Object.freeze({
      importedDeals: formatAllowance(plan.usage.IMPORTED_DEALS),
      aiAnalyses: formatAllowance(plan.usage.AI_ANALYSES),
      aiMappingRequests: formatAllowance(plan.usage.AI_MAPPING_REQUESTS),
      autoConvertRows: plan.features.autoConvert
        ? formatAllowance(plan.usage.AUTO_CONVERT_ROWS)
        : null,
    }),
  });
}

export const PUBLIC_MARKETING_PLANS = Object.freeze([
  publicPlan("STARTER"),
  publicPlan("PRO"),
] as const);
