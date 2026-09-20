import "server-only";

export const BILLING_ENFORCEMENT_MODES = ["OFF", "SHADOW", "ENFORCED"] as const;
export type BillingEnforcementMode = (typeof BILLING_ENFORCEMENT_MODES)[number];

/** Server-only rollout control. Browser input is never consulted. */
export function getBillingEnforcementMode(): BillingEnforcementMode {
  const configured = process.env.BILLING_ENFORCEMENT_MODE?.trim().toUpperCase();
  return BILLING_ENFORCEMENT_MODES.includes(configured as BillingEnforcementMode)
    ? configured as BillingEnforcementMode
    : "SHADOW";
}

/**
 * Authenticates server-originated usage mutations at the database boundary.
 * The matching SHA-256 verifier is stored in the forward migration; the
 * authority secret itself exists only in server runtime configuration.
 */
export function getBillingUsageAuthoritySecret(): string | null {
  const configured = process.env.BILLING_USAGE_AUTHORITY_SECRET?.trim();
  return configured && /^[0-9a-f]{64}$/i.test(configured) ? configured : null;
}
