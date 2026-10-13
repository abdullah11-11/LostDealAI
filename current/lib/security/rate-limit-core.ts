export const RATE_LIMITS = Object.freeze({
  profile_update: { limit: 6, windowSeconds: 10 * 60 },
  export_deals: { limit: 6, windowSeconds: 10 * 60 },
  billing_mutation: { limit: 6, windowSeconds: 10 * 60 },
  analyze_single: { limit: 8, windowSeconds: 10 * 60 },
  analyze_deep: { limit: 4, windowSeconds: 15 * 60 },
  analyze_batch: { limit: 2, windowSeconds: 15 * 60 },
  upload_validate: { limit: 20, windowSeconds: 10 * 60 },
  upload_import: { limit: 6, windowSeconds: 10 * 60 },
  upload_normalize: { limit: 12, windowSeconds: 10 * 60 },
  upload_ai_mapping: { limit: 6, windowSeconds: 10 * 60 },
  upload_auto_convert: { limit: 3, windowSeconds: 15 * 60 },
  upload_auto_convert_operation: { limit: 1, windowSeconds: 15 * 60 },
  score_single: { limit: 60, windowSeconds: 10 * 60 },
  score_batch: { limit: 40, windowSeconds: 10 * 60 },
  delete_deal: { limit: 10, windowSeconds: 10 * 60 },
  forgot_password: { limit: 5, windowSeconds: 15 * 60 },
});

export type RateLimitAction = keyof typeof RATE_LIMITS;

export type RateLimitIncrement = {
  userId: string;
  action: RateLimitAction;
  windowStart: number;
  updatedAt: number;
  pruneBefore: number;
};

export type RateLimitCounterStore = {
  increment(input: RateLimitIncrement): Promise<number>;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

/** Deterministic fixed-window policy; the backing increment must be atomic. */
export async function checkRateLimit(
  store: RateLimitCounterStore,
  userId: string,
  action: RateLimitAction,
  nowMs = Date.now(),
): Promise<RateLimitDecision> {
  const policy = RATE_LIMITS[action];
  const nowSeconds = Math.floor(nowMs / 1_000);
  const windowStart = Math.floor(nowSeconds / policy.windowSeconds) * policy.windowSeconds;
  const count = await store.increment({
    userId,
    action,
    windowStart,
    updatedAt: nowSeconds,
    pruneBefore: nowSeconds - 24 * 60 * 60,
  });

  return {
    allowed: count <= policy.limit,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - count),
    retryAfterSeconds: Math.max(1, windowStart + policy.windowSeconds - nowSeconds),
  };
}
