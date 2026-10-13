import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as ui from "@/components/ui";
import * as presentation from "@/lib/billing/presentation";
import * as plans from "@/lib/billing/plans";
import * as policy from "@/lib/billing/paddle-policy";
import * as paymentLink from "@/lib/billing/payment-link";

const require = createRequire(import.meta.url);
type State = { plan: string; status: string; owner: boolean; sandbox: boolean; paddle: boolean; environment: string; nextBillingAt: string | null; scheduledAction: string | null; scheduledAt: string | null; operationPending: boolean };
const compiled = ts.transpileModule(readFileSync(new URL("../components/billing-controls.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
function render(state: State | null, selectedPlan: "PRO" | null = null) {
  let hook = 0;
  const exports: { BillingControls?: (props: { intendedPlan?: string }) => React.ReactElement } = {};
  const values = [state, false, "", selectedPlan, false];
  const isolatedRequire = (name: string) => {
    if (name === "react") return { ...React, useState() { return [values[hook++], () => { throw new Error("No state mutation in presentation render"); }]; }, useRef() { return { current: null }; }, useCallback(fn: unknown) { return fn; }, useEffect() {} };
    if (name === "react/jsx-runtime" || name === "lucide-react") return require(name);
    if (name === "@/lib/billing/presentation") return presentation;
    if (name === "@/lib/billing/plans") return plans;
    if (name === "@/lib/billing/paddle-policy") return policy;
    if (name === "@/lib/billing/payment-link") return paymentLink;
    if (name === "@/components/ui") return ui;
    if (name === "@/components/upgrade-pro-review") return { UpgradeProReview: () => React.createElement("p", null, "Isolated plan comparison") };
    if (name === "@/components/dialog") return { Dialog: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) => open ? React.createElement("section", { role: "dialog", "aria-label": title }, children) : null };
    throw new Error("Unexpected billing render dependency: " + name);
  };
  new Script(compiled, { filename: "components/billing-controls.tsx" }).runInNewContext({ require: isolatedRequire, exports });
  assert.ok(exports.BillingControls); return renderToStaticMarkup(exports.BillingControls({}));
}
const state = (status = "active", environment = "live"): State => ({ plan: "STARTER", status, owner: true, sandbox: environment === "sandbox", paddle: true, environment,
  nextBillingAt: "2026-11-01T00:00:00Z", scheduledAction: null, scheduledAt: null, operationPending: false });
test("actual billing component never labels unknown loading status as Sandbox or Live", () => {
  const html = render(null); assert.match(html, /Loading your billing details/); assert.doesNotMatch(html, /Sandbox test payments|Secure payments with Paddle|Choose Pro/);
});
test("actual Live billing component exposes payment management without Sandbox disclosure", () => {
  const html = render(state()); assert.match(html, /Secure payments with Paddle/); assert.match(html, /Manage billing \/ payment method/); assert.match(html, /Renews on/); assert.match(html, /Cancel subscription/); assert.doesNotMatch(html, /Sandbox|sandbox/);
});
test("actual Sandbox component preserves test-payment disclosure and renewal controls", () => {
  const html = render(state("active", "sandbox")); assert.match(html, /Sandbox test payments only/); assert.match(html, /Manage billing \/ payment method/); assert.match(html, /Renews on/);
});
for (const status of ["past_due", "paused", "canceled"]) test(`actual Live ${status} presentation keeps lifecycle explanation and safe restrictions`, () => {
  const html = render(state(status)); assert.match(html, status === "past_due" ? /payment needs attention/ : status === "paused" ? /subscription is paused/ : /subscription has ended/);
  assert.doesNotMatch(html, /Cancel subscription|Renews on|Sandbox/);
  if (status !== "canceled") assert.match(html, /<button[^>]*disabled=""[^>]*>.*?Upgrade to Pro/);
});
test("actual Live review stays explicit about authoritative confirmation and end-of-period cancellation", () => {
  const html = render(state(), "PRO"); assert.match(html, /role="dialog"/); assert.match(html, /Upgrade applies after billing confirmation/); assert.match(html, /failed payment prevents the change/); assert.match(html, /Cancel at the end of a billing period/); assert.doesNotMatch(html, /sandbox|Sandbox/);
});

function interactive(search: string, response: { allowed?: boolean; owner?: boolean; deferInitialize?: boolean } = {}) {
  let hook = 0; const effects: (() => void)[] = []; const updates: unknown[] = []; const paths: string[] = [];
  const window = { location: { search } }; const initial = [null, false, "", null, false];
  let initialized = 0; let callback: ((event: { name: string }) => void) | undefined;
  let releaseSdk!: () => void;
  const sdkLoad = new Promise<void>(resolve => { releaseSdk = resolve; });
  const exports: { BillingControls?: (props: object) => React.ReactElement; fixtureGetPaddle?: (token: string, environment: "live", approved?: string) => Promise<unknown> } = {};
  const isolatedRequire = (name: string) => {
    if (name === "react") return { ...React, useState() { const value = initial[hook++]; return [value, (update: unknown) => updates.push(update)]; }, useRef(value: unknown) { return { current: value }; }, useCallback(fn: unknown) { return fn; }, useEffect(effect: () => void) { effects.push(effect); } };
    if (name === "react/jsx-runtime" || name === "lucide-react") return require(name);
    if (name === "@/lib/billing/presentation") return presentation;
    if (name === "@/lib/billing/plans") return plans;
    if (name === "@/lib/billing/paddle-policy") return policy;
    if (name === "@/lib/billing/payment-link") return paymentLink;
    if (name === "@/components/ui") return ui;
    if (name === "@/components/upgrade-pro-review") return { UpgradeProReview: () => null };
    if (name === "@/components/dialog") return { Dialog: () => null };
    if (name === "@paddle/paddle-js") return { async initializePaddle(options: { environment: string; eventCallback: typeof callback }) { if (response.deferInitialize) await sdkLoad; assert.equal(options.environment, "production"); initialized++; callback = options.eventCallback; return { Checkout: { open() { throw new Error("Bootstrap must never open items or mutate a provider"); } } }; } };
    throw new Error("Unexpected component bootstrap dependency: " + name);
  };
  const fetch = async (path: string) => { paths.push(path); return path.endsWith("/status") ? Response.json({ ...state(), owner: response.owner !== false }) : Response.json({ environment: "live", transactionId: paymentLink.getPaymentLinkTransaction(search), clientToken: "live_synthetic" }, { status: response.allowed === false ? 403 : 200 }); };
  new Script(compiled + "\nexports.fixtureGetPaddle=getPaddle;").runInNewContext({ require: isolatedRequire, exports, window, fetch });
  assert.ok(exports.BillingControls); exports.BillingControls({});
  return { window, paths, updates, effects, getPaddle: exports.fixtureGetPaddle!, releaseSdk, initialized: () => initialized, completed: () => callback?.({ name: "checkout.completed" }) };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const transaction = `txn_${"t".repeat(26)}`;
test("actual billing mount bootstraps verified payment query and completion only refreshes status", async () => {
  const fixture = interactive(`?_ptxn=${transaction}`); fixture.effects[0](); await settle(); await settle();
  assert.equal(fixture.initialized(), 1); assert.deepEqual(fixture.paths, ["/api/billing/status", "/api/billing/payment-link"]);
  fixture.completed(); await settle(); assert.deepEqual(fixture.paths, ["/api/billing/status", "/api/billing/payment-link", "/api/billing/status"]);
  assert.ok(fixture.updates.filter(value => value && typeof value === "object").every(value => (value as { plan: string }).plan === "STARTER"));
});
test("rejected payment bootstrap cannot be bypassed by ordinary checkout initialization", async () => {
  const fixture = interactive(`?_ptxn=${transaction}`, { allowed: false }); fixture.effects[0](); await settle(); await settle();
  assert.equal(fixture.initialized(), 0); await assert.rejects(fixture.getPaddle("live_synthetic", "live"), new RegExp(paymentLink.PAYMENT_LINK_UNAVAILABLE)); assert.equal(fixture.initialized(), 0);
});
test("payment query change during SDK import is rejected immediately before initialization", async () => {
  const search = `?_ptxn=${transaction}`; const fixture = interactive(search);
  const pending = fixture.getPaddle("live_synthetic", "live", search);
  fixture.window.location.search = `?_ptxn=txn_${"x".repeat(26)}`;
  await assert.rejects(pending, new RegExp(paymentLink.PAYMENT_LINK_UNAVAILABLE)); assert.equal(fixture.initialized(), 0);
});
test("payment query change during asynchronous SDK CDN load remains bound before underlying Initialize", async () => {
  const search = `?_ptxn=${transaction}`; const fixture = interactive(search, { deferInitialize: true });
  const pending = fixture.getPaddle("live_synthetic", "live", search); await settle();
  fixture.window.location.search = `?_ptxn=txn_${"x".repeat(26)}`; fixture.releaseSdk();
  await assert.rejects(pending, new RegExp(paymentLink.PAYMENT_LINK_UNAVAILABLE)); assert.equal(fixture.initialized(), 0);
});
test("duplicate payment query and non-owner component never initialize Paddle", async () => {
  const duplicate = interactive(`?_ptxn=${transaction}&_ptxn=${transaction}`); duplicate.effects[0](); await settle(); await settle(); assert.equal(duplicate.initialized(), 0);
  const member = interactive(`?_ptxn=${transaction}`, { owner: false }); member.effects[0](); await settle(); await settle(); assert.equal(member.initialized(), 0); assert.deepEqual(member.paths, ["/api/billing/status"]);
});
