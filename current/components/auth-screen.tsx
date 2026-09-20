"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";

import { loginAction, signupAction } from "@/app/actions/auth";
import { BrandLogo } from "@/components/brand-logo";
import { Badge, Button, Input } from "@/components/ui";
import type { FormActionState } from "@/lib/auth/validation";

const INITIAL_STATE: FormActionState = {};

export function AuthScreen({ mode, nextPath, resetComplete = false }: { mode: "login" | "signup"; nextPath?: string; resetComplete?: boolean }) {
  const login = mode === "login";
  const action = login ? loginAction : signupAction;
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <main className="min-h-screen bg-background px-5 py-6 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <BrandLogo size="lg" />
        <Link href="/" className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-secondary transition-colors hover:bg-panel-hover hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">
          <ArrowLeft aria-hidden="true" className="size-4" /> <span className="hidden sm:inline">Back to home</span><span className="sm:hidden">Home</span>
        </Link>
      </div>

      <section className="mx-auto flex min-h-[calc(100vh-6.5rem)] w-full max-w-md items-center py-12">
        <div className="w-full rounded-2xl border border-line bg-panel p-6 sm:p-8">
          <Badge tone="neutral">Secure workspace access</Badge>
          <p className="mt-7 text-xs font-bold tracking-[0.08em] text-brand-content">{login ? "Welcome back" : "Create your workspace"}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-content">{login ? "Log in to LostDeal AI" : "Start with LostDeal AI"}</h1>
          <p className="mt-3 text-sm leading-6 text-secondary">
            {login ? "Continue to your organization’s recovery workspace." : "Create your account, then set up your business workspace."}
          </p>

          {login && resetComplete && <div role="status" className="mt-6 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-success-content">Your password was updated. Log in with your new password.</div>}

          {state.formError && <div role="alert" className="mt-6 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm leading-6 text-danger-content">{state.formError}</div>}

          <form action={formAction} className="mt-8 space-y-5" aria-label={login ? "Log in" : "Create account"}>
            <input type="hidden" name="next" value={nextPath ?? "/dashboard"} />
            {!login && <Input id="fullName" name="fullName" label="Full name" type="text" placeholder="Your name" autoComplete="name" maxLength={100} required disabled={pending} error={state.fieldErrors?.fullName} />}
            <Input id="email" name="email" label="Business email" type="email" placeholder="you@company.com" autoComplete="email" inputMode="email" maxLength={254} required disabled={pending} error={state.fieldErrors?.email} />
            <Input id="password" name="password" label="Password" type="password" placeholder="••••••••" autoComplete={login ? "current-password" : "new-password"} minLength={login ? undefined : 8} maxLength={128} required disabled={pending} description={login ? undefined : "Use at least 8 characters."} error={state.fieldErrors?.password} />
            {login && <div className="-mt-2 text-right"><Link href="/forgot-password" className="text-sm font-bold text-brand-content hover:text-brand-hover hover:underline">Forgot password?</Link></div>}
            <Button type="submit" loading={pending} className="h-11 w-full">
              {pending ? (login ? "Logging in…" : "Creating account…") : (login ? "Log In" : "Create Account")}
            </Button>
          </form>

          <p className="mt-5 flex gap-2 rounded-xl border border-line bg-panel-raised px-4 py-3 text-xs leading-5 text-secondary">
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
            Your password is handled by Supabase Auth and is never stored in LostDeal AI business tables.
          </p>
          <p className="mt-7 text-center text-sm text-secondary">
            {login ? "New to LostDeal AI?" : "Already have an account?"}{" "}
            <Link href={`${login ? "/signup" : "/login"}?next=${encodeURIComponent(nextPath ?? "/dashboard")}`} className="font-bold text-brand-content hover:text-brand-hover hover:underline">{login ? "Create account" : "Log in"}</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
