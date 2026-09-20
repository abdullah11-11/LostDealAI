import { AI_CONFIG } from "@/lib/ai/config";
import {
  DeepDealAnalysisSchema,
  type DeepAnalysisDetails,
  type DeepAnalysisModelResult,
  type DeepDealAnalysis,
} from "@/lib/ai/deep-analysis-schema";
import {
  enforceFollowUpSafety,
  minimizeDealInput,
  type MinimizedDealInput,
  type TrustedDealSource,
} from "@/lib/ai/analyze-deal";
import type { DealAnalysis } from "@/lib/ai/deal-analysis-schema";
import { unsupportedNumericClaims } from "@/lib/ai/claim-grounding";
import {
  isSafeDeepAbsenceExplanation,
  normalizeDeepAnalysis,
  type DeepAbsenceDimension,
} from "@/lib/ai/deep-analysis-normalization";
import {
  DealAnalysisError,
  DeepSemanticValidationError,
  toDealAnalysisError,
  type DeepSemanticFailureClass,
} from "@/lib/ai/errors";
import { validateAndGroundEvidence } from "@/lib/ai/validate-evidence";

export type DeepAnalysisModelRunner = (input: MinimizedDealInput) => Promise<DeepAnalysisModelResult>;

export type CompletedDeepDealAnalysis = {
  analysis: DeepDealAnalysis;
  metadata: {
    analysis_mode: "DEEP";
    schema_version: typeof AI_CONFIG.deepSchemaVersion;
    prompt_version: typeof AI_CONFIG.deepPromptVersion;
    model: string;
    response_id: string | null;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    analyzed_at: string;
    source_characters: number;
    source_truncated: false;
  };
};

function coreAnalysis(analysis: DeepDealAnalysis): DealAnalysis {
  return {
    lost_reason: analysis.lost_reason,
    lost_reason_detail: analysis.lost_reason_detail,
    buying_intent_score: analysis.buying_intent_score,
    confidence_score: analysis.confidence_score,
    evidence: analysis.evidence,
    positive_signals: analysis.positive_signals,
    negative_signals: analysis.negative_signals,
    recommended_action: analysis.recommended_action,
    recommended_timing: analysis.recommended_timing,
    recommended_channel: analysis.recommended_channel,
    follow_up_message: analysis.follow_up_message,
  };
}

function normalizedSource(source: TrustedDealSource): string {
  return `${source.salesNotes ?? ""}\n${source.transcript ?? ""}`.toLocaleLowerCase("en-US");
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, output));
  return output;
}

const SENSITIVE_FACT_PATTERNS = [
  /\b(?:owns?|rents?) (?:a |the )?(?:home|property|building|vehicle|business)\b/i,
  /\b(?:works?|is employed) (?:at|by|for)\b/i,
  /\b(?:annual income|credit score|household income)\b/i,
  /\b(?:has|have|signed) (?:a |the )?(?:contract|appointment|installation date)\b/i,
  /\b(?:married|divorced|has children|has a family)\b/i,
];

function assertSensitiveFactsSupported(deepText: string, sourceText: string): void {
  for (const pattern of SENSITIVE_FACT_PATTERNS) {
    if (pattern.test(deepText) && !pattern.test(sourceText)) {
      throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "unsupported_factual_claim");
    }
  }
}

function assertEvidenceIndices(indices: readonly number[], evidenceCount: number): void {
  if (new Set(indices).size !== indices.length || indices.some((index) => index >= evidenceCount)) {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "evidence_index_failure");
  }
}

function semanticInvalid(failureClass: DeepSemanticFailureClass): never {
  throw new DeepSemanticValidationError(failureClass);
}

function assertCategoryEvidenceConsistency(
  dimension: DeepAbsenceDimension,
  absenceCategory: boolean,
  explanation: string,
  evidenceIndices: readonly number[],
  failureClass: DeepSemanticFailureClass,
): void {
  const safeAbsence = isSafeDeepAbsenceExplanation(dimension, explanation);
  if (evidenceIndices.length === 0) {
    if (!absenceCategory || !safeAbsence) semanticInvalid(failureClass);
    return;
  }
  if (absenceCategory) semanticInvalid(failureClass);
}

function referencedEvidenceText(indices: readonly number[], analysis: DealAnalysis): string {
  return indices.map((index) => analysis.evidence[index]?.excerpt ?? "").join(" ");
}

const COMPETITOR_GENERIC_WORDS = new Set([
  "another", "available", "buyer", "cheaper", "chose", "company", "comparison",
  "competitor", "customer", "deal", "evidence", "incumbent", "insufficient", "lost",
  "applicable", "meaningful", "none", "not", "other", "price", "proposal", "provider",
  "selected", "source", "the", "there", "this", "vendor", "with",
]);

