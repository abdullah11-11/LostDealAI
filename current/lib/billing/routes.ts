import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";
import { validateMutationRequest, mutationIssueResponse } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getBillingUsageAuthoritySecret, getLiveBillingAuthoritySecret } from "@/lib/billing/config";
import { getOrganizationUsageSnapshot } from "@/lib/billing/usage";
import { paddleServer, boundedPaddleCall, verifyLiveProviderCatalog } from "@/lib/billing/paddle-server";
import { classifyPaddleFailure } from "@/lib/billing/paddle-errors";
import { planChangeRequest, safePortalUrl, resolvePaddleBoundary, validatePaddleClientToken } from "@/lib/billing/paddle-policy";
import { boundedBody, normalizePaddleEvent } from "@/supabase/functions/_shared/paddle";
import { assertLiveCatalogAuthority, normalizeLivePaddleEvent, normalizeLivePaymentTransaction } from "@/supabase/functions/_shared/paddle-live";
import { isPaddleProvider } from "@/lib/billing/provider";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const planSchema = z.object({ plan: z.enum(["STARTER", "PRO"]) }).strict();
const emptySchema = z.object({}).strict();
const paymentLinkSchema = z.object({ transactionId: z.string().regex(/^txn_[a-z0-9]{26}$/) }).strict();
const billingOperationSchema = z.object({ billing_operation_id: z.string().uuid().nullable() }).passthrough();
const reconciliationOutcomeSchema = z.enum([
  "APPLIED", "DUPLICATE_EVENT", "STALE_EVENT", "UNKNOWN_PRICE", "MISSING_CHECKOUT_INTENT",
  "EXPIRED_CHECKOUT_INTENT", "CONSUMED_CHECKOUT_INTENT", "PLAN_PRICE_MISMATCH",
  "SUBSCRIPTION_CONFLICT", "UNKNOWN_SUBSCRIPTION", "INTERNAL_WORKSPACE_BLOCKED", "INVALID_STATUS",
  "RECONCILE_CONFLICT", "FAILED",
]);
function logBillingReconciliation(stage: "request_started" | "provider_read_succeeded" | "rpc_invoked" | "outcome", outcome?: unknown) {
  const safeOutcome = outcome === undefined ? undefined : reconciliationOutcomeSchema.safeParse(outcome).data ?? "UNCLASSIFIED";
  console.info("billing_reconciliation", safeOutcome === undefined ? { stage } : { stage, outcome: safeOutcome });
}
export async function billingStatus() {
  const auth = await getAuthorizedRouteContext(); if (auth.response) return auth.response;
  const { supabase, organization } = auth.context;
  const snapshot = await getOrganizationUsageSnapshot(supabase, organization.id);
  const { data } = await supabase.from("organization_subscriptions")
    .select("provider,provider_period_end,provider_scheduled_action,provider_scheduled_at").eq("organization_id", organization.id).maybeSingle();
  let operationPending = false;
  if (organization.role === "owner") {
    const operation = await supabase.rpc("get_billing_subscription", { target_organization_id: organization.id });
    const parsed = billingOperationSchema.safeParse(operation.data);
    operationPending = parsed.success && parsed.data.billing_operation_id !== null;
  }
  return json({ plan: snapshot.plan?.planCode ?? null, status: snapshot.subscriptionStatus, usage: snapshot.usage,
    owner: organization.role === "owner", sandbox: data?.provider === "paddle_sandbox", paddle: isPaddleProvider(data?.provider),
    environment: data?.provider === "paddle_live" || (!data?.provider && process.env.PADDLE_ENVIRONMENT === "live") ? "live" : "sandbox", nextBillingAt: data?.provider_period_end ?? null,
    scheduledAction: data?.provider_scheduled_action ?? null, scheduledAt: data?.provider_scheduled_at ?? null, operationPending });
}

