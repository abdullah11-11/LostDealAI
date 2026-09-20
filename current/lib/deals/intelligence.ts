import type { DealPriority } from "@/lib/deals/constants";
import { evidenceTextContainsExcerpt } from "@/lib/ai/evidence-grounding";
import type { AppliedScoringCap, PersistedScoringMetadata } from "@/lib/scoring/types";
import { LOST_REASONS, RECOVERY_PRIORITIES } from "@/types/database";

export type DealExperienceState =
  | "pending"
  | "processing"
  | "failed"
  | "completed_unscored"
  | "completed_scored"
  | "no_action";

export type NormalizedScoringMetadata = Omit<PersistedScoringMetadata, "calculated_at"> & {
  calculated_at: string | null;
};

export function deriveDealExperienceState({
  analysisStatus,
  hasAnalysis,
  recoveryScore,
  recoveryPriority,
  recommendedChannel,
}: {
  analysisStatus: string;
  hasAnalysis: boolean;
  recoveryScore: number | null;
  recoveryPriority: DealPriority | null;
  recommendedChannel: string | null;
}): DealExperienceState {
  if (analysisStatus === "processing") return "processing";
  if (analysisStatus === "failed") return "failed";
  if (analysisStatus !== "completed") return "pending";
  if (!hasAnalysis) return "failed";
  if (recommendedChannel === "NO_ACTION") return "no_action";
  return recoveryScore === null || !recoveryPriority ? "completed_unscored" : "completed_scored";
}

const CAP_CODES = new Set([
  "LOW_CONFIDENCE_20_CAP",
  "LOW_CONFIDENCE_39_CAP",
  "NO_EVIDENCE_CAP",
  "NOT_QUALIFIED_CAP",
  "NO_ACTION_CAP",
]);
const LOST_REASON_VALUES = new Set<string>(LOST_REASONS);
const PRIORITY_VALUES = new Set<string>(RECOVERY_PRIORITIES);

function normalizeCaps(value: unknown): AppliedScoringCap[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const cap = item as Record<string, unknown>;
    if (
      typeof cap.code !== "string" ||
      !CAP_CODES.has(cap.code) ||
      typeof cap.maximum !== "number" ||
      !Number.isFinite(cap.maximum) ||
      typeof cap.explanation !== "string" ||
      typeof cap.limitedScore !== "boolean"
    ) return [];
    return [{
      code: cap.code as AppliedScoringCap["code"],
      maximum: cap.maximum,
      explanation: cap.explanation,
      limitedScore: cap.limitedScore,
    }];
  });
}

export function normalizeScoringMetadata(value: unknown): NormalizedScoringMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const requiredStrings = ["version", "as_of_date", "reason", "priority"] as const;
  const requiredNumbers = [
    "buying_intent_score",
    "buying_intent_weight",
    "buying_intent_contribution",
    "reason_recoverability",
    "reason_weight",
    "reason_contribution",
    "recency_score",
    "recency_weight",
    "recency_contribution",
    "confidence_score",
    "confidence_multiplier",
    "base_score",
    "pre_cap_score",
    "final_score",
  ] as const;
  if (
    requiredStrings.some((field) => typeof row[field] !== "string") ||
    requiredNumbers.some((field) => typeof row[field] !== "number" || !Number.isFinite(row[field])) ||
    !LOST_REASON_VALUES.has(row.reason as string) ||
    !PRIORITY_VALUES.has(row.priority as string)
  ) return null;

  return {
    version: row.version as string,
    calculated_at: typeof row.calculated_at === "string" ? row.calculated_at : null,
    as_of_date: row.as_of_date as string,
    buying_intent_score: row.buying_intent_score as number,
    buying_intent_weight: row.buying_intent_weight as number,
    buying_intent_contribution: row.buying_intent_contribution as number,
    reason: row.reason as PersistedScoringMetadata["reason"],
    reason_recoverability: row.reason_recoverability as number,
    reason_weight: row.reason_weight as number,
    reason_contribution: row.reason_contribution as number,
    quote_date: typeof row.quote_date === "string" ? row.quote_date : null,
    quote_age_days: typeof row.quote_age_days === "number" && Number.isFinite(row.quote_age_days) ? row.quote_age_days : null,
    recency_score: row.recency_score as number,
    recency_weight: row.recency_weight as number,
    recency_contribution: row.recency_contribution as number,
    confidence_score: row.confidence_score as number,
    confidence_multiplier: row.confidence_multiplier as number,
    base_score: row.base_score as number,
    pre_cap_score: row.pre_cap_score as number,
    applied_caps: normalizeCaps(row.applied_caps),
    notes: Array.isArray(row.notes)
      ? row.notes.filter((note): note is "FUTURE_QUOTE_DATE" => note === "FUTURE_QUOTE_DATE")
      : [],
    final_score: row.final_score as number,
    priority: row.priority as PersistedScoringMetadata["priority"],
  };
}

export function evidenceIsGrounded(
  source: "SALES_NOTES" | "TRANSCRIPT",
  excerpt: string,
  salesNotes: string | null,
  transcript: string | null,
): boolean {
  const sourceText = source === "SALES_NOTES" ? salesNotes : transcript;
  return evidenceTextContainsExcerpt(sourceText, excerpt);
}
