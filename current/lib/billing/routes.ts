import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";
import { validateMutationRequest, mutationIssueResponse } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getBillingUsageAuthoritySecret } from "@/lib/billing/config";
import { getOrganizationUsageSnapshot } from "@/lib/billing/usage";
import { paddleServer, boundedPaddleCall } from "@/lib/billing/paddle-server";
import { planChangeRequest, safePortalUrl, validatePaddleConfig } from "@/lib/billing/paddle-policy";
import { boundedBody, normalizePaddleEvent } from "@/supabase/functions/_shared/paddle";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const planSchema = z.object({ plan: z.enum(["STARTER", "PRO"]) }).strict();
const emptySchema = z.object({}).strict();
export async function billingStatus() {
  const auth = await getAuthorizedRouteContext(); if (auth.response) return auth.response;
  const { supabase, organization } = auth.context;
  const snapshot = await getOrganizationUsageSnapshot(supabase, organization.id);
  const { data } = await supabase.from("organization_subscriptions")
    .select("provider,provider_period_end,provider_scheduled_action,provider_scheduled_at").eq("organization_id", organization.id).maybeSingle();
  return json({ plan: snapshot.plan?.planCode ?? null, status: snapshot.subscriptionStatus, usage: snapshot.usage,
    owner: organization.role === "owner", sandbox: data?.provider === "paddle_sandbox", nextBillingAt: data?.provider_period_end ?? null,
    scheduledAction: data?.provider_scheduled_action ?? null, scheduledAt: data?.provider_scheduled_at ?? null });
}

export async function billingMutation(request: Request, action: "checkout-intent" | "change-plan" | "portal" | "cancel" | "reconcile") {
  const issue = validateMutationRequest(request, "json"); if (issue) return mutationIssueResponse(issue);
  const auth = await getAuthorizedRouteContext(); if (auth.response) return auth.response;
  const { supabase, organization, identity } = auth.context;
  if (organization.role !== "owner") return json({ error: "Only the workspace owner can manage billing." }, 403);
  const limit = await enforceRateLimitOrRespond(identity.id, "billing_mutation"); if (limit) return limit;
  let body: { plan?: "STARTER" | "PRO" };
  try { body = (action === "checkout-intent" || action === "change-plan" ? planSchema : emptySchema).parse(JSON.parse(await boundedBody(request, 1024))); }
  catch { return json({ error: "The billing request is invalid." }, 400); }
  try {
    validatePaddleConfig(process.env);
    const authority = getBillingUsageAuthoritySecret(); if (!authority) throw new Error("BILLING_CONFIGURATION_REQUIRED");
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(name, args);
      if (error) throw new Error("BILLING_STATE_REJECTED"); return data;
    };
    const s = await rpc("get_billing_subscription", { target_organization_id: organization.id });
    if (!s || s.plan_code === "INTERNAL") return json({ error: "This workspace does not use commercial billing." }, 409);
    if (action === "checkout-intent") {
      // Checkout stays disabled until owner finishes the Edge secret checkpoint.
      if (process.env.PADDLE_CHECKOUT_ENABLED !== "true") return json({ error: "Sandbox checkout setup is still in progress." }, 503);
      const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
      if (!token?.startsWith("test_")) throw new Error("BILLING_CONFIGURATION_REQUIRED");
      const intent = await rpc("create_billing_checkout_intent", { target_authority_secret: authority, target_organization_id: organization.id, target_plan: body.plan });
      return json({ ...intent, clientToken: token, email: identity.email });
    }
    if (s.provider !== "paddle_sandbox" || !s.provider_subscription_id || !s.provider_customer_id) return json({ error: "No synchronized subscription is available." }, 409);
    const paddle = paddleServer();
    if (action === "portal") {
      const portal = await boundedPaddleCall(paddle.customerPortalSessions.create(s.provider_customer_id, [s.provider_subscription_id]));
      const scoped = portal.urls.subscriptions.find(item => item.id === s.provider_subscription_id);
      if (!scoped) throw new Error("PORTAL_INVALID");
      return json({ url: safePortalUrl(scoped.updateSubscriptionPaymentMethod) });
    }
    if (action === "reconcile") {
      const started = new Date().toISOString();
      const current = await boundedPaddleCall(paddle.subscriptions.get(s.provider_subscription_id));
      if (current.id !== s.provider_subscription_id || current.customerId !== s.provider_customer_id) throw new Error("BILLING_STATE_REJECTED");
      const event = normalizePaddleEvent({ event_id: `evt_${crypto.randomUUID().replaceAll("-", "").slice(0,26)}`, event_type: "subscription.updated", occurred_at: started, data: {
        id: current.id, customer_id: current.customerId, status: current.status,
        items: current.items.map(item => ({ quantity: item.quantity, price: { id: item.price.id } })),
        current_billing_period: current.currentBillingPeriod ? { starts_at: current.currentBillingPeriod.startsAt, ends_at: current.currentBillingPeriod.endsAt } : null,
        scheduled_change: current.scheduledChange ? { action: current.scheduledChange.action, effective_at: current.scheduledChange.effectiveAt } : null,
      } });
      if (!event) throw new Error("BILLING_STATE_REJECTED");
      const result = await rpc("synchronize_paddle_subscription", { target_authority_secret: authority, target_event: { ...event, event_type: "reconciliation" }, target_expected_event_id: s.last_provider_event_id });
      return json({ result });
    }
    const change = action === "change-plan" ? planChangeRequest(s.plan_code, body.plan!) : null;
    await rpc("begin_billing_operation", { target_authority_secret: authority, target_organization_id: organization.id, target_plan: action === "cancel" ? "cancel" : body.plan });
    if (change) await boundedPaddleCall(paddle.subscriptions.update(s.provider_subscription_id, change));
    else await boundedPaddleCall(paddle.subscriptions.cancel(s.provider_subscription_id, { effectiveFrom: "next_billing_period" }));
    return json({ result: "SYNC_PENDING" });
  } catch {
    return json({ error: "We couldn't complete this billing action. Check billing setup, or refresh billing status before retrying a plan change." }, 503);
  }
}
