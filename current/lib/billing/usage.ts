import "server-only";
import { isPaddleProvider } from "@/lib/billing/provider";

import {
  getBillingEnforcementMode,
  getBillingUsageAuthoritySecret,
  type BillingEnforcementMode,
} from "@/lib/billing/config";
import {
  getEntitlements,
  isUsageMetric,
  type PlanCode,
  type PlanEntitlements,
  type UsageMetric,
} from "@/lib/billing/plans";
import { expectedDatabaseLimit, rollingUsagePeriod, utcCalendarMonth } from "@/lib/billing/usage-core";
import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

type ReserveRpcRow = {
  reservation_token?: unknown;
  is_new?: unknown;
  allowed?: unknown;
  plan_code?: unknown;
  usage_limit?: unknown;
  period_start?: unknown;
  period_end?: unknown;
};

export type UsageReservation = Readonly<{
  available: boolean;
  allowed: boolean;
  wouldDeny: boolean;
  isNew: boolean;
  mode: BillingEnforcementMode;
  metric: UsageMetric;
  idempotencyKey: string;
  reservationToken: string | null;
  planCode: PlanCode | null;
  periodStart: string | null;
  periodEnd: string | null;
}>;

export type UsageLine = Readonly<{
  metric: UsageMetric;
  used: number;
  allowance: number | null;
  remaining: number | null;
}>;

export type UsageSnapshot = Readonly<{
  available: boolean;
  mode: BillingEnforcementMode;
  plan: PlanEntitlements | null;
  subscriptionStatus: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  usage: Readonly<Record<UsageMetric, UsageLine>> | null;
}>;

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function failSafeReservation(
  mode: BillingEnforcementMode,
  metric: UsageMetric,
  idempotencyKey: string,
): UsageReservation {
  return {
    available: false,
    allowed: mode !== "ENFORCED",
    wouldDeny: true,
    isNew: true,
    mode,
    metric,
    idempotencyKey,
    reservationToken: null,
    planCode: null,
    periodStart: null,
    periodEnd: null,
  };
}

/**
 * Atomically reserves organization usage through the RLS-aware Supabase RPC.
 * Provider-backed callers must not run unless this returns allowed + isNew.
 */
export async function reserveOrganizationUsage(
  supabase: ServerSupabaseClient,
  organizationId: string,
  metric: UsageMetric,
  units: number,
  idempotencyKey: string,
): Promise<UsageReservation> {
  const { data: billingState, error: billingError } = await supabase.from("organization_subscriptions")
    .select("provider,subscription_status").eq("organization_id", organizationId).maybeSingle();
  // Paddle-backed workspaces enforce the existing quotas even during SHADOW.
  // A failed authority read must never become permission to spend provider credit.
  const mode = isPaddleProvider(billingState?.provider) ? "ENFORCED" : getBillingEnforcementMode();
  if (billingError || !billingState) return failSafeReservation("ENFORCED", metric, idempotencyKey);
  if (isPaddleProvider(billingState.provider) && billingState.subscription_status !== "active") {
    return failSafeReservation("ENFORCED", metric, idempotencyKey);
  }
  if (mode === "OFF") {
    return {
      ...failSafeReservation(mode, metric, idempotencyKey),
      available: true,
      allowed: true,
      wouldDeny: false,
    };
  }

  const authoritySecret = getBillingUsageAuthoritySecret();
  if (!authoritySecret) return failSafeReservation(mode, metric, idempotencyKey);

  const { data, error } = await supabase.rpc("reserve_organization_usage", {
    target_authority_secret: authoritySecret,
    target_organization_id: organizationId,
    target_metric: metric,
    target_units: units,
    target_idempotency_key: idempotencyKey,
  });
  if (error || !Array.isArray(data) || data.length !== 1) {
    return failSafeReservation(mode, metric, idempotencyKey);
  }

  const row = data[0] as ReserveRpcRow;
  const plan = getEntitlements(row.plan_code);
  if (!plan || typeof row.is_new !== "boolean" || typeof row.allowed !== "boolean") {
    return failSafeReservation(mode, metric, idempotencyKey);
  }
  const databaseLimit = row.usage_limit === null ? null : numberValue(row.usage_limit);
  const expectedLimit = expectedDatabaseLimit(plan, metric);
  if (expectedLimit === undefined || databaseLimit !== expectedLimit) {
    return failSafeReservation(mode, metric, idempotencyKey);
  }

  const databaseAllowed = row.allowed;
  return {
    available: true,
    allowed: mode === "ENFORCED" ? databaseAllowed : true,
    wouldDeny: !databaseAllowed,
    isNew: row.is_new,
    mode,
    metric,
    idempotencyKey,
    reservationToken: stringValue(row.reservation_token),
    planCode: plan.planCode,
    periodStart: stringValue(row.period_start),
    periodEnd: stringValue(row.period_end),
  };
}

