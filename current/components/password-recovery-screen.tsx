"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, KeyRound, MailCheck } from "lucide-react";

import { forgotPasswordAction, resetPasswordAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/brand-logo";
import { Badge, Button, Input } from "@/components/ui";
import type { FormActionState } from "@/lib/auth/validation";

const INITIAL_STATE: FormActionState = {};

export function PasswordRecoveryScreen({
  mode,
  recoveryValid = true,
}: {
  mode: "forgot" | "reset";
  recoveryValid?: boolean;
}) {
  const forgot = mode === "forgot";
  const action = forgot ? forgotPasswordAction : resetPasswordAction;
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const invalidRecovery = !forgot && !recoveryValid;

  return (
    <main className="min-h-screen bg-background px-5 py-6 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <BrandLogo size="lg" />
        <Link href="/login" className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-secondary transition-colors hover:bg-panel-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">
          <ArrowLeft aria-hidden="true" className="size-4" /> Back to login
        </Link>
      </div>

      <section className="mx-auto flex min-h-[calc(100vh-6.5rem)] w-full max-w-md items-center py-12">
        <div className="w-full rounded-2xl border border-line bg-panel p-6 sm:p-8">
          <Badge tone="neutral">Secure account recovery</Badge>
          <div className="mt-7 flex size-11 items-center justify-center rounded-xl border border-brand/25 bg-brand/10 text-brand">
            {state.formSuccess ? <MailCheck aria-hidden="true" className="size-5" /> : <KeyRound aria-hidden="true" className="size-5" />}
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-content">
            {forgot ? "Reset your password" : "Choose a new password"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-secondary">
            {forgot
              ? "Enter your business email. We’ll send recovery instructions if it belongs to an account."
              : "Use a unique password with at least 8 characters."}
          </p>

          {state.formSuccess && (
            <div role="status" className="mt-6 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-success-content">
              {state.formSuccess}
            </div>
          )}
          {(state.formError || invalidRecovery) && (
            <div role="alert" className="mt-6 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm leading-6 text-danger-content">
              {state.formError || "This recovery link is invalid or has expired. Request a new link."}
            </div>
          )}

          {!invalidRecovery && !state.formSuccess && (
            <form action={formAction} className="mt-8 space-y-5" aria-label={forgot ? "Request password reset" : "Set new password"}>
              {forgot ? (
                <Input id="email" name="email" label="Business email" type="email" placeholder="you@company.com" autoComplete="email" inputMode="email" maxLength={254} required disabled={pending} error={state.fieldErrors?.email} />
              ) : (
                <>
                  <Input id="password" name="password" label="New password" type="password" placeholder="••••••••" autoComplete="new-password" minLength={8} maxLength={128} required disabled={pending} description="Use at least 8 characters." error={state.fieldErrors?.password} />
                  <Input id="passwordConfirmation" name="passwordConfirmation" label="Confirm new password" type="password" placeholder="••••••••" autoComplete="new-password" minLength={8} maxLength={128} required disabled={pending} error={state.fieldErrors?.passwordConfirmation} />
                </>
              )}
              <Button type="submit" loading={pending} className="h-11 w-full">
                {pending ? (forgot ? "Sending…" : "Updating…") : (forgot ? "Send Reset Link" : "Update Password")}
              </Button>
            </form>
          )}

          {(invalidRecovery || state.formSuccess) && (
            <Link href={invalidRecovery ? "/forgot-password" : "/login"} className="mt-6 inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-line-strong bg-panel-raised px-4 text-sm font-bold text-content hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">
              {invalidRecovery ? "Request a New Link" : "Return to Login"}
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
