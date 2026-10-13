import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { Script } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import * as ui from "@/components/ui";
import * as validation from "@/lib/auth/validation";
import { PASSWORD_RESET_GENERIC_MESSAGE } from "@/lib/auth/password-recovery";
import type { FormActionState } from "@/lib/auth/validation";

const require = createRequire(import.meta.url);
const compiled = Object.fromEntries([
  ["OnboardingForm", "onboarding-form"],
  ["PasswordRecoveryScreen", "password-recovery-screen"],
].map(([name, file]) => [name, ts.transpileModule(
  readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } },
).outputText]));

type OnboardingProps = { needsFullName: boolean; nextPath?: string };
type RecoveryProps = { mode: "forgot" | "reset"; recoveryValid?: boolean };
type Props = OnboardingProps | RecoveryProps;
type FormElement = React.ReactElement<{ action?: unknown; children?: React.ReactNode }>;
type ActionName = "onboardingAction" | "forgotPasswordAction" | "resetPasswordAction";

function formsIn(node: React.ReactNode): FormElement[] {
  if (Array.isArray(node)) return node.flatMap(formsIn);
  if (!React.isValidElement<{ action?: unknown; children?: React.ReactNode }>(node)) return [];
  return [...(node.type === "form" ? [node] : []), ...formsIn(node.props.children)];
}

// Render the real authored components and UI controls. Only hook results and
// framework/action boundaries are isolated; no action, credentials or network runs.
function renderState(component: "OnboardingForm" | "PasswordRecoveryScreen", props: Props, state: FormActionState | undefined, pending: boolean, expectedAction: ActionName) {
  const actions = {
    onboardingAction() { throw new Error("A render test must not create a workspace"); },
    forgotPasswordAction() { throw new Error("A render test must not send recovery email"); },
    resetPasswordAction() { throw new Error("A render test must not update a password"); },
  };
  const dispatch = () => { throw new Error("A render test must not dispatch a form"); };
  let selectedAction: unknown;
  let initialState: unknown;
  const exports: Record<string, (props: Props) => React.ReactElement> = {};
  const isolatedRequire = (name: string) => {
    switch (name) {
      case "react": return { ...React, useActionState(action: unknown, initial: unknown) { selectedAction = action; initialState = initial; return [state, dispatch, pending]; } };
      case "react/jsx-runtime": return require(name);
      case "lucide-react": return require(name);
      case "next/link": return function IsolatedLink({ children, ...attributes }: React.AnchorHTMLAttributes<HTMLAnchorElement>) { return React.createElement("a", attributes, children); };
      case "@/app/actions/auth": return actions;
      case "@/components/brand-logo": return { BrandLogo: function IsolatedBrandLogo() { return React.createElement("a", { href: "/" }, "LostDeal AI"); } };
      case "@/components/ui": return ui;
      case "@/lib/auth/validation": return validation;
      default: throw new Error(`Unexpected component import: ${name}`);
    }
  };
  new Script(compiled[component], { filename: `components/${component}.tsx` }).runInNewContext({ require: isolatedRequire, exports });
  assert.ok(exports[component]);
  const element = exports[component](props);
  const forms = formsIn(element);
  assert.equal(selectedAction, actions[expectedAction]);
  assert.ok(initialState && Object.keys(initialState).length === 0);
  for (const form of forms) assert.equal(form.props.action, dispatch);
  return { html: renderToStaticMarkup(element), formCount: forms.length };
}

function renderOnboarding(state: FormActionState | undefined, props: OnboardingProps, pending = false) {
  return renderState("OnboardingForm", props, state, pending, "onboardingAction");
}

function renderRecovery(state: FormActionState | undefined, props: RecoveryProps, pending = false) {
  return renderState("PasswordRecoveryScreen", props, state, pending, props.mode === "forgot" ? "forgotPasswordAction" : "resetPasswordAction");
}

function controlFor(html: string, field: string) {
  const control = html.match(new RegExp(`<(?:input|select)[^>]*name="${field}"[^>]*>`))?.[0];
  assert.ok(control, field);
  return control;
}

function assertPending(html: string, fields: string[], pending: boolean) {
  for (const field of fields) {
    const control = controlFor(html, field);
    if (pending) assert.match(control, /disabled=""/);
    else assert.doesNotMatch(control, /disabled=""/);
  }
  const button = html.match(/<button\b[^>]*>/)?.[0];
  assert.ok(button);
  if (pending) {
    assert.match(button, /disabled=""/);
    assert.match(button, /aria-busy="true"/);
  } else assert.doesNotMatch(button, /disabled=""|aria-busy="true"/);
}

test("onboarding stays renderable through an undefined redirect result with its dispatch and pending controls", () => {
  for (const pending of [true, false]) {
    const { html, formCount } = renderOnboarding(undefined, { needsFullName: true, nextPath: "/insights" }, pending);
    assert.equal(formCount, 1);
    assert.match(html, /<form[^>]*aria-label="Set up workspace"/);
    assert.match(html, /name="next" value="\/insights"/);
    assert.match(html, /name="fullName"/);
    assert.match(html, /name="industry"/);
    assert.doesNotMatch(html, /role="alert"|aria-invalid="true"/);
    assert.match(html, pending ? /Creating workspace…/ : />Create Workspace<\/button>/);
    assertPending(html, ["fullName", "businessName", "industry"], pending);
  }
});

test("onboarding retains the existing-profile field selection and default next path during redirect", () => {
  const { html, formCount } = renderOnboarding(undefined, { needsFullName: false });
  assert.equal(formCount, 1);
  assert.match(html, /name="next" value="\/dashboard"/);
  assert.doesNotMatch(html, /name="fullName"/);
  assert.match(html, /name="businessName"/);
  assert.match(html, /name="industry"/);
});

