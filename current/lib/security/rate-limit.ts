import "server-only";

import { NextResponse } from "next/server";

import { getRateLimitDatabase } from "@/db";
import {
  checkRateLimit,
  type RateLimitAction,
  type RateLimitCounterStore,
  type RateLimitDecision,
  type RateLimitIncrement,
} from "@/lib/security/rate-limit-core";

type D1ResultRow = { request_count?: unknown };

const d1CounterStore: RateLimitCounterStore = {
  async increment(input: RateLimitIncrement): Promise<number> {
    const database = getRateLimitDatabase();
    const statements = [
      database.prepare(`
        INSERT INTO security_rate_limits (
          user_id, action, window_start, request_count, updated_at
        ) VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(user_id, action, window_start)
        DO UPDATE SET
          request_count = security_rate_limits.request_count + 1,
          updated_at = excluded.updated_at
        RETURNING request_count
      `).bind(input.userId, input.action, input.windowStart, input.updatedAt),
      database.prepare(`
        DELETE FROM security_rate_limits
        WHERE window_start < ?
      `).bind(input.pruneBefore),
    ];
    const [incrementResult] = await database.batch<D1ResultRow>(statements);
    const rawCount = incrementResult.results?.[0]?.request_count;
    const count = typeof rawCount === "number" ? rawCount : Number(rawCount);
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error("RATE_LIMIT_INCREMENT_FAILED");
    }
    return count;
  },
};

export async function enforceRateLimit(
  userId: string,
  action: RateLimitAction,
): Promise<RateLimitDecision> {
  return checkRateLimit(d1CounterStore, userId, action);
}

export function rateLimitResponse(decision: RateLimitDecision): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Please wait a moment and try again." },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": String(decision.retryAfterSeconds),
      },
    },
  );
}

export function rateLimitUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "This action is temporarily unavailable. Please try again." },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function enforceRateLimitOrRespond(
  userId: string,
  action: RateLimitAction,
): Promise<NextResponse | null> {
  try {
    const decision = await enforceRateLimit(userId, action);
    return decision.allowed ? null : rateLimitResponse(decision);
  } catch {
    return rateLimitUnavailableResponse();
  }
}
