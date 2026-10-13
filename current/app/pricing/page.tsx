import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { MarketingSection, SectionHeading } from "@/components/marketing/marketing-primitives";
import { PricingSection, PricingComparison } from "@/components/marketing/pricing-section";
import { FAQSection } from "@/components/marketing/faq-section";
import { FinalCta } from "@/components/marketing/final-cta";

export const metadata: Metadata = {
  title: "Pricing — Starter and Pro",
  description: "Compare LostDeal Starter at $15 per month and Pro at $45 per month. Clear allowances and workflow differences. Sandbox checkout is available for test payments.",
  alternates: { canonical: "/pricing" },
  openGraph: { title: "LostDeal AI — Starter and Pro Pricing", description: "Understand and prioritize, or automate preparation and go deeper.", url: "/pricing", images: ["/og.png"] },
  twitter: { title: "LostDeal AI — Starter and Pro Pricing", description: "Understand and prioritize, or automate preparation and go deeper.", images: ["/og.png"] },
};

export default function PricingPage() {
  return <MarketingShell><main id="main-content"><MarketingSection><div className="mx-auto max-w-4xl text-center"><p className="text-xs font-black uppercase tracking-widest text-marketing-orange-dark">Simple, transparent pricing</p><h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-6xl">Start small. Upgrade when your lost pipeline gets serious.</h1><p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-marketing-slate">Two plans for different recovery workflows. Monthly pricing is in USD. This environment uses sandbox checkout with test payments; it does not charge real money.</p></div><div className="mt-12"><PricingSection compact/></div></MarketingSection><MarketingSection className="bg-marketing-cream"><SectionHeading eyebrow="Compare the workflow" title="Choose the depth you need."/><div className="mt-10"><PricingComparison/></div><div className="mt-8 grid gap-8 sm:grid-cols-2"><div><h3 className="text-xl font-bold">Standard: understand and prioritize</h3><p className="mt-3 leading-7 text-marketing-slate">Explain what happened, review evidence, and choose a next action. Smart Import maps supported CSV columns; Recovery Score helps prioritize.</p></div><div><h3 className="text-xl font-bold">Pro: prepare and go deeper</h3><p className="mt-3 leading-7 text-marketing-slate">Auto Convert prepares messy supported data with provenance. Deep adds blockers, readiness, risk, and recovery strategy. Each successful Standard or Deep operation uses one AI analysis unit.</p></div></div><p className="mt-8 text-sm leading-6 text-marketing-slate">Allowances are per monthly usage period. AI mapping counts requests; Auto Convert counts submitted rows. Scoring and viewing stored results do not use AI analysis units.</p></MarketingSection><MarketingSection><FAQSection/></MarketingSection><FinalCta/></main></MarketingShell>;
}
