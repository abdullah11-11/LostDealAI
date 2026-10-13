import type { Metadata } from "next";
import { FeaturePage } from "@/components/marketing/feature-page";
import { StandardAnalysisVisual } from "@/components/marketing/product-visuals";
export const metadata: Metadata = { title: "Lost deal intelligence", description: "Understand loss reasons, buying intent and recovery context from imported evidence.", alternates: { canonical: "/lost-deal-intelligence" } };
export default function Page() { return <FeaturePage eyebrow="Lost deal intelligence" title="Make your lost pipeline easier to understand." description="Turn a supported CSV export into a workspace of readable deals, evidence-grounded loss reasons and a clearer next move." visual={<StandardAnalysisVisual />} points={[
  { title: "Start with your records", detail: "Review mapped fields, rejected rows and duplicates before importing. Your CRM remains your system of record." },
  { title: "Understand the loss", detail: "Standard Analysis separates the primary loss reason, intent and confidence. Source excerpts remain alongside saved conclusions." },
  { title: "See shared patterns", detail: "Overview and Insights show saved loss reasons and priority distributions, with counts and explicit denominators." },
]} caveat="Insights describe imported history. They do not establish causation or promise recovered revenue. Incomplete evidence limits what an analysis can conclude." next={{ href: "/deal-recovery", label: "Explore the recovery workflow" }} />; }
