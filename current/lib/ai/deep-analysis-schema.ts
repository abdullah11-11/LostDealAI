import { z } from "zod";

import { DealAnalysisSchema } from "@/lib/ai/deal-analysis-schema";
import { LOST_REASONS } from "@/types/database";

export const DEEP_EVIDENCE_INDEX_LIMIT = 3;

const EvidenceIndicesSchema = z.array(z.number().int().min(0).max(7)).max(DEEP_EVIDENCE_INDEX_LIMIT);

const GroundedExplanationSchema = z.object({
  explanation: z.string().min(1).max(420),
  evidence_indices: EvidenceIndicesSchema,
}).strict();

export const PrimaryBlockerSchema = z.object({
  reason: z.enum(LOST_REASONS),
  explanation: z.string().min(1).max(420),
  evidence_indices: EvidenceIndicesSchema,
}).strict();

export const SecondaryBlockerSchema = z.object({
  reason: z.enum(LOST_REASONS),
  explanation: z.string().min(1).max(320),
  evidence_indices: EvidenceIndicesSchema.min(1),
}).strict().describe("Optional supported secondary blocker. Use only direct evidence indices, keep reasons unique, and never repeat the primary blocker reason.");

export const RecoveryThesisSchema = GroundedExplanationSchema;

export const CustomerReadinessSchema = z.object({
  level: z.enum(["HIGH", "MEDIUM", "LOW"]),
  explanation: z.string().min(1).max(360),
  evidence_indices: EvidenceIndicesSchema,
}).strict();

export const ObjectionSchema = z.object({
  reason: z.enum(LOST_REASONS),
  explanation: z.string().min(1).max(260),
  evidence_indices: EvidenceIndicesSchema.min(1),
}).strict().describe("Optional supported objection. Use only direct evidence indices and keep objection reasons unique.");

export const DecisionDynamicsSchema = GroundedExplanationSchema;

export const TimingInterpretationSchema = z.object({
  category: z.enum([
    "IMMEDIATE_REENGAGEMENT",
    "NEAR_TERM_FOLLOW_UP",
    "EVENT_TRIGGERED_FOLLOW_UP",
    "LONG_TERM_NURTURE",
    "INSUFFICIENT_EVIDENCE",
  ]),
  explanation: z.string().min(1).max(360),
  evidence_indices: EvidenceIndicesSchema,
}).strict().describe("Optional timing interpretation. A positive category requires direct timing evidence. Otherwise use INSUFFICIENT_EVIDENCE, an empty evidence_indices array, and a source-scoped absence explanation.");

export const PriceValueInterpretationSchema = z.object({
  category: z.enum([
    "TRUE_AFFORDABILITY_BLOCKER",
    "FINANCING_OR_PAYMENT_STRUCTURE",
    "COMPETITOR_PRICE_PRESSURE",
    "PERCEIVED_VALUE_ISSUE",
    "PRICE_NOT_PRIMARY",
    "INSUFFICIENT_EVIDENCE",
  ]),
  explanation: z.string().min(1).max(360),
  evidence_indices: EvidenceIndicesSchema,
}).strict().describe("Optional price/value interpretation. A positive category requires direct price, affordability, financing, or value evidence. The existence of an estimate alone is not price evidence. Otherwise use INSUFFICIENT_EVIDENCE with evidence_indices [].");

export const CompetitorDynamicsSchema = z.object({
  category: z.enum([
    "NAMED_COMPETITOR",
    "CHEAPER_ALTERNATIVE",
    "INCUMBENT_PREFERENCE",
    "COMPARISON_SHOPPING",
    "NO_MEANINGFUL_EVIDENCE",
  ]),
  explanation: z.string().min(1).max(360),
  evidence_indices: EvidenceIndicesSchema,
}).strict().describe("Optional competitor interpretation. A positive category requires direct competitor evidence and named competitors must appear in the source. Otherwise use NO_MEANINGFUL_EVIDENCE with evidence_indices [].");

export const RecoveryStrategySchema = z.object({
  objective: z.string().min(1).max(240),
  recommended_angle: z.string().min(1).max(320),
  lead_with: z.string().min(1).max(260),
  avoid_leading_with: z.string().min(1).max(260),
  next_best_step: z.string().min(1).max(320),
  evidence_indices: EvidenceIndicesSchema,
}).strict();

export const RecoveryRiskSchema = z.object({
  level: z.enum(["HIGH", "MEDIUM", "LOW"]),
  explanation: z.string().min(1).max(360),
  evidence_indices: EvidenceIndicesSchema,
}).strict();

export const MarginDiscountCautionSchema = z.object({
  assessment: z.enum([
    "APPROPRIATE",
    "PREMATURE",
    "UNNECESSARY",
    "UNSUPPORTED_BY_EVIDENCE",
  ]),
  explanation: z.string().min(1).max(360),
  evidence_indices: EvidenceIndicesSchema,
}).strict().describe("Optional discount interpretation. A non-fallback assessment requires direct price or discount evidence. Otherwise use UNSUPPORTED_BY_EVIDENCE with evidence_indices [].");

export const DeepFollowUpStrategySchema = z.object({
  communication_objective: z.string().min(1).max(240),
  tone: z.string().min(1).max(140),
  key_point_to_address: z.string().min(1).max(260),
  key_point_to_avoid: z.string().min(1).max(260),
  recommended_sequence: z.array(z.string().min(1).max(240)).min(1).max(4),
  evidence_indices: EvidenceIndicesSchema,
}).strict();

export const DeepAnalysisDetailsSchema = z.object({
  primary_blocker: PrimaryBlockerSchema,
  secondary_blockers: z.array(SecondaryBlockerSchema).max(3),
  recovery_thesis: RecoveryThesisSchema,
  customer_readiness: CustomerReadinessSchema,
  objection_hierarchy: z.array(ObjectionSchema).max(4),
  decision_dynamics: DecisionDynamicsSchema,
  timing_interpretation: TimingInterpretationSchema,
  price_value_interpretation: PriceValueInterpretationSchema,
  competitor_dynamics: CompetitorDynamicsSchema,
  recovery_strategy: RecoveryStrategySchema,
  recovery_risk: RecoveryRiskSchema,
  margin_discount_caution: MarginDiscountCautionSchema,
  follow_up_strategy: DeepFollowUpStrategySchema,
}).strict();

export const DeepDealAnalysisSchema = DealAnalysisSchema.extend({
  deep: DeepAnalysisDetailsSchema,
}).strict();

export type DeepAnalysisDetails = z.infer<typeof DeepAnalysisDetailsSchema>;
export type DeepDealAnalysis = z.infer<typeof DeepDealAnalysisSchema>;

export type DeepAnalysisModelResult = {
  analysis: DeepDealAnalysis;
  responseId: string | null;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
};
