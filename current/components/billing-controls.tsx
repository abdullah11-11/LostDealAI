"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Paddle } from "@paddle/paddle-js";
import { Dialog } from "@/components/dialog";
import { UpgradeProReview } from "@/components/upgrade-pro-review";
import { canSelectBillingPlan, canCancelBillingPlan } from "@/lib/billing/presentation";
import { PLAN_CATALOG } from "@/lib/billing/plans";
import { Check, ArrowUpRight, CreditCard, ShieldCheck } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { isPaidPlan, validatePaddleClientToken, type PaidPlan } from "@/lib/billing/paddle-policy";
import type { PaddleEnvironment } from "@/supabase/functions/_shared/paddle-live";
import { assertPaddleInitializationSearch, bootstrapPaymentLink, getPaymentLinkTransaction, PAYMENT_LINK_UNAVAILABLE } from "@/lib/billing/payment-link";

type State = { plan: string | null; status: string | null; owner: boolean; sandbox: boolean; paddle?: boolean; environment?: PaddleEnvironment; nextBillingAt: string | null; scheduledAction: string | null; scheduledAt: string | null; operationPending: boolean };
let paddlePromise: Promise<Paddle | undefined> | null = null;
let paddleIdentity: string | null = null;
let paddleInitializationSearch: string | null = null;
const checkoutListeners = new Set<(event: "completed" | "closed") => void>();
async function getPaddle(token: string, environment: PaddleEnvironment, approvedPaymentSearch?: string) {
  assertPaddleInitializationSearch(window.location.search, approvedPaymentSearch);
  validatePaddleClientToken(token, environment);
  const identity = `${environment}:${token}`;
  if (paddleIdentity && paddleIdentity !== identity) throw new Error("Billing configuration changed. Reload this page before starting checkout.");
  if (paddlePromise && approvedPaymentSearch !== undefined && paddleInitializationSearch !== approvedPaymentSearch) throw new Error(PAYMENT_LINK_UNAVAILABLE);
  if (!paddlePromise) { paddleIdentity = identity; paddlePromise = import("@paddle/paddle-js").then(({ initializePaddle }) => {
    assertPaddleInitializationSearch(window.location.search, approvedPaymentSearch);
    paddleInitializationSearch = window.location.search;
    return initializePaddle({
    // The pinned wrapper reads these again after its asynchronous CDN load.
    // Bind that final read too, before its underlying Paddle.Initialize call.
    get environment() { assertPaddleInitializationSearch(window.location.search, approvedPaymentSearch); return environment === "live" ? "production" as const : "sandbox" as const; },
    get token() { assertPaddleInitializationSearch(window.location.search, approvedPaymentSearch); return token; },
    checkout: { settings: { displayMode: "overlay", allowLogout: false } },
    eventCallback: event => { if (event.name === "checkout.completed") checkoutListeners.forEach(listener => listener("completed")); if (event.name === "checkout.closed") checkoutListeners.forEach(listener => listener("closed")); },
    });
  }).catch(error => { paddlePromise = null; throw error; }); }
  return paddlePromise;
}
const dateLabel = (s: string) => Number.isFinite(Date.parse(s)) ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(s)) : "Date unavailable";
export function BillingControls({ intendedPlan }: { intendedPlan?: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<PaidPlan | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const paymentLinkStarted = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    const r = await fetch("/api/billing/status", { cache: "no-store" });
    if (!r.ok) throw new Error("Billing status is temporarily unavailable.");
    const data: State = await r.json(); if (mounted.current) setState(data); return data;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh().then(async data => {
      if (!mounted.current) return;
      const search = window.location.search;
      if (!getPaymentLinkTransaction(search)) return;
      if (!data.owner || data.environment !== "live") throw new Error(PAYMENT_LINK_UNAVAILABLE);
      if (paymentLinkStarted.current === search) return;
      paymentLinkStarted.current = search;
      const opened = await bootstrapPaymentLink(search, { fetch,
        initialize: async (token, environment) => {
          if (!mounted.current || window.location.search !== search) return;
          checkoutListeners.clear();
          checkoutListeners.add(event => {
            if (!mounted.current) return;
            if (event === "completed") {
              setMessage("Payment submitted. Billing will confirm any account update.");
              void refresh().catch(() => { if (mounted.current) setMessage("Billing status is temporarily unavailable."); });
            } else setMessage("Checkout closed. No account change is assumed.");
          });
          return getPaddle(token, environment, search);
        },
      });
      if (opened && mounted.current) setMessage("Secure payment details are open with Paddle. Account updates require billing confirmation.");
    }).catch(error => { if (mounted.current) setMessage(error instanceof Error && error.message === PAYMENT_LINK_UNAVAILABLE ? PAYMENT_LINK_UNAVAILABLE : "Billing status is temporarily unavailable."); });
    return () => { mounted.current = false; checkoutListeners.clear(); if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);
  const poll = (target: PaidPlan | "cancel", attempt = 0) => {
    void refresh().then(data => {
      if (!mounted.current) return;
      if (target === "cancel" ? data.scheduledAction === "cancel" : (data.paddle ?? data.sandbox) && data.status === "active" && data.plan === target) {
        setMessage("Your plan change is confirmed. Reload this page to see updated allowances."); setBusy(false); return;
      }
      if (attempt >= 14) { setMessage("Your plan is still being confirmed. Your saved data is safe. Check billing status before trying again."); setBusy(false); return; }
      timer.current = setTimeout(() => poll(target, attempt + 1), 2000);
    }).catch(() => { if (mounted.current) { setBusy(false); setMessage("Billing is still syncing. Verify billing status before retrying."); } });
  };
  async function act(action: string, plan?: PaidPlan) {
    if (busy) return;
    setSelectedPlan(null); setCancelOpen(false);
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/billing/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan ? { plan } : {}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Billing is temporarily unavailable.");
      if (action === "checkout-intent") {
        if (data.environment !== "sandbox" && data.environment !== "live") throw new Error("Billing is temporarily unavailable.");
        const paddle = await getPaddle(data.clientToken, data.environment); if (!paddle) throw new Error("We couldn't start checkout.");
        checkoutListeners.clear();
        let completed = false;
        checkoutListeners.add(event => {
          if (!mounted.current) return;
          if (event === "completed") { completed = true; setBusy(true); setMessage("Checkout completed. Confirming your plan…"); poll(plan!); }
          else if (!completed) { setBusy(false); setMessage("Checkout closed. No plan change is assumed. You can try again when you’re ready."); }
        });
        if (!mounted.current) return;
        paddle.Checkout.open({ items: [{ priceId: data.priceId, quantity: 1 }], customData: { lostdeal_checkout_intent_id: data.intentId },
          customer: data.email ? { email: data.email } : undefined, settings: { displayMode: "overlay", allowLogout: false } });
        setMessage("Secure checkout is open. Your plan will update after billing confirms activation.");
      } else if (action === "portal") { window.location.assign(data.url); }
      else if (action === "reconcile") { await refresh(); setMessage(data.result === "APPLIED" ? "Billing status verified." : "Billing has a pending update. Wait two minutes, then verify billing status again."); setBusy(false); }
      else { setMessage("Your change is syncing with billing…"); poll(plan ?? "cancel"); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Billing is temporarily unavailable."); setBusy(false); }
  }
  if (state?.plan === "INTERNAL" || state?.plan === "BUSINESS") return null;
  const synchronized = state ? state.paddle ?? state.sandbox : false;
  const paid = synchronized && state?.status !== "canceled";
  const sandbox = state?.environment !== "live";
  const options: PaidPlan[] = isPaidPlan(intendedPlan) ? [intendedPlan, intendedPlan === "PRO" ? "STARTER" : "PRO"] : ["STARTER", "PRO"];
  const selected = selectedPlan ? PLAN_CATALOG[selectedPlan] : null;
  return <>
    <Card className="mt-6 overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-line p-5 sm:p-6"><div><h2 className="text-lg font-semibold text-content">Manage your plan</h2><p className="mt-1 text-sm text-secondary">Monthly subscriptions · USD{state ? sandbox ? " · Sandbox test payments only" : " · Secure payments with Paddle" : ""}</p></div><CreditCard aria-hidden="true" className="size-5 shrink-0 text-secondary" /></div>
      <div className="p-5 sm:p-6">
        {!state && <p role="status" className="text-sm text-secondary">{message || "Loading your billing details…"}</p>}
        {state?.status === "past_due" && <p role="alert" className="mb-4 text-base text-danger-content">Your payment needs attention. Update your payment method to restore new imports and AI work. Your saved results remain available.</p>}
        {state?.status === "paused" && <p className="mb-4 text-base text-secondary">Your subscription is paused. Saved deals and analyses remain readable.</p>}
        {state?.status === "canceled" && <p className="mb-4 text-base text-secondary">Your subscription has ended. Choose a plan to start again; your history and recorded usage stay with your workspace.</p>}
        {state?.scheduledAction === "cancel" && state.scheduledAt && <p className="mb-4 text-base">Your subscription ends on {dateLabel(state.scheduledAt)} (UTC). Active access continues until cancellation takes effect.</p>}
        {synchronized && state?.status === "active" && !state.scheduledAction && state.nextBillingAt && <p className="mb-4 text-base text-secondary">Renews on {dateLabel(state.nextBillingAt)} (UTC).</p>}
        {state && !state.owner && <p className="text-base text-secondary">Your workspace owner manages plan changes and payment details.</p>}
        {state?.owner && state.operationPending && <p role="alert" className="mb-4 rounded-lg bg-panel-raised p-3 text-sm text-secondary">Your previous billing change is awaiting verification. Additional plan changes are unavailable until it is resolved.</p>}
        {state?.owner && <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">{options.map(plan => <div key={plan} className={`rounded-xl border p-4 ${plan === "PRO" ? "border-brand/30 bg-brand/5" : "border-line"}`}><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{PLAN_CATALOG[plan].displayName}</h3><p className="text-sm font-medium">{PLAN_CATALOG[plan].priceLabel}</p></div><p className="mt-2 text-sm leading-6 text-secondary">{plan === "PRO" ? "Deep Recovery Analysis, AI Auto Convert and higher allowances." : "Standard Analysis, Smart Import and Recovery Score."}</p><Button variant={plan === "PRO" ? "primary" : "outline"} className="mt-4 w-full" disabled={busy || !canSelectBillingPlan(state, plan)} onClick={() => setSelectedPlan(plan)}>{paid && state.plan === plan ? "Current plan" : paid ? plan === "PRO" ? "Upgrade to Pro" : "Change to Starter" : `Choose ${plan === "PRO" ? "Pro" : "Starter"}`}<ArrowUpRight aria-hidden="true" className="size-4" /></Button></div>)}</div>
          {synchronized && <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between"><Button variant="outline" disabled={busy} onClick={() => void act("portal")}>Manage billing / payment method</Button>{state.status === "active" && !state.scheduledAction && <Button variant="ghost" disabled={busy || state.operationPending} onClick={() => setCancelOpen(true)}>Cancel subscription</Button>}</div>}
          {synchronized && <details className="rounded-lg border border-line"><summary className="min-h-11 px-4 py-3 text-sm font-medium text-secondary">Billing update help</summary><div className="border-t border-line p-4"><p className="mb-3 text-sm leading-6 text-secondary">If a completed payment or plan change has not appeared, verify it with billing before repeating a change.</p><Button variant="outline" disabled={busy} onClick={() => void act("reconcile")}>Verify billing status</Button></div></details>}
        </div>}
        {state && <p role="status" aria-live="polite" className="mt-4 text-sm leading-6 text-secondary">{busy ? "Working… " : ""}{message}</p>}
        {!state && message && <Button variant="outline" className="mt-4" disabled={busy} onClick={() => void refresh().catch(() => setMessage("Billing status is temporarily unavailable."))}>Try again</Button>}
      </div>
    </Card>
    <Dialog open={Boolean(selectedPlan)} onClose={() => setSelectedPlan(null)} title={selectedPlan === "PRO" ? "More depth. More opportunities." : "Your focused recovery workflow"} description={selectedPlan === "PRO" ? "Pro adds strategic deal analysis and prepares messy exports for a larger pipeline." : "Starter gives you the essentials for evidence-grounded deal recovery."}>
      {selected && <><UpgradeProReview selectedPlan={selectedPlan!} /><p className="mt-5 text-sm leading-6 text-secondary">{paid ? selectedPlan === "PRO" ? "Upgrade applies after billing confirmation. Paddle calculates and collects the prorated difference immediately; a failed payment prevents the change." : "Your plan switches to Starter after billing confirmation. Any prorated credit is applied on your next bill. Deep Analysis and Auto Convert are unavailable on Starter; your saved results stay readable." : "Checkout opens securely with Paddle. Your plan activates only after billing confirmation; closing checkout does not activate it."}</p><p className="mt-3 flex items-start gap-2 text-xs leading-5 text-secondary"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />Cancel at the end of a billing period. Plan changes preserve history and recorded usage.{sandbox ? " This environment uses sandbox test payments." : " Payments are processed securely by Paddle."}</p><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setSelectedPlan(null)}>Keep browsing</Button><Button disabled={busy || !state || !selectedPlan || !canSelectBillingPlan(state, selectedPlan)} onClick={() => void act(paid ? "change-plan" : "checkout-intent", selectedPlan!)}><Check aria-hidden="true" className="size-4" />{paid ? "Confirm plan change" : "Continue to secure checkout"}</Button></div></>}
    </Dialog>
    <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel your subscription?" description="Cancellation is scheduled for the end of your current billing period."><p className="text-base leading-7 text-secondary">You keep active plan access until cancellation takes effect. After that, your saved deals and analyses remain readable, and new imports and AI work are unavailable.</p><p className="mt-3 text-sm text-secondary">Cancellation does not delete history or reset recorded usage.</p><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setCancelOpen(false)}>Keep subscription</Button><Button disabled={busy || !state || !canCancelBillingPlan(state)} onClick={() => void act("cancel")}>Confirm cancellation</Button></div></Dialog>
  </>;
}
