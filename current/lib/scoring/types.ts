import type { LostReason, RecommendedChannel, RecoveryPriority } from "@/types/database";

export type RecoveryScoreInput = {
  buyingIntentScore: number;
  confidenceScore: number;
  lostReason: LostReason;
  recommendedChannel: RecommendedChannel;
  evidenceCount: number;
  quoteDate: string | null;
  asOfDate: string;
};

export type ScoringCapCode =
  | "LOW_CONFIDENCE_20_CAP"
  | "LOW_CONFIDENCE_39_CAP"
  | "NO_EVIDENCE_CAP"
  | "NOT_QUALIFIED_CAP"
  | "NO_ACTION_CAP";

export type AppliedScoringCap = {
  code: ScoringCapCode;
  maximum: number;
  explanation: string;
  limitedScore: boolean;
};

export type RecoveryScoreBreakdown = {
  scoringVersion: string;
  asOfDate: string;
  buyingIntentScore: number;
  buyingIntentWeight: number;
  buyingIntentContribution: number;
  lostReason: LostReason;
  reasonRecoverability: number;
  reasonWeight: number;
  reasonContribution: number;
  quoteDate: string | null;
  quoteAgeDays: number | null;
  recencyScore: number;
  recencyWeight: number;
  recencyContribution: number;
  confidenceScore: number;
  confidenceMultiplier: number;
  rawScore: number;
  baseScore: number;
  preCapScore: number;
  appliedCaps: AppliedScoringCap[];
  notes: Array<"FUTURE_QUOTE_DATE">;
  recoveryScore: number;
  recoveryPriority: RecoveryPriority;
  scoreExplanation: string;
};

export type PersistedScoringMetadata = {
  version: string;
  calculated_at: string;
  as_of_date: string;
  buying_intent_score: number;
  buying_intent_weight: number;
  buying_intent_contribution: number;
  reason: LostReason;
  reason_recoverability: number;
  reason_weight: number;
  reason_contribution: number;
  quote_date: string | null;
  quote_age_days: number | null;
  recency_score: number;
  recency_weight: number;
  recency_contribution: number;
  confidence_score: number;
  confidence_multiplier: number;
  base_score: number;
  pre_cap_score: number;
  applied_caps: AppliedScoringCap[];
  notes: Array<"FUTURE_QUOTE_DATE">;
  final_score: number;
  priority: RecoveryPriority;
};

