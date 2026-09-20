import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { MarketingSection, SectionHeading, MarketingLinkButton } from "@/components/marketing/marketing-primitives";
import { HeroProductStory, AutoConvertVisual, StandardAnalysisVisual, RecoveryScoreVisual, DeepAnalysisVisual, EvidenceGroundingVisual } from "@/components/marketing/product-visuals";
import { FinalCta } from "@/components/marketing/final-cta";

export const metadata: Metadata = {
  title: "Product — A Clear Recovery Workflow",
  description: "Explore supported CSV import, Auto Convert, Standard and Deep Analysis, evidence grounding and deterministic Recovery Score.",
  alternates: { canonical: "/product" },
  openGraph: { title: "LostDeal AI — A Clear Recovery Workflow", description: "From existing sales data to ranked recovery opportunities.", url: "/product", images: ["/og.png"] },
  twitter: { title: "LostDeal AI — A Clear Recovery Workflow", description: "From existing sales data to ranked recovery opportunities.", images: ["/og.png"] },
};

const features = [
  { label: "01 · Import", title: "Keep your CRM. Bring your history.", description: "Start with a supported CSV export. Map fields, review validation results, and import authorized closed-lost data into an organization-isolated workspace. You decide what to import; opening this preview does not upload or process anything.", visual: HeroProductStory },
  { label: "02 · Pro preparation", title: "Messy fields, clear records.", description: "Auto Convert maps, normalizes, merges, and safely extracts supported fields. Review provenance and any flagged rows before import. Smart Import remains available when you want deterministic and manual mapping.", visual: AutoConvertVisual },
  { label: "03 · Standard Analysis", title: "Get the essential story.", description: "Read the supported loss reason, buying intent, evidence, and recommended next action. Standard also provides timing, channel, and follow-up guidance. It answers what happened and what to do next.", visual: StandardAnalysisVisual },
  { label: "04 · Recovery Score", title: "Build a consistent priority queue.", description: "Stored deal signals feed a deterministic score. Sort recovery opportunities across your deal list and focus attention consistently. The score is a priority indicator, not conversion probability or expected revenue.", visual: RecoveryScoreVisual },
  { label: "05 · Deep Recovery Analysis", title: "Work through the harder questions.", description: "Explore primary blockers, recovery thesis, customer readiness, risk, timing interpretation, price/value, competitor dynamics, decision dynamics, discount caution, and a Deep follow-up strategy. Deep adds strategic workflow depth for important opportunities.", visual: DeepAnalysisVisual },
  { label: "06 · Evidence grounding", title: "Keep the source in view.", description: "Important analysis is tied to imported evidence. Unsupported interpretations are rejected or safely downgraded. Neither analysis nor outreach runs automatically when you view a page.", visual: EvidenceGroundingVisual },
];

export default function ProductPage() {
  return <MarketingShell><main id="main-content"><MarketingSection className="bg-marketing-ink text-white"><p className="text-xs font-black uppercase tracking-widest text-marketing-orange-soft">The LostDeal workflow</p><h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.06] tracking-[-0.04em] sm:text-6xl">Turn lost-deal history into a recovery workflow.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-marketing-ink-muted">Prepare the data, understand the evidence, and decide where your team should act next.</p></MarketingSection>{features.map((feature, index) => <MarketingSection key={feature.label} className={index % 2 ? "bg-marketing-cream" : ""}><div className="grid gap-10 lg:grid-cols-2 lg:items-center"><SectionHeading eyebrow={feature.label} title={feature.title} description={feature.description}/><feature.visual/></div></MarketingSection>)}<MarketingSection><SectionHeading eyebrow="Plan-aware workflow" title="Standard to start. Pro to prepare and go deeper." description="Starter includes Standard Analysis, Smart Import, and Recovery Score. Pro adds AI Auto Convert and Deep Recovery Analysis. Commercial activation awaits billing launch; no checkout is active in this preview."/><MarketingLinkButton href="/pricing" className="mt-7">Compare plans</MarketingLinkButton></MarketingSection><FinalCta/></main></MarketingShell>;
}
