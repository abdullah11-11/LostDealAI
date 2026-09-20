import type { ReactNode } from "react";

import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingHeader } from "@/components/marketing/marketing-header";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="marketing-surface min-h-screen overflow-x-clip bg-marketing-ivory text-marketing-ink">
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[60] -translate-y-24 rounded-full bg-marketing-ink px-4 py-2 text-sm font-bold text-white transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
}
