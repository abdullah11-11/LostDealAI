import Link from "next/link";
import { Check, ArrowRight } from "lucide-react";
import { getFirstValueStep } from "@/lib/ui/onboarding";
import { Card } from "@/components/ui";

const steps = [
  { title: "Bring your lost deals", detail: "Import a CSV and review its fields before saving.", href: "/upload", action: "Import a CSV" },
  { title: "Understand one opportunity", detail: "Review a deal, then explicitly request its first analysis.", href: "/deals?analysis=pending", action: "Review pending deals" },
  { title: "Set your priorities", detail: "Calculate scores from saved signals, then open the queue.", href: "/deals?analysis=completed", action: "Review analyzed deals" },
];
export function GettingStarted({ totalDeals, analyzedDeals, scoredDeals }: { totalDeals: number; analyzedDeals: number; scoredDeals: number }) {
  const current = getFirstValueStep(totalDeals, analyzedDeals, scoredDeals);
  if (current === steps.length) return null;
  return <Card className="mt-6 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">Your first recovery workflow</h2><p className="text-xs text-secondary">{current} of 3 steps complete</p></div><ol className="mt-5 grid gap-5 md:grid-cols-3">{steps.map((step, index) => <li key={step.title} aria-current={index === current ? "step" : undefined} className="flex items-start gap-3"><span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${index < current ? "bg-emerald-500/10 text-success-content" : index === current ? "bg-brand text-on-brand" : "bg-panel-hover text-secondary"}`}>{index < current ? <Check aria-hidden="true" className="size-4" /> : index + 1}</span><div><h3 className="text-sm font-semibold">{step.title}</h3><p className="mt-1 text-sm leading-6 text-secondary">{step.detail}</p>{index === current && <Link href={step.href} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-content hover:underline">{step.action}<ArrowRight aria-hidden="true" className="size-4" /></Link>}</div></li>)}</ol><p className="mt-4 text-xs leading-5 text-secondary">Progress comes from saved workspace data and remains available when you return. No AI work starts automatically; your current plan controls availability.</p></Card>;
}
