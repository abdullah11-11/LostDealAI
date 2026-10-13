import { MarketingShell } from "@/components/marketing/marketing-shell";
import { MarketingSection, MarketingEyebrow } from "@/components/marketing/marketing-primitives";
import type { PolicySection } from "@/lib/marketing/policies";
export function PolicyPage({ title, effectiveDate, sections }: { title: string; effectiveDate: string; sections: PolicySection[] }) {
  return <MarketingShell><main id="main-content"><MarketingSection><div className="mx-auto max-w-3xl"><MarketingEyebrow>LostDeal AI</MarketingEyebrow><h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1><p className="mt-4 text-sm text-marketing-slate">Effective {effectiveDate}</p><div className="mt-10 space-y-9">{sections.map(section => <section key={section.title}><h2 className="text-xl font-semibold">{section.title}</h2>{section.paragraphs.map((paragraph, index) => <p key={index} className="mt-3 text-base leading-8 text-marketing-slate">{paragraph}</p>)}</section>)}</div></div></MarketingSection></main></MarketingShell>;
}
