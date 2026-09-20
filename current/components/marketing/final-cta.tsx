import { ArrowRight } from "lucide-react";

import { MarketingLinkButton } from "@/components/marketing/marketing-primitives";

export function FinalCta() {
  return (
    <section className="px-5 pb-20 sm:px-8 sm:pb-24 lg:px-10 lg:pb-30">
      <div className="marketing-final-cta mx-auto max-w-7xl overflow-hidden rounded-[2rem] border border-white/10 bg-marketing-ink px-5 py-12 text-white sm:px-10 sm:py-16 lg:px-16">
        <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-marketing-orange-soft">Your recovery queue starts here</p>
            <h2 className="mt-4 max-w-3xl text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl">
              Some lost deals are finished. <span className="text-marketing-orange-soft">Some just need the right next move.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-7 text-marketing-ink-muted sm:text-lg">Turn your closed-lost data into a ranked recovery queue.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
            <MarketingLinkButton href="/product" variant="primary">See LostDeal in Action <ArrowRight aria-hidden="true" className="size-4" /></MarketingLinkButton>
            <MarketingLinkButton href="/pricing" variant="dark">View Pricing</MarketingLinkButton>
          </div>
        </div>
      </div>
    </section>
  );
}
