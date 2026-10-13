import { ArrowRight, Check, Minus } from "lucide-react";

import { SectionHeading, marketingButtonStyles } from "@/components/marketing/marketing-primitives";
import { PUBLIC_MARKETING_PLANS, type PublicMarketingPlan } from "@/lib/marketing/plans";

function PlanCta({ plan }: { plan: PublicMarketingPlan }) {
  return (
    <a
      href={`/account?plan=${plan.code}`}
      data-marketing-plan={plan.code}
      data-checkout-state="sandbox"
      className={marketingButtonStyles(plan.recommended ? "primary" : "secondary", "mt-7 w-full")}
    >
      Choose {plan.name} <ArrowRight aria-hidden="true" className="size-4" />
    </a>
  );
}

function Allowance({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-marketing-line py-3 text-sm">
      <dt className="text-marketing-slate">{label}</dt>
      <dd className="font-extrabold text-marketing-ink">{value}</dd>
    </div>
  );
}

function PricingCard({ plan }: { plan: PublicMarketingPlan }) {
  return (
    <article className={`relative flex h-full flex-col rounded-[1.75rem] border p-5 sm:p-7 ${plan.recommended ? "border-marketing-orange bg-marketing-ink text-white shadow-[0_24px_70px_rgba(17,24,39,0.16)]" : "border-marketing-line bg-marketing-white text-marketing-ink"}`}>
      {plan.recommended && (
        <span className="absolute right-5 top-5 rounded-full bg-marketing-orange px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-marketing-ink">
          Recommended
        </span>
      )}
      <p className={`text-xs font-black uppercase tracking-[0.16em] ${plan.recommended ? "text-marketing-orange-soft" : "text-marketing-orange-dark"}`}>{plan.name}</p>
      <p className="mt-5 flex items-end gap-2"><span className="text-5xl font-semibold tracking-[-0.06em]">{plan.price}</span><span className={`pb-1 text-sm ${plan.recommended ? "text-marketing-ink-muted" : "text-marketing-slate"}`}>/ month</span></p>
      <p className={`mt-4 text-lg font-extrabold ${plan.recommended ? "text-white" : "text-marketing-ink"}`}>{plan.outcome}</p>
      <p className={`mt-3 min-h-18 text-sm leading-6 ${plan.recommended ? "text-marketing-ink-muted" : "text-marketing-slate"}`}>{plan.positioning}</p>

      <ul className={`mt-6 space-y-3 border-t pt-6 ${plan.recommended ? "border-white/12" : "border-marketing-line"}`}>
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-sm font-bold">
            <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${plan.recommended ? "bg-marketing-orange/16 text-marketing-orange-soft" : "bg-marketing-orange-soft text-marketing-orange-dark"}`}><Check aria-hidden="true" className="size-3" /></span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <dl className={`mt-6 ${plan.recommended ? "[&>div]:border-white/12 [&_dt]:text-marketing-ink-muted [&_dd]:text-white" : ""}`}>
        <Allowance label="Imported deals" value={plan.allowances.importedDeals} />
        <Allowance label="AI analyses" value={plan.allowances.aiAnalyses} />
        <Allowance label="AI mapping requests" value={plan.allowances.aiMappingRequests} />
        {plan.allowances.autoConvertRows && <Allowance label="Auto Convert rows" value={plan.allowances.autoConvertRows} />}
      </dl>

      <div className="mt-auto">
        <PlanCta plan={plan} />
        <p className={`mt-3 text-center text-xs leading-5 ${plan.recommended ? "text-marketing-ink-muted" : "text-marketing-slate"}`}>Sandbox preview. No real payments.</p>
      </div>
    </article>
  );
}

export function PricingSection({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      {!compact && (
        <SectionHeading
          eyebrow="Simple, transparent pricing"
          title="Start small. Upgrade when your lost pipeline gets serious."
          description="Choose the depth of workflow your team needs. Sign in to your workspace to manage your plan. Sandbox test payments only."
          align="center"
        />
      )}
      <div className={`${compact ? "" : "mt-12"} mx-auto grid max-w-5xl gap-5 lg:grid-cols-2 lg:items-stretch`}>
        {PUBLIC_MARKETING_PLANS.map((plan) => <PricingCard key={plan.code} plan={plan} />)}
      </div>
    </div>
  );
}

const comparisonRows = [
  { label: "Standard Analysis", starter: "Included", pro: "Included" },
  { label: "Recovery Score", starter: "Included", pro: "Included" },
  { label: "Smart Import", starter: "Included", pro: "Included" },
  { label: "AI Auto Convert", starter: null, pro: "Included" },
  { label: "Deep Recovery Analysis", starter: null, pro: "Included" },
] as const;

export function PricingComparison() {
  return <div className="overflow-x-auto rounded-xl border border-marketing-line bg-marketing-white"><table className="w-full min-w-[360px] text-left text-sm"><caption className="sr-only">Starter and Pro workflow comparison</caption><thead className="border-b border-marketing-line bg-marketing-cream text-xs text-marketing-slate"><tr><th scope="col" className="px-4 py-4 sm:px-6">Workflow</th><th scope="col" className="px-3 py-4 text-center">Starter</th><th scope="col" className="px-3 py-4 text-center">Pro</th></tr></thead><tbody>{comparisonRows.map(row => <tr key={row.label} className="border-b border-marketing-line last:border-b-0"><th scope="row" className="px-4 py-4 font-semibold sm:px-6">{row.label}</th>{[row.starter, row.pro].map((value, index) => <td key={index} className="px-3 py-4 text-center">{value ? <span className="inline-flex items-center gap-1.5 font-medium text-marketing-green"><Check aria-hidden="true" className="size-4" />{value}</span> : <span className="inline-flex items-center gap-1 text-marketing-slate"><Minus aria-hidden="true" className="size-4" />Not included</span>}</td>)}</tr>)}</tbody></table></div>;
}
