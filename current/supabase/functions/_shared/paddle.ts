// Portable, dependency-free Paddle boundary. Shared by the Edge receiver and
// explicit server reconciliation; this module contains no entitlement rules.
export const PADDLE_PRICES = Object.freeze({
  STARTER: "pri_01m2mqgrjazqnz7wyex9p7dyt8",
  PRO: "pri_01m2mqs3q7f9r0kyqzmrt6gkgg",
});
export type PaidPlan = keyof typeof PADDLE_PRICES;
export const PADDLE_EVENTS = ["subscription.created", "subscription.updated", "subscription.activated", "subscription.past_due", "subscription.paused", "subscription.resumed", "subscription.canceled"] as const;
export type BillingEvent = {
  event_id: string; event_type: string; occurred_at: string;
  subscription_id: string; customer_id: string; price_id: string;
  status: string; intent_id: string | null;
  period_start: string | null; period_end: string | null;
  scheduled_action: string | null; scheduled_at: string | null;
};
export class BillingError extends Error {}
const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BillingError("INVALID_EVENT");
  return v as Record<string, unknown>;
};
function id(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(value)) throw new BillingError("INVALID_EVENT");
  return value;
}
function date(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new BillingError("INVALID_EVENT");
  // Preserve provider microseconds for PostgreSQL ordering; JS ISO conversion
  // would silently truncate them to milliseconds.
  return value;
}
export function normalizePaddleEvent(value: unknown): BillingEvent | null {
  const e = record(value);
  if (!PADDLE_EVENTS.includes(e.event_type as typeof PADDLE_EVENTS[number])) return null;
  const d = record(e.data);
  if (!Array.isArray(d.items) || d.items.length !== 1) throw new BillingError("UNKNOWN_PRICE");
  const item = record(d.items[0]);
  const price = record(item.price);
  if (item.quantity !== 1 || !Object.values(PADDLE_PRICES).includes(price.id as typeof PADDLE_PRICES[PaidPlan])) throw new BillingError("UNKNOWN_PRICE");
  if (!["active", "past_due", "paused", "canceled", "trialing"].includes(String(d.status))) throw new BillingError("INVALID_STATUS");
  const period = d.current_billing_period == null ? null : record(d.current_billing_period);
  const change = d.scheduled_change == null ? null : record(d.scheduled_change);
  if (change && !["cancel", "pause", "resume"].includes(String(change.action))) throw new BillingError("INVALID_EVENT");
  const custom = d.custom_data == null ? null : record(d.custom_data);
  const intent = custom?.lostdeal_checkout_intent_id;
  if (intent != null && (typeof intent !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(intent))) throw new BillingError("MISSING_CHECKOUT_INTENT");
  const result: BillingEvent = {
    event_id: id(e.event_id, "evt"), event_type: String(e.event_type), occurred_at: date(e.occurred_at),
    subscription_id: id(d.id, "sub"), customer_id: id(d.customer_id, "ctm"), price_id: String(price.id), status: String(d.status),
    intent_id: typeof intent === "string" ? intent : null,
    period_start: period ? date(period.starts_at) : null, period_end: period ? date(period.ends_at) : null,
    scheduled_action: change ? String(change.action) : null, scheduled_at: change ? date(change.effective_at) : null,
  };
  if (result.status === "active" && (!period || Date.parse(result.period_end!) <= Date.parse(result.period_start!))) throw new BillingError("INVALID_EVENT");
  return result;
}

// Web Crypto's HMAC verify performs the constant-time comparison. Paddle signs
// the ORIGINAL bytes as timestamp + ':' + body. Multiple h1 values allow rotation.
export async function verifyPaddleSignature(raw: string, header: string, secret: string, now = Date.now()): Promise<boolean> {
  if (!secret || header.length > 2048) return false;
  const parts = header.split(";").map(p => p.trim().split("="));
  const timestamps = parts.filter(p => p[0] === "ts");
  if (timestamps.length !== 1 || !/^\d{10}$/.test(timestamps[0][1] ?? "")) return false;
  const ts = timestamps[0][1];
  if (Math.abs(now / 1000 - Number(ts)) > 5) return false;
  const signatures = parts.filter(p => p[0] === "h1" && /^[a-f0-9]{64}$/i.test(p[1] ?? ""));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const payload = new TextEncoder().encode(`${ts}:${raw}`);
  for (const [, hex] of signatures) {
    const bytes = Uint8Array.from(hex.match(/../g)!, v => parseInt(v, 16));
    if (await crypto.subtle.verify("HMAC", key, bytes, payload)) return true;
  }
  return false;
}

export async function boundedBody(request: Request, maximum = 262144): Promise<string> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new BillingError("BODY_TOO_LARGE");
  if (!request.body) throw new BillingError("INVALID_EVENT");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.length;
      if (total > maximum) { await reader.cancel(); throw new BillingError("BODY_TOO_LARGE"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function createWebhookHandler(options: {
  environment: () => string | undefined; secret: () => string | undefined;
  synchronize: (event: BillingEvent) => Promise<string>;
}) {
  return async (request: Request): Promise<Response> => {
    const response = (status: number, result: string) => Response.json({ result }, { status, headers: { "Cache-Control": "no-store" } });
    if (request.method !== "POST") return response(405, "METHOD_NOT_ALLOWED");
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return response(415, "CONTENT_TYPE_INVALID");
    const signature = request.headers.get("Paddle-Signature");
    if (!signature) return response(400, "INVALID_SIGNATURE");
    const secret = options.secret();
    if (options.environment() !== "sandbox" || !secret) return response(503, "BILLING_CONFIGURATION_REQUIRED");
    let raw: string;
    try { raw = await boundedBody(request); } catch { return response(413, "BODY_INVALID"); }
    if (!await verifyPaddleSignature(raw, signature, secret)) return response(400, "INVALID_SIGNATURE");
    let event: BillingEvent | null;
    try { event = normalizePaddleEvent(JSON.parse(raw)); }
    catch (error) { return response(400, error instanceof BillingError ? error.message : "INVALID_EVENT"); }
    if (!event) return response(200, "IGNORED_EVENT");
    try { return response(200, await options.synchronize(event)); }
    catch { return response(503, "DATABASE_FAILURE"); }
  };
}
