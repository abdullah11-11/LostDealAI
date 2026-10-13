import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { friendlyLoginError, getSafeNextPath } from "@/lib/auth/validation";

const unavailable = "Sign-in is temporarily unavailable. Please try again shortly.";

test("new workspace destinations preserve safe sign-in and deal-return paths", () => {
  for (const path of [
    "/recovery?sort=recovery_score&analysis=completed&priority=HIGH",
    "/insights",
    "/settings",
    "/settings/account",
    "/settings/privacy?from=account",
  ]) assert.equal(getSafeNextPath(path), path);
});

test("workspace destinations still reject foreign origins and unrelated paths", () => {
  for (const path of [
    "https://outside.test/settings",
    "//outside.test/recovery",
    "/\\outside.test/settings",
    "/recovery-other",
    "/insights-other",
    "/settings-other",
    "/recovery/../../outside",
    "/settings/../api/billing/change-plan",
    "/settings/%2e%2e/api/billing/change-plan",
  ]) assert.equal(getSafeNextPath(path), "/dashboard", path);
});

test("a provider credential rejection retains the generic invalid-login message", () => {
  assert.equal(friendlyLoginError({ code: "invalid_credentials", status: 400 }), "Invalid email or password.");
});

test("unknown, unconfirmed and restricted accounts share the rejected-login message", () => {
  for (const code of ["user_not_found", "email_not_confirmed", "user_banned"]) {
    assert.equal(friendlyLoginError({ code }), "Invalid email or password.");
  }
});

test("network and DNS failures do not tell the user their password is invalid", () => {
  for (const error of [
    { name: "AuthRetryableFetchError", status: 0 },
    new TypeError("fetch failed"),
    { cause: { code: "EAI_AGAIN" } },
  ]) {
    assert.equal(friendlyLoginError(error), unavailable);
  }
});

test("provider outage, timeout and configuration failures use a safe availability message", () => {
  for (const code of ["unexpected_failure", "request_timeout", "email_provider_disabled", "bad_jwt"]) {
    assert.equal(friendlyLoginError({ code }), unavailable);
  }
});

test("request throttling offers a retry message without inventing a wait duration", () => {
  assert.equal(friendlyLoginError({ code: "over_request_rate_limit" }),
    "Too many sign-in attempts. Wait a moment and try again.");
});

test("unknown errors never reflect provider diagnostics or submitted values", () => {
  for (const error of [null, undefined, "private diagnostic", 401, {
    code: "unknown_provider_code", message: "fixture-password fixture@example.test bearer-value",
    request: { password: "fixture-password" },
  }]) {
    assert.equal(friendlyLoginError(error), unavailable);
  }
});

test("the action still stops on Auth error and verifies identity and membership before redirect", async () => {
  const source = await readFile("app/actions/auth.ts", "utf8");
  const start = source.indexOf("export async function loginAction(");
  const end = source.indexOf("export async function signupAction(", start);
  const action = source.slice(start, end);
  const rejected = action.indexOf("if (error) return { formError: friendlyLoginError(error) }");
  const identity = action.indexOf("getVerifiedIdentity(supabase)");
  const membership = action.indexOf("getActiveOrganization(supabase, identity.id)");
  const destination = action.lastIndexOf("redirect(getSafeNextPath(");
  assert.ok(rejected > action.indexOf("signInWithPassword({ email, password })"));
  assert.ok(identity > rejected && membership > identity && destination > membership);
  assert.match(action, /if \(!identity\)[\s\S]*signOut\(\{ scope: "local" \}\)/);
  assert.match(action, /validateLogin\(formData\)/);
  assert.match(action, /hasFieldErrors\(fieldErrors\)/);
});
