import { getSafeNextPath } from "@/lib/auth/validation";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";

import { BrandLogo } from "@/components/brand-logo";
import { OnboardingForm } from "@/components/onboarding-form";
import { getAppAuthContext } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const nextPath = getSafeNextPath((await searchParams).next);
  const context = await getAppAuthContext();
  if (!context.identity) redirect("/login?next=%2Fonboarding");
  if (context.organization) redirect(nextPath);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-line bg-sidebar px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <BrandLogo size="lg" />
          <p className="truncate text-xs font-semibold text-secondary">Signed in as {context.identity.email}</p>
        </div>
      </header>
      <div className="mx-auto max-w-xl px-5 py-12 sm:py-16">
        <div className="mb-7 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl border border-brand/25 bg-brand/10 text-brand"><Building2 aria-hidden="true" className="size-6" /></span>
          <p className="mt-5 text-xs font-bold tracking-[0.08em] text-brand">Workspace setup</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-content sm:text-4xl">Set up your LostDeal AI workspace</h1>
          <p className="mt-3 text-sm leading-6 text-secondary">A couple of details, then you can bring your first CSV.</p>
        </div>
        <section className="rounded-2xl border border-line bg-panel p-6 sm:p-8">
          <h2 className="text-xl font-bold text-content">Business details</h2>
          <p className="mt-2 text-sm leading-6 text-secondary">Your workspace keeps its deal history separate. You can finish your first recovery workflow at your own pace.</p>
          <OnboardingForm needsFullName={!context.profileFullName} nextPath={nextPath} />
        </section>
      </div>
    </main>
  );
}