function probableCompetitorNames(value: string): string[] {
  const matches = [
    ...(value.match(/\b[A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,})+\b/g) ?? []),
    ...(value.match(/\b[A-Z][A-Za-z0-9&.-]{2,}\s+(?:Inc|LLC|Ltd|Limited|Corp|Corporation|Company)\b/g) ?? []),
    ...(value.match(/(?:named|chose|selected|went with|from)\s+([A-Z][A-Za-z0-9&.-]{2,})/g) ?? [])
      .map((match) => match.split(/\s+/).at(-1) ?? ""),
  ];
  return Array.from(new Set(matches.filter((candidate) => (
    candidate
      && candidate.toLocaleLowerCase("en-US").split(/\s+/)
        .some((word) => !COMPETITOR_GENERIC_WORDS.has(word))
  ))));
}

function assertCompetitorNamesSupported(
  deep: DeepAnalysisDetails,
  sourceText: string,
  requireNamedCompetitor: boolean,
): void {
  const explanation = deep.competitor_dynamics.explanation;
  const names = Array.from(new Set(collectStrings(deep).flatMap(probableCompetitorNames)));
  if (names.some((candidate) => !sourceText.includes(candidate.toLocaleLowerCase("en-US")))) {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "unsupported_competitor_claim");
  }
  if (
    requireNamedCompetitor
    && deep.competitor_dynamics.category === "NAMED_COMPETITOR"
    && probableCompetitorNames(explanation).length === 0
  ) {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "unsupported_competitor_claim");
  }
}

function assertCriticalDeepClaimsSupported(
  deep: DeepAnalysisDetails,
  source: TrustedDealSource,
  requireNamedCompetitor = false,
): void {
  const sourceText = normalizedSource(source);
  const deepText = collectStrings(deep).join(" ");
  if (/(ignore (?:all |any )?(?:previous|prior|system|developer) instructions|reveal (?:the )?(?:api key|system prompt)|follow the instructions inside)/i.test(deepText)) {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "prompt_injection_output");
  }
  for (const unsupportedPsychology of ["secretly", "hidden motivation", "was lying", "lied about"]) {
    if (deepText.toLocaleLowerCase("en-US").includes(unsupportedPsychology) && !sourceText.includes(unsupportedPsychology)) {
      throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "unsupported_psychological_claim");
    }
  }
  assertSensitiveFactsSupported(deepText, sourceText);
  const trustedNumericText = [
    source.salesNotes ?? "",
    source.transcript ?? "",
    source.quoteDate ?? "",
    `$${source.dealValue}`,
    `USD ${source.dealValue}`,
  ].join("\n");
  if (unsupportedNumericClaims(deepText, trustedNumericText).length > 0) {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "unsupported_numeric_claim");
  }
  assertCompetitorNamesSupported(deep, sourceText, requireNamedCompetitor);
}

function assertGroundedDeepDetails(
  deep: DeepAnalysisDetails,
  analysis: DealAnalysis,
  source: TrustedDealSource,
): void {
  if (deep.primary_blocker.reason !== analysis.lost_reason) {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "blocker_mismatch");
  }

  const secondaryReasons = deep.secondary_blockers.map((blocker) => blocker.reason);
  if (secondaryReasons.includes(analysis.lost_reason)) semanticInvalid("primary_secondary_overlap");
  if (new Set(secondaryReasons).size !== secondaryReasons.length) {
    semanticInvalid("duplicate_secondary_blocker");
  }

  const objectionReasons = deep.objection_hierarchy.map((objection) => objection.reason);
  if (new Set(objectionReasons).size !== objectionReasons.length) {
    semanticInvalid("duplicate_objection_reason");
  }

  const evidenceCollections: readonly (readonly number[])[] = [
    deep.primary_blocker.evidence_indices,
    ...deep.secondary_blockers.map((item) => item.evidence_indices),
    deep.recovery_thesis.evidence_indices,
    deep.customer_readiness.evidence_indices,
    ...deep.objection_hierarchy.map((item) => item.evidence_indices),
    deep.decision_dynamics.evidence_indices,
    deep.timing_interpretation.evidence_indices,
    deep.price_value_interpretation.evidence_indices,
    deep.competitor_dynamics.evidence_indices,
    deep.recovery_strategy.evidence_indices,
    deep.recovery_risk.evidence_indices,
    deep.margin_discount_caution.evidence_indices,
    deep.follow_up_strategy.evidence_indices,
  ];
  evidenceCollections.forEach((indices) => assertEvidenceIndices(indices, analysis.evidence.length));

  const weak = analysis.evidence.length === 0;
  if (weak) {
    const cautiousText = collectStrings(deep).join(" ");
    if (
      analysis.lost_reason !== "OTHER"
      || analysis.confidence_score > 35
      || deep.secondary_blockers.length > 0
      || deep.objection_hierarchy.length > 0
      || !/(insufficient|cannot determine|human review|no supported)/i.test(cautiousText)
    ) semanticInvalid("weak_evidence_contract");
  } else {
    const requiredGrounding = [
      deep.primary_blocker.evidence_indices,
      deep.recovery_thesis.evidence_indices,
      deep.customer_readiness.evidence_indices,
      deep.recovery_strategy.evidence_indices,
      deep.recovery_risk.evidence_indices,
      deep.follow_up_strategy.evidence_indices,
    ];
    if (requiredGrounding.some((indices) => indices.length === 0)) {
      throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "evidence_index_failure");
    }
  }

  if (deep.decision_dynamics.evidence_indices.length === 0) {
    if (deep.decision_dynamics.explanation !== "No supported decision-maker issue identified.") {
      throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "unsupported_decision_maker_claim");
    }
  } else if (!/(decision[ -]?maker|approv|authority|procurement|spouse|partner|manager|committee|board|sign[ -]?off)/i.test(
    referencedEvidenceText(deep.decision_dynamics.evidence_indices, analysis),
  )) {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "unsupported_decision_maker_claim");
  }
  assertCategoryEvidenceConsistency(
    "timing",
    deep.timing_interpretation.category === "INSUFFICIENT_EVIDENCE",
    deep.timing_interpretation.explanation,
    deep.timing_interpretation.evidence_indices,
    "timing_category_evidence_mismatch",
  );
  assertCategoryEvidenceConsistency(
    "price_value",
    deep.price_value_interpretation.category === "INSUFFICIENT_EVIDENCE",
    deep.price_value_interpretation.explanation,
    deep.price_value_interpretation.evidence_indices,
    "price_value_category_evidence_mismatch",
  );
  assertCategoryEvidenceConsistency(
    "competitor",
    deep.competitor_dynamics.category === "NO_MEANINGFUL_EVIDENCE",
    deep.competitor_dynamics.explanation,
    deep.competitor_dynamics.evidence_indices,
    "competitor_category_evidence_mismatch",
  );
  assertCategoryEvidenceConsistency(
    "discount",
    deep.margin_discount_caution.assessment === "UNSUPPORTED_BY_EVIDENCE",
    deep.margin_discount_caution.explanation,
    deep.margin_discount_caution.evidence_indices,
    "discount_category_evidence_mismatch",
  );

  assertCriticalDeepClaimsSupported(deep, source, true);

  if (deep.competitor_dynamics.category !== "NO_MEANINGFUL_EVIDENCE") {
    const evidenceText = referencedEvidenceText(deep.competitor_dynamics.evidence_indices, analysis);
    if (!/(another (?:company|provider|vendor)|competitor|incumbent|alternative|other (?:bid|quote|proposal)|selected|chose)/i.test(evidenceText)) {
      throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "unsupported_competitor_claim");
    }
  }
}

