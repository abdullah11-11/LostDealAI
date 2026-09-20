import type { DealAnalysis, DealEvidence } from "@/lib/ai/deal-analysis-schema";
import { evidenceTextContainsExcerpt, normalizeEvidenceText } from "@/lib/ai/evidence-grounding";
import { DealAnalysisError } from "@/lib/ai/errors";

export function isEvidenceGrounded(
  evidence: DealEvidence,
  source: { salesNotes: string | null; transcript: string | null },
): boolean {
  const sourceText = evidence.source === "SALES_NOTES" ? source.salesNotes : source.transcript;
  return evidenceTextContainsExcerpt(sourceText, evidence.excerpt);
}

export function validateAndGroundEvidence(
  analysis: DealAnalysis,
  source: { salesNotes: string | null; transcript: string | null },
): DealAnalysis {
  const grounded: DealEvidence[] = [];
  const seen = new Set<string>();
  let unsupported = 0;

  for (const evidence of analysis.evidence) {
    if (!isEvidenceGrounded(evidence, source)) {
      unsupported += 1;
      continue;
    }
    const excerpt = normalizeEvidenceText(evidence.excerpt);
    const key = `${evidence.source}:${excerpt.toLocaleLowerCase("en-US")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    grounded.push({ ...evidence, excerpt });
  }

  if (unsupported >= 2 || (analysis.evidence.length > 0 && grounded.length === 0)) {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "evidence_grounding_failure");
  }

  return { ...analysis, evidence: grounded };
}