test("onboarding preserves immutable form and field errors while a retry is pending", () => {
  const state: FormActionState = Object.freeze({
    formError: "Your workspace was saved, but setup could not finish. Submit again to safely continue.",
    fieldErrors: Object.freeze({ fullName: "Enter your full name.", businessName: "Enter your business name.", industry: "Select your industry." }),
  });
  const before = JSON.stringify(state);
  const { html, formCount } = renderOnboarding(state, { needsFullName: true }, true);
  assert.equal(formCount, 1);
  assert.match(html, /role="alert"/);
  assert.ok(html.includes(state.formError!));
  for (const [field, message] of Object.entries(state.fieldErrors!)) {
    assert.match(html, new RegExp(`<(?:input|select)[^>]*id="${field}"[^>]*aria-describedby="${field}-help"[^>]*aria-invalid="true"`));
    assert.ok(html.includes(message));
  }
  assertPending(html, ["fullName", "businessName", "industry"], true);
  assert.equal(JSON.stringify(state), before);
});

test("reset preserves password requirements, action and pending controls through undefined redirect state", () => {
  for (const pending of [true, false]) {
    const { html, formCount } = renderRecovery(undefined, { mode: "reset", recoveryValid: true }, pending);
    assert.equal(formCount, 1);
    assert.match(html, /<form[^>]*aria-label="Set new password"/);
    for (const field of ["password", "passwordConfirmation"]) {
      const control = controlFor(html, field);
      for (const attribute of [/type="password"/, /autoComplete="new-password"/, /minLength="8"/, /maxLength="128"/, /required=""/]) assert.match(control, attribute);
    }
    assert.doesNotMatch(html, /name="email"|role="alert"|role="status"|aria-invalid="true"/);
    assert.match(html, pending ? /Updating…/ : />Update Password<\/button>/);
    assertPending(html, ["password", "passwordConfirmation"], pending);
  }
});

test("forgot mode retains its own action, email field and pending behavior when state is undefined", () => {
  for (const pending of [true, false]) {
    const { html, formCount } = renderRecovery(undefined, { mode: "forgot" }, pending);
    assert.equal(formCount, 1);
    assert.match(html, /<form[^>]*aria-label="Request password reset"/);
    assert.match(controlFor(html, "email"), /type="email"/);
    assert.doesNotMatch(html, /name="password"|name="passwordConfirmation"|role="alert"|role="status"/);
    assert.match(html, pending ? /Sending…/ : />Send Reset Link<\/button>/);
    assertPending(html, ["email"], pending);
  }
});

test("invalid recovery never exposes a reset form even with undefined state and pending hook result", () => {
  for (const state of [undefined, Object.freeze({})]) {
    for (const pending of [true, false]) {
      const { html, formCount } = renderRecovery(state, { mode: "reset", recoveryValid: false }, pending);
      assert.equal(formCount, 0);
      assert.match(html, /role="alert"/);
      assert.ok(html.includes("This recovery link is invalid or has expired. Request a new link."));
      assert.match(html, /href="\/forgot-password"/);
      assert.match(html, /Request a New Link/);
      assert.doesNotMatch(html, /<form|name="password"|name="passwordConfirmation"|Update Password/);
    }
  }
});

test("forgot success preserves generic enumeration-safe wording and removes the request form", () => {
  const state = Object.freeze({ formSuccess: PASSWORD_RESET_GENERIC_MESSAGE });
  const before = JSON.stringify(state);
  const { html, formCount } = renderRecovery(state, { mode: "forgot" });
  assert.equal(formCount, 0);
  assert.match(html, /role="status"/);
  assert.ok(html.includes(PASSWORD_RESET_GENERIC_MESSAGE));
  assert.match(html, /Return to Login/);
  assert.doesNotMatch(html, /<form|role="alert"|name="email"/);
  assert.equal(JSON.stringify(state), before);
});

test("forgot errors retain their field association and generic temporary-service message", () => {
  const state: FormActionState = Object.freeze({
    formError: "Password recovery is temporarily unavailable. Please try again shortly.",
    fieldErrors: Object.freeze({ email: "Enter a valid email address." }),
  });
  const { html, formCount } = renderRecovery(state, { mode: "forgot" });
  assert.equal(formCount, 1);
  assert.match(html, /role="alert"/);
  assert.ok(html.includes(state.formError!));
  assert.match(html, /<input[^>]*id="email"[^>]*aria-describedby="email-help"[^>]*aria-invalid="true"/);
  assert.ok(html.includes(state.fieldErrors!.email!));
  assert.doesNotMatch(html, /role="status"/);
});

test("reset failure keeps password field errors and pending dispatch presentation without granting recovery", () => {
  const state: FormActionState = Object.freeze({
    formError: "Your password could not be updated. Request a new link and try again.",
    fieldErrors: Object.freeze({ password: "Use at least 8 characters.", passwordConfirmation: "Passwords do not match." }),
  });
  const before = JSON.stringify(state);
  const { html, formCount } = renderRecovery(state, { mode: "reset", recoveryValid: true }, true);
  assert.equal(formCount, 1);
  assert.match(html, /role="alert"/);
  assert.ok(html.includes(state.formError!));
  for (const [field, message] of Object.entries(state.fieldErrors!)) {
    assert.match(html, new RegExp(`<input[^>]*id="${field}"[^>]*aria-describedby="${field}-help"[^>]*aria-invalid="true"`));
    assert.ok(html.includes(message));
  }
  assertPending(html, ["password", "passwordConfirmation"], true);
  assert.doesNotMatch(html, /role="status"|Return to Login/);
  assert.equal(JSON.stringify(state), before);
});
