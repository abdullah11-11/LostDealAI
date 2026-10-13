import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { MarketingSection, MarketingEyebrow, MarketingLinkButton, SectionHeading } from "@/components/marketing/marketing-primitives";
import { FinalCta } from "@/components/marketing/final-cta";

export function FeaturePage({ eyebrow, title, description, visual, points, caveat, next }: {
  eyebrow: string; title: string; description: string; visual: ReactNode;
  points: Array<{ title: string; detail: string }>; caveat: string; next: { href: string; label: string };
}) {
  return <MarketingShell><main id="main-content"><MarketingSection><div className="grid items-center gap-10 lg:grid-cols-2"><div><MarketingEyebrow>{eyebrow}</MarketingEyebrow><h1 className="mt-5 text-balance text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">{title}</h1><p className="mt-5 text-lg leading-8 text-marketing-slate">{description}</p><div className="mt-7 flex flex-wrap gap-3"><MarketingLinkButton href="/signup">Create a workspace<ArrowRight aria-hidden="true" className="size-4" /></MarketingLinkButton><MarketingLinkButton href="/pricing" variant="secondary">Compare plans</MarketingLinkButton></div></div>{visual}</div></MarketingSection><MarketingSection className="bg-marketing-cream"><SectionHeading eyebrow="From evidence to action" title="A workflow your team can review."/><div className="mt-8 grid gap-6 md:grid-cols-3">{points.map(point => <article key={point.title} className="rounded-xl border border-marketing-line bg-marketing-white p-6"><Check aria-hidden="true" className="size-5 text-marketing-orange-dark" /><h3 className="mt-4 text-lg font-semibold">{point.title}</h3><p className="mt-3 text-base leading-7 text-marketing-slate">{point.detail}</p></article>)}</div><p className="mt-6 max-w-3xl text-sm leading-6 text-marketing-slate">{caveat}</p><Link href={next.href} className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-bold hover:underline">{next.label}<ArrowRight aria-hidden="true" className="size-4" /></Link></MarketingSection><FinalCta/></main></MarketingShell>;
}
