import Link from "next/link";

import { BrandLogo } from "@/components/brand-logo";
import { MARKETING_NAVIGATION } from "@/lib/marketing/content";

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
        <nav aria-label="Footer navigation" className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-bold text-marketing-slate sm:justify-end">
          {MARKETING_NAVIGATION.slice(0, 3).map((item) => (
            <Link key={item.label} href={item.href} className="hover:text-marketing-ink">{item.label}</Link>
          ))}
          <Link href="/login" className="hover:text-marketing-ink">Sign In</Link>
        </nav>
      </div>
      <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-2 border-t border-marketing-line pt-6 text-xs leading-5 text-marketing-slate sm:flex-row sm:items-center sm:justify-between">
        <p>© 2026 LostDeal AI.</p>
        <p>Recovery intelligence. Outreach stays in your hands.</p>
      </div>
    </footer>
  );
}
