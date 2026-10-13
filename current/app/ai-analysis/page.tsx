import type { Metadata } from "next";
import { FeaturePage } from "@/components/marketing/feature-page";
import { DeepAnalysisVisual } from "@/components/marketing/product-visuals";
export const metadata: Metadata = { title: "Evidence-grounded AI analysis", description: "Standard explains the loss. Deep on Pro adds blockers, timing, risk and recovery strategy.", alternates: { canonical: "/ai-analysis" } };
export default function Page() { return <FeaturePage eyebrow="AI analysis" title="Understand the evidence. Then decide how deep to go." description="Standard gives each opportunity a clear explanation and next action. Deep on Pro adds a strategic assessment for deals that deserve closer attention." visual={<DeepAnalysisVisual />} points={[
  { title: "Standard clarity", detail: "Review loss reason, buying intent, confidence, recommended action and source excerpts in one saved report." },
  { title: "Deep context on Pro", detail: "Explore blockers, customer readiness, decision dynamics, price and value, timing, risk and an evidence-grounded recovery strategy." },
  { title: "Explicit execution", detail: "You choose when to analyze. Each successful Standard or Deep operation uses one AI analysis unit. Reading saved results uses none." },
]} caveat="AI can be wrong. Important source claims are validated against imported evidence; unsupported Deep interpretations fail closed or are safely downgraded. Human review is required before acting. No model runs just because you open a page." next={{ href: "/security", label: "Review data and security controls" }} />; }
