import type { Metadata } from "next";
import { CalendarRange, ChartNoAxesColumnIncreasing, Layers3 } from "lucide-react";

import { PageHeader } from "@/components/page-heading";
import { Badge, Card } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/server";
import { getOrganizationUsageSnapshot, type UsageLine } from "@/lib/billing/usage";
import { createClient } from "@/lib/supabase/server";
import { BillingControls } from "@/components/billing-controls";

export const metadata: Metadata = { title: "Plan & Usage" };
export const dynamic = "force-dynamic";

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function periodLabel(start: string | null, end: string | null): string {
  if (!start || !end) return "Unavailable";
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf())) return "Unavailable";
  return `${DATE_FORMAT.format(startDate)} – ${DATE_FORMAT.format(endDate)}`;
}

function allowanceLabel(line: UsageLine): string {
  return line.allowance === null
    ? `${line.used.toLocaleString("en-US")} / Unlimited`
    : `${line.used.toLocaleString("en-US")} / ${line.allowance.toLocaleString("en-US")}`;
}

function UsageCard({ label, description, line }: { label: string; description: string; line: UsageLine }) {
  const percent = line.allowance === null || line.allowance === 0
    ? 0
    : Math.min(100, Math.round((line.used / line.allowance) * 100));
  return (
    <article className="rounded-xl border border-line bg-panel-raised p-5">
      <p className="text-sm font-bold text-content">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-content">{allowanceLabel(line)}</p>
      <p className="mt-1 text-xs text-secondary">{label === "AI Auto Convert" ? "Rows prepared / Current allowance" : "Used / Current allowance"}</p>
      {line.allowance !== null && (
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-panel-hover" role="progressbar" aria-label={`${label} usage`} aria-valuemin={0} aria-valuemax={line.allowance} aria-valuenow={Math.min(line.used, line.allowance)}>
          <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
        </div>
      )}
      <p className="mt-4 text-xs leading-5 text-secondary">{description}</p>
    </article>
  );
}
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  const context = await requireOrganization(plan === "STARTER" || plan === "PRO" ? `/account?plan=${plan}` : "/account");
  const supabase = await createClient();
  const snapshot = await getOrganizationUsageSnapshot(supabase, context.organization.id);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Account"
        title="Plan & Usage"
        description="Verify your workspace plan and the actions counted during the current usage period. Limits are always enforced by the server, never the browser."
      />

      <BillingControls intendedPlan={plan} />
      {!snapshot.available || !snapshot.plan ? (
        <Card className="mt-7 p-6 sm:p-8">
          <div role="status" className="flex items-start gap-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-panel-raised text-brand"><Layers3 aria-hidden="true" className="size-5" /></span>
            <div>
              <h2 className="text-base font-bold text-content">Plan and usage setup is pending</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">Your existing workspace access is unchanged. Usage details will appear here after the commercial database migration is applied.</p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <section aria-labelledby="current-plan-heading" className="mt-7 grid gap-4 sm:grid-cols-2">
            <Card className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p id="current-plan-heading" className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted">Current Plan</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-content">{snapshot.plan.displayName}</p>
                  {snapshot.plan.priceLabel && <p className="mt-1 text-sm font-bold text-brand">{snapshot.plan.priceLabel}</p>}
                  <p className="mt-2 text-sm text-secondary">{context.organization.name}</p>
                </div>
                <Badge tone={snapshot.plan.planCode === "INTERNAL" ? "demo" : "completed"}>{snapshot.subscriptionStatus}</Badge>
              </div>
            </Card>
            <Card className="p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-line bg-panel-raised text-brand"><CalendarRange aria-hidden="true" className="size-5" /></span>
                <div>
                  <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted">Current Period</p>
                  <p className="mt-3 text-sm font-bold leading-6 text-content">{periodLabel(snapshot.periodStart, snapshot.periodEnd)}</p>
                  <p className="mt-1 text-xs text-secondary">Dates are shown in UTC.</p>
                </div>
              </div>
            </Card>
          </section>

          {snapshot.usage ? (
            <section aria-labelledby="usage-heading" className="mt-6">
              <div className="flex items-center gap-2">
                <ChartNoAxesColumnIncreasing aria-hidden="true" className="size-5 text-brand" />
                <h2 id="usage-heading" className="text-base font-bold text-content">Usage</h2>
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <UsageCard label="Imported Deals" description="Counts deals successfully inserted, including completed rows from a partial import." line={snapshot.usage.IMPORTED_DEALS} />
                <UsageCard label="AI Analyses" description="Standard and Deep Recovery Analysis each count as one explicit provider-backed analysis. Recovery scoring does not count." line={snapshot.usage.AI_ANALYSES} />
                <UsageCard label="AI Smart Mapping" description="Counts explicit AI mapping requests. Deterministic and manual mapping do not count." line={snapshot.usage.AI_MAPPING_REQUESTS} />
                {snapshot.plan.planCode === "STARTER" ? (
                  <article className="rounded-xl border border-brand/25 bg-brand/5 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-content">AI Auto Convert</p>
                      <Badge tone="demo">Pro feature</Badge>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight text-content">Available with Pro</p>
                    <p className="mt-1 text-xs text-secondary">Upgrade available when billing launches.</p>
                    <p className="mt-4 text-xs leading-5 text-secondary">Automatically prepares supported messy CSV rows. Smart Mapping remains included.</p>
                  </article>
                ) : (
                  <UsageCard label="AI Auto Convert" description="Counts rows submitted to provider-backed Auto Convert. Deterministic Smart Import does not count." line={snapshot.usage.AUTO_CONVERT_ROWS} />
                )}
              </div>
              <article className="mt-4 rounded-xl border border-brand/25 bg-brand/5 p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-bold text-content">Deep Recovery Analysis</p>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">Adds evidence-grounded blocker hierarchy, decision dynamics, timing and price interpretation, recovery strategy, risk and follow-up strategy.</p>
                  </div>
                  <Badge tone="demo">Pro feature</Badge>
                </div>
                <p className="mt-4 text-xs leading-5 text-secondary">
                  {snapshot.plan.planCode === "INTERNAL"
                    ? "Active for this Internal workspace. Each explicit Standard or Deep run uses one AI Analysis unit; usage is unlimited."
                    : snapshot.plan.planCode === "STARTER"
                      ? "Standard Analysis remains included. Deep Analysis becomes available with Pro when verified billing launches."
                      : snapshot.mode === "SHADOW"
                        ? "Commercial Deep execution remains inactive until verified billing launches. No checkout is available yet."
                        : snapshot.plan.planCode === "TRIAL"
                          ? "The future Trial preview includes two Deep analyses total. Each also counts toward AI Analyses."
                          : "Included with Pro. Standard and Deep runs each use one AI Analysis unit."}
                </p>
              </article>
            </section>
          ) : (
            <Card className="mt-6 p-5 sm:p-6">
              <h2 className="text-base font-bold text-content">Business is coming soon</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">This future connected plan is not purchasable and has no active commercial usage limits. No checkout or subscription is available yet.</p>
            </Card>
          )}

          {snapshot.mode === "SHADOW" && (
            <p className="mt-6 rounded-xl border border-line bg-panel-raised px-4 py-3 text-xs leading-5 text-secondary">Commercial limits are currently in monitored rollout. Provider-backed Auto Convert stays inactive for commercial plans until verified billing launches; existing core access remains unchanged.</p>
          )}
        </>
      )}
    </div>
  );
}
