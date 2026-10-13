import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { Script } from "node:vm";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import * as ui from "@/components/ui";
import { friendlyLoginError, type FormActionState } from "@/lib/auth/validation";

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(
  readFileSync(new URL("../components/auth-screen.tsx", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } },
).outputText;

type Props = { mode: "login" | "signup"; nextPath?: string; resetComplete?: boolean };

// Render the real authored component and UI controls. Only the hook result and
// framework/action boundaries are isolated; no server action or network runs.
function renderState(state: FormActionState | undefined, props: Props, pending = false) {
  const actions = {
    loginAction() { throw new Error("A render test must not submit a login action"); },
    signupAction() { throw new Error("A render test must not submit a signup action"); },
  };
  const dispatch = () => { throw new Error("A render test must not dispatch a form"); };
  let selectedAction: unknown;
  let initialState: unknown;
  const exports: { AuthScreen?: React.ComponentType<Props> } = {};
  const isolatedRequire = (name: string) => {
    switch (name) {
      case "react": return { ...React, useActionState(action: unknown, initial: unknown) { selectedAction = action; initialState = initial; return [state, dispatch, pending]; } };
      case "react/jsx-runtime": return require(name);
      case "lucide-react": return require(name);
      case "next/link": return function IsolatedLink({ children, ...attributes }: React.AnchorHTMLAttributes<HTMLAnchorElement>) { return React.createElement("a", attributes, children); };
      case "@/app/actions/auth": return actions;
      case "@/components/brand-logo": return { BrandLogo: function IsolatedBrandLogo() { return React.createElement("a", { href: "/" }, "LostDeal AI"); } };
      case "@/components/ui": return ui;
      default: throw new Error(`Unexpected component import: ${name}`);
    }
  };
  new Script(compiled, { filename: "components/auth-screen.tsx" }).runInNewContext({ require: isolatedRequire, exports });
  assert.ok(exports.AuthScreen);
  const html = renderToStaticMarkup(React.createElement(exports.AuthScreen, props));
  assert.equal(selectedAction, props.mode === "login" ? actions.loginAction : actions.signupAction);
  assert.ok(initialState && Object.keys(initialState).length === 0);
  return html;
}

test("login remains renderable when a completed redirect leaves action state undefined", () => {
  for (const pending of [true, false]) {
    const html = renderState(undefined, { mode: "login", nextPath: "/insights" }, pending);
    assert.match(html, /<form[^>]*aria-label="Log in"/);
    assert.match(html, /name="next" value="\/insights"/);
    assert.match(html, /name="email"/);
    assert.match(html, /name="password"/);
    assert.doesNotMatch(html, /role="alert"|aria-invalid="true"/);
    assert.match(html, pending ? /Logging in…/ : />Log In<\/button>/);
    if (pending) assert.match(html, /<button[^>]*disabled=""[^>]*aria-busy="true"/);
    else assert.doesNotMatch(html, /disabled=""|aria-busy="true"/);
  }
});

test("signup retains its name and password requirements during the same redirect transient", () => {
  const html = renderState(undefined, { mode: "signup" }, true);
  assert.match(html, /<form[^>]*aria-label="Create account"/);
  assert.match(html, /name="fullName"/);
  assert.match(html, /minLength="8"/);
  assert.match(html, /Creating account…/);
  assert.doesNotMatch(html, /role="alert"|aria-invalid="true"/);
});

test("credential rejection and temporary-service action results keep their safe error messages", () => {
  for (const error of [{ code: "invalid_credentials", status: 400 }, { name: "AuthRetryableFetchError", status: 0 }]) {
    const message = friendlyLoginError(error);
    const state = Object.freeze({ formError: message });
    const html = renderState(state, { mode: "login" });
    assert.match(html, /role="alert"/);
    assert.ok(html.includes(message));
    assert.equal(state.formError, message);
    assert.doesNotMatch(html, /invalid_credentials|AuthRetryableFetchError/);
  }
});

test("validation action results still mark the corresponding fields invalid", () => {
  const state: FormActionState = Object.freeze({ fieldErrors: Object.freeze({ fullName: "Enter your name.", email: "Enter a valid email.", password: "Use at least 8 characters." }) });
  const html = renderState(state, { mode: "signup" });
  for (const [field, message] of Object.entries(state.fieldErrors!)) {
    assert.match(html, new RegExp(`<input[^>]*id="${field}"[^>]*aria-describedby="${field}-help"[^>]*aria-invalid="true"`));
    assert.ok(html.includes(message));
  }
  assert.doesNotMatch(html, /role="alert"/);
});
