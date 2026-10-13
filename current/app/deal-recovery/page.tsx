import type { Metadata } from "next";
import { FeaturePage } from "@/components/marketing/feature-page";
import { RecoveryScoreVisual } from "@/components/marketing/product-visuals";
export const metadata: Metadata = { title: "Deal recovery workflow", description: "Prioritize saved opportunities and review recommended actions in a focused recovery queue.", alternates: { canonical: "/deal-recovery" } };
export default function Page() { return <FeaturePage eyebrow="Deal recovery" title="Give your next follow-up a better starting point." description="A focused queue brings saved priorities, quoted deal value and recommended actions into one place. Your team chooses what happens next." visual={<RecoveryScoreVisual />} points={[
  { title: "Rank consistently", detail: "An explicit scoring action calculates a deterministic Recovery Score from saved signals. Scoring does not use an AI analysis unit." },
  { title: "Review the queue", detail: "Filter High, Medium or Low priority, search for a customer and open the saved deal report for evidence and context." },
  { title: "Choose the next move", detail: "Review the suggested action, timing and channel against the original notes. Deep Analysis adds strategic context on Pro." },
]} caveat="Recovery Score is a prioritization indicator, not conversion probability or expected revenue. Timing recommendations are interpretations, not scheduled tasks. LostDeal does not send outreach or sync a CRM automatically." next={{ href: "/ai-analysis", label: "See Standard and Deep Analysis" }} />; }
