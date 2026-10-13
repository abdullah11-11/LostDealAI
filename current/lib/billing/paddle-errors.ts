import { ApiError } from "@paddle/paddle-node-sdk";

const SAFE_PROVIDER_TOKEN = /^[a-z0-9_]{1,96}$/;
const IMMEDIATE_CHARGE_LIMITS = new Set([
  "subscription_immediate_charge_hour_limit_exceeded",
  "subscription_immediate_charge_24_hour_limit_exceeded",
]);

export type PaddleFailure = {
  definitiveRejection: boolean;
  providerType: string;
  providerCode: string;
  retryAfterSeconds: number | null;
  publicCode: "BILLING_CHANGE_REJECTED" | "BILLING_CHANGE_RATE_LIMITED" | "BILLING_OUTCOME_UNCONFIRMED";
  publicMessage: string;
  responseStatus: 409 | 503;
};

function safeProviderToken(value: unknown): string {
  return typeof value === "string" && SAFE_PROVIDER_TOKEN.test(value) ? value : "unclassified";
}

export function classifyPaddleFailure(error: unknown): PaddleFailure {
  if (error instanceof ApiError) {
    const providerType = safeProviderToken(error.type);
    const providerCode = safeProviderToken(error.code);
    const definitiveRejection = providerType === "request_error";
    const rateLimited = definitiveRejection && IMMEDIATE_CHARGE_LIMITS.has(providerCode);
    return {
      definitiveRejection,
      providerType,
      providerCode,
      retryAfterSeconds: Number.isSafeInteger(error.retryAfter) && Number(error.retryAfter) >= 0 ? error.retryAfter : null,
      publicCode: rateLimited ? "BILLING_CHANGE_RATE_LIMITED" : definitiveRejection ? "BILLING_CHANGE_REJECTED" : "BILLING_OUTCOME_UNCONFIRMED",
      publicMessage: rateLimited
        ? "Paddle did not apply this plan change because the subscription reached a temporary immediate-charge limit. Your current plan is unchanged. Refresh billing status before making another plan change."
        : definitiveRejection
          ? "Paddle did not apply this billing change. Your current plan is unchanged. Refresh billing status before making another plan change."
          : "The result of this billing request could not be confirmed. Do not retry it. Wait two minutes, then refresh billing status.",
      responseStatus: definitiveRejection ? 409 : 503,
    };
  }
  return {
    definitiveRejection: false,
    providerType: "unclassified",
    providerCode: error instanceof Error && error.message === "PADDLE_TIMEOUT" ? "paddle_timeout" : "unclassified",
    retryAfterSeconds: null,
    publicCode: "BILLING_OUTCOME_UNCONFIRMED",
    publicMessage: "The result of this billing request could not be confirmed. Do not retry it. Wait two minutes, then refresh billing status.",
    responseStatus: 503,
  };
}