export async function billingMutation(request: Request, action: "checkout-intent" | "change-plan" | "portal" | "cancel" | "reconcile" | "payment-link") {
  const issue = validateMutationRequest(request, "json"); if (issue) return mutationIssueResponse(issue);
  const auth = await getAuthorizedRouteContext(); if (auth.response) return auth.response;
  const { supabase, organization, identity } = auth.context;
  if (organization.role !== "owner") return json({ error: "Only the workspace owner can manage billing." }, 403);
  const limit = await enforceRateLimitOrRespond(identity.id, "billing_mutation"); if (limit) return limit;
  let body: { plan?: "STARTER" | "PRO"; transactionId?: string };
  try { body = (action === "payment-link" ? paymentLinkSchema : action === "checkout-intent" || action === "change-plan" ? planSchema : emptySchema).parse(JSON.parse(await boundedBody(request, 1024))); }
  catch { return json({ error: "The billing request is invalid." }, 400); }
  if (action === "reconcile") logBillingReconciliation("request_started");
  let releaseOperation: (() => Promise<boolean>) | null = null;
  let operationTarget: "STARTER" | "PRO" | "cancel" | null = null;
  try {
    const boundary = resolvePaddleBoundary(process.env);
    const authority = boundary.environment === "live" ? getLiveBillingAuthoritySecret() : getBillingUsageAuthoritySecret();
    if (!authority) throw new Error("BILLING_CONFIGURATION_REQUIRED");
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(name, args);
      if (error) throw new Error("BILLING_STATE_REJECTED"); return data;
    };
    const s = await rpc("get_billing_subscription", { target_organization_id: organization.id });
    if (!s || s.plan_code === "INTERNAL") return json({ error: "This workspace does not use commercial billing." }, 409);
    const expectedProvider = boundary.environment === "sandbox" ? "paddle_sandbox" : "paddle_live";
    if (isPaddleProvider(s.provider) && s.provider !== expectedProvider) return json({ error: "This subscription belongs to a different billing environment." }, 409);
    if (boundary.environment === "live") {
      assertLiveCatalogAuthority(boundary.catalog, await rpc("get_live_billing_configuration", { target_authority_secret: authority }));
    }
    if (action === "payment-link") {
      if (boundary.environment !== "live" || process.env.PADDLE_CHECKOUT_ENABLED !== "true") throw new Error("BILLING_CONFIGURATION_REQUIRED");
      const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN; validatePaddleClientToken(token, "live");
      const paddle = paddleServer(boundary);
      const [, transaction] = await Promise.all([verifyLiveProviderCatalog(paddle, boundary), boundedPaddleCall(paddle.transactions.get(body.transactionId!))]);
      const verified = normalizeLivePaymentTransaction(transaction, body.transactionId!, boundary.catalog);
      if (await rpc("verify_live_billing_payment_link", { target_authority_secret: authority, target_organization_id: organization.id, target_transaction: verified }) !== true) throw new Error("PAYMENT_LINK_REJECTED");
      return json({ environment: "live", transactionId: body.transactionId, clientToken: token });
    }
    if (action === "checkout-intent") {
      // Checkout stays disabled until owner finishes the Edge secret checkpoint.
      if (process.env.PADDLE_CHECKOUT_ENABLED !== "true") return json({ error: boundary.environment === "sandbox" ? "Sandbox checkout setup is still in progress." : "Checkout setup is still in progress." }, 503);
      const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
      validatePaddleClientToken(token, boundary.environment);
      if (boundary.environment === "live") await verifyLiveProviderCatalog(paddleServer(boundary), boundary);
      const intent = await rpc(boundary.environment === "live" ? "create_live_billing_checkout_intent" : "create_billing_checkout_intent", { target_authority_secret: authority, target_organization_id: organization.id, target_plan: body.plan });
      return json({ ...intent, environment: boundary.environment, clientToken: token, email: identity.email });
    }
    if (s.provider !== expectedProvider || !s.provider_subscription_id || !s.provider_customer_id) return json({ error: "No synchronized subscription is available." }, 409);
    const paddle = paddleServer(boundary);
    if (action === "portal") {
      const portal = await boundedPaddleCall(paddle.customerPortalSessions.create(s.provider_customer_id, [s.provider_subscription_id]));
      const scoped = portal.urls.subscriptions.find(item => item.id === s.provider_subscription_id);
      if (!scoped) throw new Error("PORTAL_INVALID");
      return json({ url: safePortalUrl(scoped.updateSubscriptionPaymentMethod, boundary.environment) });
    }
    if (action === "reconcile") {
      const started = new Date().toISOString();
      const current = await boundedPaddleCall(paddle.subscriptions.get(s.provider_subscription_id));
      logBillingReconciliation("provider_read_succeeded");
      if (current.id !== s.provider_subscription_id || current.customerId !== s.provider_customer_id) throw new Error("BILLING_STATE_REJECTED");
      if (boundary.environment === "live") await verifyLiveProviderCatalog(paddle, boundary);
      const providerPayload = { event_id: `evt_${crypto.randomUUID().replaceAll("-", "").slice(0,26)}`, event_type: "subscription.updated", occurred_at: started, data: {
        id: current.id, customer_id: current.customerId, status: current.status,
        items: current.items.map(item => ({ quantity: item.quantity, price: { id: item.price.id } })),
        current_billing_period: current.currentBillingPeriod ? { starts_at: current.currentBillingPeriod.startsAt, ends_at: current.currentBillingPeriod.endsAt } : null,
        scheduled_change: current.scheduledChange ? { action: current.scheduledChange.action, effective_at: current.scheduledChange.effectiveAt } : null,
      } };
      const event = boundary.environment === "live" ? normalizeLivePaddleEvent(providerPayload, boundary.catalog) : normalizePaddleEvent(providerPayload);
      if (!event) throw new Error("BILLING_STATE_REJECTED");
      logBillingReconciliation("rpc_invoked");
      const result = boundary.environment === "live"
        ? await rpc("synchronize_paddle_live_subscription", { target_authority_secret: authority, target_event: { ...event, event_type: "reconciliation" }, target_expected_event_id: s.last_provider_event_id })
        : await rpc("synchronize_paddle_subscription", { target_authority_secret: authority, target_event: { ...event, event_type: "reconciliation" }, target_expected_event_id: s.last_provider_event_id });
      logBillingReconciliation("outcome", result);
      return json({ result });
    }
    if (action === "change-plan" && boundary.environment === "live") await verifyLiveProviderCatalog(paddle, boundary);
    const change = action === "change-plan" ? planChangeRequest(s.plan_code, body.plan!, boundary.prices) : null;
    operationTarget = action === "cancel" ? "cancel" : body.plan!;
    if (boundary.environment === "live") {
      const operationId = z.string().uuid().parse(await rpc("begin_live_billing_operation", {
        target_authority_secret: authority, target_organization_id: organization.id, target_plan: operationTarget,
      }));
      releaseOperation = async () => Boolean(await rpc("abort_live_billing_operation", {
        target_authority_secret: authority, target_organization_id: organization.id, target_operation_id: operationId,
      }));
    } else {
      const operationId = z.string().uuid().parse(await rpc("begin_billing_operation", {
        target_authority_secret: authority, target_organization_id: organization.id, target_plan: operationTarget,
      }));
      releaseOperation = async () => Boolean(await rpc("abort_billing_operation", {
        target_authority_secret: authority, target_organization_id: organization.id, target_operation_id: operationId,
      }));
    }
    if (change) await boundedPaddleCall(paddle.subscriptions.update(s.provider_subscription_id, change));
    else await boundedPaddleCall(paddle.subscriptions.cancel(s.provider_subscription_id, { effectiveFrom: "next_billing_period" }));
    return json({ result: "SYNC_PENDING" });
  } catch (error) {
    if (action === "reconcile") logBillingReconciliation("outcome", "FAILED");
    if (releaseOperation) {
      const failure = classifyPaddleFailure(error);
      let operationReleased = false;
      if (failure.definitiveRejection) {
        try { operationReleased = await releaseOperation(); } catch { operationReleased = false; }
      }
      console.warn("billing_provider_failure", {
        action, target: operationTarget, providerType: failure.providerType, providerCode: failure.providerCode,
        retryAfterSeconds: failure.retryAfterSeconds, definitiveRejection: failure.definitiveRejection, operationReleased,
      });
      return json({ error: failure.publicMessage, code: failure.publicCode }, failure.responseStatus);
    }
    return json({ error: "We couldn't complete this billing action. Check billing setup, or refresh billing status before retrying a plan change." }, 503);
  }
}
