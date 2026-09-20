import type { BillingEnforcementMode } from "@/lib/billing/config";
import {
  isUnlimited,
  type PlanEntitlements,
  type UsageLimit,
  type UsageMetric,
} from "@/lib/billing/plans";

export type UsageDecision = Readonly<{
  allowed: boolean;
  wouldDeny: boolean;
  remaining: number | null;
}>;

export function decideUsage(
  limit: UsageLimit,
  committed: number,
  reserved: number,
  requested: number,
  mode: BillingEnforcementMode,
): UsageDecision {
  if (![committed, reserved].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return { allowed: mode !== "ENFORCED", wouldDeny: true, remaining: 0 };
  }
  if (!Number.isSafeInteger(requested) || requested < 1) {
    return { allowed: false, wouldDeny: true, remaining: 0 };
  }
  if (isUnlimited(limit)) return { allowed: true, wouldDeny: false, remaining: null };

  const remaining = Math.max(0, limit - committed - reserved);
  const withinLimit = requested <= remaining;
  return {
    allowed: mode === "ENFORCED" ? withinLimit : true,
    wouldDeny: !withinLimit,
    remaining,
  };
}

export function expectedDatabaseLimit(
  entitlements: PlanEntitlements,
  metric: UsageMetric,
): number | null | undefined {
  const limit = entitlements.usage?.[metric];
  if (limit === undefined) return undefined;
  return isUnlimited(limit) ? null : limit;
}

export function utcCalendarMonth(now: Date): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Match PostgreSQL interval '1 month', including month-end clamping. */
export function rollingUsagePeriod(start: string, end: string, now: Date): { start: string; end: string } {
  let lower = new Date(start);
  let upper = new Date(end);
  if (!Number.isFinite(lower.getTime()) || !Number.isFinite(upper.getTime()) || upper <= lower) {
    throw new Error("INVALID_USAGE_PERIOD");
  }
  while (upper <= now) {
    lower = upper;
    const next = new Date(upper);
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
    upper = next;
  }
  return { start: lower.toISOString(), end: upper.toISOString() };
}
