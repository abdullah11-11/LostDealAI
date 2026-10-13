import Link from "next/link";

import { BrandLogo } from "@/components/brand-logo";
import { approvedLaunchDetails } from "@/lib/marketing/launch";

export function MarketingFooter() {
  return (
    <footer className="border-t border-marketing-line bg-marketing-ivory px-5 py-10 sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <BrandLogo size="sm" />
          <p className="mt-4 max-w-md text-sm leading-6 text-marketing-slate">
            Evidence-grounded recovery intelligence for the sales data you already have.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          <FooterGroup title="Product" links={[{ href: "/product", label: "Overview" }, { href: "/lost-deal-intelligence", label: "Lost deal intelligence" }, { href: "/deal-recovery", label: "Deal recovery" }, { href: "/ai-analysis", label: "AI analysis" }]} />
          <FooterGroup title="Workspace" links={[{ href: "/pricing", label: "Pricing" }, { href: "/security", label: "Security & data" }, { href: "/login", label: "Sign in" }]} />
          {approvedLaunchDetails && <FooterGroup title="Help & policies" links={[{ href: "/contact", label: "Contact" }, { href: "/privacy", label: "Privacy" }, { href: "/terms", label: "Terms" }, { href: "/refund-policy", label: "Refunds & cancellation" }]} />}
        </div>
      </div>
      <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-2 border-t border-marketing-line pt-6 text-xs leading-5 text-marketing-slate sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 LostDeal AI.</p>
        <p>Recovery intelligence. Outreach stays in your hands.</p>
      </div>
    </footer>
  );
}

function FooterGroup({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return <nav aria-label={`${title} footer links`}><p className="mb-3 text-sm font-semibold text-marketing-ink">{title}</p><ul className="space-y-1">{links.map(link => <li key={link.href}><Link href={link.href} className="inline-flex min-h-11 items-center text-sm text-marketing-slate hover:text-marketing-ink hover:underline">{link.label}</Link></li>)}</ul></nav>;
}