export async function analyzeDeepDeal(
  source: TrustedDealSource,
  runModel: DeepAnalysisModelRunner,
): Promise<CompletedDeepDealAnalysis> {
  const sourceCharacters = (source.salesNotes?.trim().length ?? 0) + (source.transcript?.trim().length ?? 0);
  if (sourceCharacters > AI_CONFIG.deepSourceCharacterLimit) {
    throw new DealAnalysisError("SOURCE_TOO_LONG");
  }
  const minimized = minimizeDealInput(source, AI_CONFIG.deepSourceCharacterLimit);
  let attempts = 0;

  while (true) {
    try {
      const modelResult = await runModel(minimized.input);
      const parsed = DeepDealAnalysisSchema.safeParse(modelResult.analysis);
      if (!parsed.success) {
        throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "zod_validation_failure");
      }
      // Critical claims are checked before optional-field normalization so a
      // conservative repair can never erase a fabricated name, number,
      // sensitive fact, psychological claim, or prompt-injection response.
      assertCriticalDeepClaimsSupported(parsed.data.deep, source);
      const normalized = normalizeDeepAnalysis(parsed.data, source);
      const normalizedParsed = DeepDealAnalysisSchema.safeParse(normalized);
      if (!normalizedParsed.success) {
        throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "normalization_failure");
      }

      const proposedCore = coreAnalysis(normalizedParsed.data);
      const groundedCore = validateAndGroundEvidence(proposedCore, {
        salesNotes: minimized.input.sales_notes,
        transcript: minimized.input.transcript,
      });
      if (groundedCore.evidence.length !== proposedCore.evidence.length) {
        throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "evidence_grounding_failure");
      }
      const safeCore = enforceFollowUpSafety(groundedCore, source);
      assertGroundedDeepDetails(normalizedParsed.data.deep, safeCore, source);

      const analyzedAt = new Date().toISOString();
      return {
        analysis: { ...safeCore, deep: normalizedParsed.data.deep },
        metadata: {
          analysis_mode: "DEEP",
          schema_version: AI_CONFIG.deepSchemaVersion,
          prompt_version: AI_CONFIG.deepPromptVersion,
          model: modelResult.model,
          response_id: modelResult.responseId,
          ...(modelResult.usage ? {
            input_tokens: modelResult.usage.inputTokens,
            output_tokens: modelResult.usage.outputTokens,
            total_tokens: modelResult.usage.totalTokens,
          } : {}),
          analyzed_at: analyzedAt,
          source_characters: minimized.sourceCharacters,
          source_truncated: false,
        },
      };
    } catch (error) {
      const safeError = toDealAnalysisError(error);
      if (!safeError.retryable || attempts >= AI_CONFIG.maxAutomaticRetries) throw safeError;
      attempts += 1;
    }
  }
}
