import { ChevronDown } from "lucide-react";

import { SectionHeading } from "@/components/marketing/marketing-primitives";
import { FAQ_ITEMS } from "@/lib/marketing/content";

export function FAQSection({ compact = false }: { compact?: boolean }) {
  const items = compact ? FAQ_ITEMS.slice(0, 6) : FAQ_ITEMS;
  return (
    <div>
      <SectionHeading
        eyebrow="Questions, answered"
        title="The practical details."
        description="What LostDeal does today, how it handles your data, and where each plan fits."
      />
      <div className="mt-10 grid gap-3 lg:grid-cols-2 lg:items-start">
        {items.map((item) => (
          <details key={item.question} className="group rounded-2xl border border-marketing-line bg-marketing-white open:border-marketing-orange/35">
            <summary className="flex min-h-16 list-none items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left text-sm font-extrabold text-marketing-ink transition-colors hover:bg-marketing-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marketing-orange [&::-webkit-details-marker]:hidden">
              <span>{item.question}</span>
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-marketing-orange-dark transition-transform group-open:rotate-180" />
            </summary>
            <p className="border-t border-marketing-line px-5 py-4 text-sm leading-6 text-marketing-slate">{item.answer}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