export async function commitOrganizationUsage(
  supabase: ServerSupabaseClient,
  organizationId: string,
  reservation: UsageReservation,
  committedUnits: number,
): Promise<boolean> {
  if (!reservation.available || !reservation.reservationToken || !reservation.isNew) return false;
  const authoritySecret = getBillingUsageAuthoritySecret();
  if (!authoritySecret) return false;
  const { data, error } = await supabase.rpc("commit_organization_usage", {
    target_authority_secret: authoritySecret,
    target_organization_id: organizationId,
    target_metric: reservation.metric,
    target_idempotency_key: reservation.idempotencyKey,
    target_reservation_token: reservation.reservationToken,
    target_committed_units: committedUnits,
  });
  return !error && data === true;
}

/** Releases only this caller's unused reservation, never committed usage. */
export async function releaseUnusedUsage(supabase: ServerSupabaseClient, organizationId: string, reservation: UsageReservation): Promise<boolean> {
  const authoritySecret = getBillingUsageAuthoritySecret();
  if (!authoritySecret || !reservation.reservationToken) return false;
  try {
    const { data, error } = await supabase.rpc("release_unused_usage", {
      target_authority_secret: authoritySecret, target_organization_id: organizationId,
      target_metric: reservation.metric, target_idempotency_key: reservation.idempotencyKey,
      target_reservation_token: reservation.reservationToken,
    });
    return !error && data === true;
  } catch { return false; }
}

function normalizeSubscription(value: unknown): {
  plan: PlanEntitlements;
  status: string;
  periodStart: string;
  periodEnd: string;
} | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const plan = getEntitlements(row.plan_code);
  const status = stringValue(row.subscription_status);
  const storedStart = stringValue(row.current_period_start);
  const storedEnd = stringValue(row.current_period_end);
  if (!plan || !status || !storedStart || !storedEnd) return null;
  const period = plan.planCode === "INTERNAL"
    ? utcCalendarMonth(new Date())
    : isPaddleProvider(row.provider) && ["STARTER", "PRO"].includes(plan.planCode)
      ? rollingUsagePeriod(storedStart, storedEnd, new Date())
      : { start: storedStart, end: storedEnd };
  return { plan, status, periodStart: period.start, periodEnd: period.end };
}

export async function getOrganizationUsageSnapshot(
  supabase: ServerSupabaseClient,
  organizationId: string,
): Promise<UsageSnapshot> {
  let mode = getBillingEnforcementMode();
  const { data: subscription, error: subscriptionError } = await supabase
    .from("organization_subscriptions")
    .select("plan_code,subscription_status,current_period_start,current_period_end,trial_ends_at,cancel_at_period_end,provider")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (isPaddleProvider(subscription?.provider)) mode = "ENFORCED";
  const normalized = normalizeSubscription(subscription);
  if (subscriptionError || !normalized) {
    return {
      available: false,
      mode,
      plan: null,
      subscriptionStatus: null,
      periodStart: null,
      periodEnd: null,
      usage: null,
    };
  }

  const { data: usageRows, error: usageError } = await supabase.rpc(
    "get_organization_usage",
    { target_organization_id: organizationId },
  );
  if (usageError || !Array.isArray(usageRows)) {
    return {
      available: false,
      mode,
      plan: normalized.plan,
      subscriptionStatus: normalized.status,
      periodStart: normalized.periodStart,
      periodEnd: normalized.periodEnd,
      usage: null,
    };
  }

  const totals: Record<UsageMetric, number> = {
    IMPORTED_DEALS: 0,
    AI_ANALYSES: 0,
    AI_MAPPING_REQUESTS: 0,
    AUTO_CONVERT_ROWS: 0,
  };
  for (const row of usageRows) {
    const metric: unknown = row?.metric;
    if (!row || !isUsageMetric(metric)) continue;
    const units = numberValue(row.committed_usage);
    if (units !== null) totals[metric] += units;
  }

  const line = (metric: UsageMetric): UsageLine => {
    const allowance = expectedDatabaseLimit(normalized.plan, metric);
    if (allowance === undefined) throw new Error("USAGE_SCHEDULE_INACTIVE");
    return {
      metric,
      used: totals[metric],
      allowance,
      remaining: allowance === null ? null : Math.max(0, allowance - totals[metric]),
    };
  };
  if (!normalized.plan.usage) {
    return {
      available: true,
      mode,
      plan: normalized.plan,
      subscriptionStatus: normalized.status,
      periodStart: normalized.periodStart,
      periodEnd: normalized.periodEnd,
      usage: null,
    };
  }

  return {
    available: true,
    mode,
    plan: normalized.plan,
    subscriptionStatus: normalized.status,
    periodStart: normalized.periodStart,
    periodEnd: normalized.periodEnd,
    usage: {
      IMPORTED_DEALS: line("IMPORTED_DEALS"),
      AI_ANALYSES: line("AI_ANALYSES"),
      AI_MAPPING_REQUESTS: line("AI_MAPPING_REQUESTS"),
      AUTO_CONVERT_ROWS: line("AUTO_CONVERT_ROWS"),
    },
  };
}
