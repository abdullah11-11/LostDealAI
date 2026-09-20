"use client";

import { useActionState } from "react";
import { Building2 } from "lucide-react";

import { onboardingAction } from "@/app/actions/auth";
import { Button, Input, Select } from "@/components/ui";
import { INDUSTRIES, type FormActionState } from "@/lib/auth/validation";

const INITIAL_STATE: FormActionState = {};

export function OnboardingForm({ needsFullName, nextPath = "/dashboard" }: { needsFullName: boolean; nextPath?: string }) {
  const [state, formAction, pending] = useActionState(onboardingAction, INITIAL_STATE);

  return (
    <form action={formAction} className="mt-8 space-y-5" aria-label="Set up workspace">
      <input type="hidden" name="next" value={nextPath} />
      {state.formError && (
        <div role="alert" className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm leading-6 text-danger-content">
          {state.formError}
        </div>
      )}
      {needsFullName && (
        <Input
          id="fullName"
          name="fullName"
          label="Full name"
          autoComplete="name"
          maxLength={100}
          required
          disabled={pending}
          error={state.fieldErrors?.fullName}
          description="We need your name to complete your profile."
        />
      )}
      <Input
        id="businessName"
        name="businessName"
        label="Business name"
        placeholder="Acme Home Services"
        autoComplete="organization"
        maxLength={120}
        required
        disabled={pending}
        error={state.fieldErrors?.businessName}
      />
      <Select
        id="industry"
        name="industry"
        label="Industry"
        defaultValue=""
        required
        disabled={pending}
        error={state.fieldErrors?.industry}
      >
        <option value="" disabled>Select your industry</option>
        {INDUSTRIES.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
      </Select>
      <Button type="submit" loading={pending} className="h-11 w-full">
        <Building2 aria-hidden="true" className="size-4" />
        {pending ? "Creating workspace…" : "Create Workspace"}
      </Button>
    </form>
  );
}
