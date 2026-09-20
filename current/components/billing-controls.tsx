"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Paddle } from "@paddle/paddle-js";
import { Button, Card } from "@/components/ui";
import { isPaidPlan, type PaidPlan } from "@/lib/billing/paddle-policy";

type State = { plan: string | null; status: string | null; owner: boolean; sandbox: boolean; nextBillingAt: string | null; scheduledAction: string | null; scheduledAt: string | null };
let paddlePromise: Promise<Paddle | undefined> | null = null;
const checkoutListeners = new Set<() => void>();
async function getPaddle(token: string) {
  if (!token.startsWith("test_")) throw new Error("Sandbox checkout is not configured.");
  if (!paddlePromise) paddlePromise = import("@paddle/paddle-js").then(({ initializePaddle }) => initializePaddle({ environment: "sandbox", token,
    eventCallback: event => { if (event.name === "checkout.completed") checkoutListeners.forEach(listener => listener()); },
  })).catch(error => { paddlePromise = null; throw error; });
  return paddlePromise;
}
const dateLabel = (s: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(s));
export function BillingControls({ intendedPlan }: { intendedPlan?: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const r = await fetch("/api/billing/status", { cache: "no-store" });
    if (!r.ok) throw new Error("Billing status is temporarily unavailable.");
    const data: State = await r.json(); if (mounted.current) setState(data); return data;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => setMessage("Billing status is temporarily unavailable."));
    return () => { mounted.current = false; checkoutListeners.clear(); if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);
  const poll = (target: PaidPlan | "cancel", attempt = 0) => {
    void refresh().then(data => {
      if (!mounted.current) return;
      if (target === "cancel" ? data.scheduledAction === "cancel" : data.sandbox && data.status === "active" && data.plan === target) {
        setMessage("Your billing change is confirmed. Reload to update the usage display."); setBusy(false); return;
      }
      if (attempt >= 14) { setMessage("Billing activation is still syncing. Refresh status in a moment."); setBusy(false); return; }
      timer.current = setTimeout(() => poll(target, attempt + 1), 2000);
    }).catch(() => { if (mounted.current) { setBusy(false); setMessage("Billing is still syncing. Refresh status before retrying."); } });
  };
  async function act(action: string, plan?: PaidPlan) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/billing/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan ? { plan } : {}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Billing is temporarily unavailable.");
      if (action === "checkout-intent") {
        const paddle = await getPaddle(data.clientToken); if (!paddle) throw new Error("We couldn't start checkout.");
        checkoutListeners.clear();
        checkoutListeners.add(() => { setBusy(true); setMessage("Payment received. Activating your workspace…"); poll(plan!); });
        paddle.Checkout.open({ items: [{ priceId: data.priceId, quantity: 1 }], customData: { lostdeal_checkout_intent_id: data.intentId },
          customer: data.email ? { email: data.email } : undefined, settings: { displayMode: "overlay", allowLogout: false } });
        setBusy(false);
      } else if (action === "portal") { window.location.assign(data.url); }
      else if (action === "reconcile") { await refresh(); setMessage(data.result === "APPLIED" ? "Billing status refreshed." : "Billing has a pending update. Wait two minutes, then refresh billing status."); setBusy(false); }
      else { setMessage("Your change is syncing with billing…"); poll(plan ?? "cancel"); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Billing is temporarily unavailable."); setBusy(false); }
  }
  if (state?.plan === "INTERNAL" || state?.plan === "BUSINESS") return null;
  const paid = state?.sandbox && state.status !== "canceled";
  const options: PaidPlan[] = isPaidPlan(intendedPlan) ? [intendedPlan, intendedPlan === "PRO" ? "STARTER" : "PRO"] : ["STARTER", "PRO"];
  return <Card className="mt-6 p-5 sm:p-6">
    <h2 className="text-base font-bold text-content">Manage subscription</h2>
    <p className="mt-2 text-sm text-secondary">Sandbox billing · Test payments only</p>
    {state && <p className="mt-2 text-sm text-content">{({ active: "Active", trialing: "Trial", past_due: "Payment issue", paused: "Paused", canceled: "Canceled", incomplete: "Activation pending" } as Record<string,string>)[state.status ?? ""] ?? "Billing status unavailable"}</p>}
    {state?.status === "past_due" && <p role="alert" className="mt-2 text-sm text-danger-content">Payment issue. Update your billing method to continue AI-powered actions.</p>}
    {state?.status === "paused" && <p className="mt-2 text-sm text-secondary">Your subscription is paused. Stored results remain available.</p>}
    {state?.scheduledAction === "cancel" && state.scheduledAt && <p className="mt-2 text-sm">Cancels on {dateLabel(state.scheduledAt)}</p>}
    {state?.sandbox && state.status === "active" && !state.scheduledAction && state.nextBillingAt && <p className="mt-2 text-sm">Next billing date: {dateLabel(state.nextBillingAt)}</p>}
    {state && !state.owner && <p className="mt-3 text-sm text-secondary">Ask your workspace owner to manage billing.</p>}
    {state?.owner && <div className="mt-4 flex flex-wrap gap-3">
      {options.map(plan => <Button key={plan} disabled={busy || !!(paid && (state.plan === plan || state.status !== "active" || state.scheduledAction))} onClick={() => void act(paid ? "change-plan" : "checkout-intent", plan)}>
        {paid ? plan === "PRO" ? "Upgrade to Pro" : "Change to Starter" : `Choose ${plan === "PRO" ? "Pro" : "Starter"}`}
      </Button>)}
      {state.sandbox && <>
        <Button disabled={busy} onClick={() => void act("portal")}>Manage billing / payment method</Button>
        <Button disabled={busy} onClick={() => void act("reconcile")}>Refresh billing status</Button>
        {state.status === "active" && !state.scheduledAction && <Button disabled={busy} onClick={() => { if (window.confirm("Cancel at the end of the current billing period? Your stored results will remain available.")) void act("cancel"); }}>Cancel subscription</Button>}
      </>}
    </div>}
    <button type="button" className="mt-4 text-sm font-semibold text-brand-content underline" disabled={busy} onClick={() => void refresh().catch(() => setMessage("Billing status is temporarily unavailable."))}>Refresh status</button>
    <p role="status" aria-live="polite" className="mt-3 text-sm text-secondary">{busy ? "Working… " : ""}{message}</p>
  </Card>;
}
