import type { TrustedDealSource } from "@/lib/ai/analyze-deal";
import {
  DEEP_EVIDENCE_INDEX_LIMIT,
  type DeepAnalysisDetails,
  type DeepDealAnalysis,
} from "@/lib/ai/deep-analysis-schema";
import { normalizeEvidenceText } from "@/lib/ai/evidence-grounding";
import { DealAnalysisError } from "@/lib/ai/errors";
import { isEvidenceGrounded } from "@/lib/ai/validate-evidence";

export const CANONICAL_NO_DECISION_MAKER = "No supported decision-maker issue identified.";

function invalid(category: ConstructorParameters<typeof DealAnalysisError>[2]): never {
  throw new DealAnalysisError("AI_RESPONSE_INVALID", false, category);
}

function compactText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function semanticText(value: string): string {
  return compactText(value)
    .toLocaleLowerCase("en-US")
    .replace(/[–—\/-]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type DeepAbsenceDimension = "timing" | "price_value" | "competitor" | "discount";

export const DEEP_FIELD_SAFETY_CLASSIFICATION = Object.freeze({
  core_lost_reason: "CRITICAL",
  core_evidence: "CRITICAL",
  core_buying_intent: "CRITICAL",
  core_confidence: "CRITICAL",
  primary_blocker: "CRITICAL",
  recovery_thesis: "CRITICAL",
  customer_readiness: "CRITICAL",
  decision_dynamics: "CRITICAL",
  recovery_strategy: "CRITICAL",
  recovery_risk: "CRITICAL",
  follow_up_strategy: "CRITICAL",
  secondary_blockers: "OPTIONAL_REPAIRABLE",
  objection_hierarchy: "OPTIONAL_REPAIRABLE",
  timing_interpretation: "OPTIONAL_REPAIRABLE",
  price_value_interpretation: "OPTIONAL_REPAIRABLE",
  competitor_dynamics: "OPTIONAL_REPAIRABLE",
  margin_discount_caution: "OPTIONAL_REPAIRABLE",
} as const);

export const CANONICAL_DEEP_OPTIONAL_FALLBACKS = Object.freeze({
  timing: Object.freeze({
    category: "INSUFFICIENT_EVIDENCE" as const,
    explanation: "Insufficient source evidence to determine a timing factor.",
    evidence_indices: [] as number[],
  }),
  price_value: Object.freeze({
    category: "INSUFFICIENT_EVIDENCE" as const,
    explanation: "Insufficient source evidence to determine a price or value factor.",
    evidence_indices: [] as number[],
  }),
  competitor: Object.freeze({
    category: "NO_MEANINGFUL_EVIDENCE" as const,
    explanation: "No meaningful source evidence identifies competitor involvement.",
    evidence_indices: [] as number[],
  }),
  discount: Object.freeze({
    assessment: "UNSUPPORTED_BY_EVIDENCE" as const,
    explanation: "Insufficient source evidence to support a discount assessment.",
    evidence_indices: [] as number[],
  }),
});

const ABSENCE_DIMENSION_PATTERNS: Record<DeepAbsenceDimension, RegExp> = {
  timing: /\b(?:timing|timeframe|schedule|scheduling|date|deadline|urgency|follow ?up|event|trigger)\b/,
  price_value: /\b(?:price|pricing|value|cost|budget|affordability|financing|payment)\b/,
  competitor: /\b(?:competitor|provider|vendor|bid|quote|alternative|company|incumbent|comparison)\b/,
  discount: /\b(?:discount|discounting|price|pricing|value|margin|reduction|concession)\b/,
};

const ABSENCE_CONTEXT_PATTERN = /\b(?:evidence|source|record|notes?|information|context|support|supported|identify|identified|state|stated|mention|mentioned|document|documented|show|shown|available|determine|establish|provided|recorded)\b/;
const ABSENCE_CLAUSE_BOUNDARY_PATTERN = /(?:[.!?;:,]+|\b(?:even though|and|but|however|although|though|yet|whereas|while|because|therefore|thus|instead|despite|so)\b)/i;
const UNSAFE_POSITIVE_ASSERTION_PATTERN = /\b(?:chose|chosen|selected|preferred|bought|purchased|signed|accepted|rejected|decided|switched|hired|committed|cancelled|canceled|won|afford|affordable|unaffordable|caused|drove|resulted|blocked|prevented)\b|\bled to\b|\btoo expensive\b|\b(?:clearly|definitely|probably|obviously|certainly)\b|\b(?:will|would|could)\b.{0,80}\b(?:recover|win|close|convert)\b|(?:\$\s*\d|\b\d+(?:\.\d+)?\s*%)/;
const SCOPE_SUBJECT_PATTERN = /^(?:the )?(?:available |current )?(?:source|record|evidence|notes?|information|context)\b/;
const SAFE_FRAGMENT_WORDS = new Set([
  "a", "an", "the", "available", "current", "source", "record", "evidence",
  "note", "notes", "information", "context", "timing", "timeframe", "schedule",
  "scheduling", "date", "deadline", "urgency", "follow", "up", "event", "trigger",
  "price", "pricing", "value", "cost", "budget", "affordability", "financing",
  "payment", "competitor", "provider", "vendor", "bid", "quote", "alternative",
  "company", "incumbent", "comparison", "discount", "discounting", "margin",
  "reduction", "concession",
]);

function splitAbsenceClauses(value: string): string[] {
  return compactText(value)
    .toLocaleLowerCase("en-US")
    .split(ABSENCE_CLAUSE_BOUNDARY_PATTERN)
    .map((clause) => semanticText(clause).replace(/^(?:it )?also\s+/, ""))
    .filter(Boolean);
}

function isHarmlessClauseFragment(clause: string): boolean {
  const words = clause.split(" ").filter(Boolean);
  return words.length > 0
    && words.length <= 4
    && words.every((word) => SAFE_FRAGMENT_WORDS.has(word));
}

function isSafeAbsenceClause(dimension: DeepAbsenceDimension, clause: string): boolean {
  if (UNSAFE_POSITIVE_ASSERTION_PATTERN.test(clause)) return false;

  const hasDimension = ABSENCE_DIMENSION_PATTERNS[dimension].test(clause);
  const hasContext = ABSENCE_CONTEXT_PATTERN.test(clause);
  if (isHarmlessClauseFragment(clause)) return true;

  if (
    /^(?:there (?:is|are|was|were) )?(?:no|insufficient|limited|not enough)\b/.test(clause)
    && (hasDimension || hasContext)
  ) return true;
  if (/^(?:nothing|neither)\b/.test(clause) && (hasDimension || hasContext)) return true;
  if (/^(?:a |the )?(?:lack|absence) of\b/.test(clause) && (hasDimension || hasContext)) return true;
  if (/^(?:provides?|contains?|shows?|offers?|gives?) no\b/.test(clause) && (hasDimension || hasContext)) return true;

  if (
    SCOPE_SUBJECT_PATTERN.test(clause)
    && /\b(?:does not|doesnt|do not|did not|didnt|cannot|can not|lacks?|provides? no|contains? no|shows? no|offers? no|gives? no|is silent|are silent)\b/.test(clause)
  ) return true;
  if (
    SCOPE_SUBJECT_PATTERN.test(clause)
    && /\b(?:only|merely)\s+(?:documents?|records?|shows?|states?|mentions?|identifies?|provides?)\b/.test(clause)
  ) return true;
  if (
    /^(?:the )?(?:customer|buyer|homeowner|client|they|he|she)\b/.test(clause)
    && /\b(?:does not|doesnt|do not|did not|didnt)\b.*\b(?:mention|state|identify|raise|cite|name|discuss|provide|indicate|document)\b/.test(clause)
    && hasDimension
  ) return true;

  if (
    /\b(?:cannot|can not) be (?:determined|identified|established|supported|confirmed|assessed|inferred|justified)\b/.test(clause)
    && (hasDimension || hasContext)
  ) return true;
  if (
    /\b(?:is|are|was|were|remains?) (?:insufficient|unsupported|absent|unavailable|unknown|unclear|not (?:currently )?(?:a )?supported|not identified|not shown|not stated|not mentioned|not established|not evidenced|not evident|not addressed|not cited|not documented|not available)\b/.test(clause)
    && (hasDimension || hasContext)
  ) return true;
  if (
    /\b(?:does not|doesnt|did not|didnt) (?:appear|seem) to be (?:the |a )?(?:primary |direct |supported )?(?:reason|blocker|issue|factor|supported)\b/.test(clause)
    && (hasDimension || hasContext)
  ) return true;
  if (/\bhas no (?:evidence|support|basis)\b/.test(clause) && (hasDimension || hasContext)) return true;

  if (
    dimension === "discount"
    && /^(?:a |an )?(?:discount|discounting|price reduction|concession)\b.*\b(?:premature|unnecessary|unsupported|not justified|not supported)\b/.test(clause)
  ) return true;
  if (
    /^(?:it )?(?:is|would be) (?:premature|unsupported|speculative|unjustified) to (?:conclude|infer|assume|attribute|treat|classify)\b/.test(clause)
    && hasDimension
  ) return true;

  return false;
}

/**
 * Accept bounded natural wording only when every meaningful clause is an
 * absence or source-scoped caution. Punctuation and ordinary conjunctions are
 * syntax, not safety boundaries; any mixed positive assertion still fails.
 */
export function isSafeDeepAbsenceExplanation(
  dimension: DeepAbsenceDimension,
  value: string,
): boolean {
  const normalized = semanticText(value);
  if (!ABSENCE_DIMENSION_PATTERNS[dimension].test(normalized)) return false;
  const clauses = splitAbsenceClauses(value);
  return clauses.length > 0
    && clauses.every((clause) => isSafeAbsenceClause(dimension, clause))
    && clauses.some((clause) => (
      !isHarmlessClauseFragment(clause)
      && ABSENCE_DIMENSION_PATTERNS[dimension].test(clause)
    ));
}

type ReasonedDeepItem = {
  reason: string;
  explanation: string;
  evidence_indices: number[];
};

function collapseDuplicateReasons<T extends ReasonedDeepItem>(items: readonly T[]): T[] {
  const canonical: T[] = [];
  const canonicalIndexByReason = new Map<string, number>();

  for (const item of items) {
    const priorIndex = canonicalIndexByReason.get(item.reason);
    if (priorIndex === undefined) {
      canonicalIndexByReason.set(item.reason, canonical.length);
      canonical.push({ ...item, evidence_indices: [...item.evidence_indices] });
      continue;
    }

    const prior = canonical[priorIndex];
    const evidenceIndices = [...prior.evidence_indices];
    for (const index of item.evidence_indices) {
      if (!evidenceIndices.includes(index) && evidenceIndices.length < DEEP_EVIDENCE_INDEX_LIMIT) {
        evidenceIndices.push(index);
      }
    }
    // Keep the first explanation verbatim. Later same-reason paraphrases add no
    // claim text, so collapsing cannot introduce an unsupported assertion.
    canonical[priorIndex] = { ...prior, evidence_indices: evidenceIndices };
  }

  return canonical;
}

function includesAny(value: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => value.includes(phrase));
}

function referencedEvidenceText(
  indices: readonly number[],
  evidence: DeepDealAnalysis["evidence"],
): string {
  return semanticText(indices.map((index) => evidence[index]?.excerpt ?? "").join(" "));
}

function supportsTimingCategory(
  category: DeepAnalysisDetails["timing_interpretation"]["category"],
  evidenceText: string,
): boolean {
  if (category === "INSUFFICIENT_EVIDENCE") return false;
  if (category === "IMMEDIATE_REENGAGEMENT") {
    return includesAny(evidenceText, ["immediately", "as soon as possible", "asap", "urgent", "right away", "ready now"]);
  }
  if (category === "NEAR_TERM_FOLLOW_UP") {
    return includesAny(evidenceText, ["few days", "several days", "next week", "this week", "check back", "follow up", "soon"]);
  }
  if (category === "EVENT_TRIGGERED_FOLLOW_UP") {
    return includesAny(evidenceText, ["after the", "after ", "before the", "before ", "once ", "when ", "event", "trigger", "revisit afterward"]);
  }
  return includesAny(evidenceText, ["next month", "months", "next year", "long term", "later this year", "next season", "next quarter"]);
}

function supportsPriceValueCategory(
  category: DeepAnalysisDetails["price_value_interpretation"]["category"],
  evidenceText: string,
): boolean {
  if (category === "INSUFFICIENT_EVIDENCE") return false;
  if (category === "TRUE_AFFORDABILITY_BLOCKER") {
    return includesAny(evidenceText, ["cannot afford", "cant afford", "could not afford", "couldnt afford", "unaffordable", "over budget", "budget limit", "monthly affordability", "too expensive"]);
  }
  if (category === "FINANCING_OR_PAYMENT_STRUCTURE") {
    return includesAny(evidenceText, ["financing", "finance", "monthly payment", "payment plan", "payment structure", "loan", "credit approval"]);
  }
  if (category === "COMPETITOR_PRICE_PRESSURE") {
    return includesAny(evidenceText, ["competitor", "another provider", "another company", "other quote", "other bid", "alternative"])
      && includesAny(evidenceText, ["cheaper", "lower price", "lower quote", "lower bid", "price", "cost"]);
  }
  if (category === "PERCEIVED_VALUE_ISSUE") {
    return includesAny(evidenceText, ["higher than expected", "too high", "price concern", "pricing concern", "cost concern", "value concern", "not worth", "worth the", "warranty", "material breakdown"]);
  }
  return includesAny(evidenceText, [
    "price was not the issue", "price is not the issue", "cost was not the issue",
    "cost is not the issue", "not because of price", "not due to price",
    "price was acceptable", "price is acceptable", "quote was acceptable",
    "price was fine", "cost was fine", "budget was not a concern",
  ]);
}

function supportsCompetitorCategory(
  category: DeepAnalysisDetails["competitor_dynamics"]["category"],
  evidenceText: string,
): boolean {
  if (category === "NO_MEANINGFUL_EVIDENCE") return false;
  if (category === "CHEAPER_ALTERNATIVE") {
    return includesAny(evidenceText, ["another provider", "another company", "competitor", "other quote", "other bid", "alternative"])
      && includesAny(evidenceText, ["cheaper", "lower price", "lower quote", "lower bid", "less expensive"]);
  }
  if (category === "INCUMBENT_PREFERENCE") {
    return includesAny(evidenceText, ["incumbent", "existing provider", "current provider", "usual provider", "preferred provider"]);
  }
  if (category === "COMPARISON_SHOPPING") {
    return includesAny(evidenceText, ["comparing", "comparison", "multiple quotes", "other quote", "other bid", "shopping around", "alternatives"]);
  }
  return includesAny(evidenceText, ["chose", "selected", "went with", "hired", "competitor", "another provider", "another company", "vendor"]);
}

function supportsDiscountAssessment(evidenceText: string): boolean {
  return includesAny(evidenceText, [
    "discount", "discounting", "price reduction", "concession", "lower price",
    "price concern", "pricing concern", "cost concern", "higher than expected",
    "too high", "too expensive", "over budget", "cannot afford", "cant afford",
  ]);
}

function needsOptionalFallback(
  dimension: DeepAbsenceDimension,
  absenceCategory: boolean,
  explanation: string,
  evidenceIndices: readonly number[],
  evidenceSupportsCategory: boolean,
  invalidEvidence: ReadonlySet<DeepAbsenceDimension>,
  supportedCautionWording = false,
): boolean {
  return invalidEvidence.has(dimension)
    || absenceCategory
    || evidenceIndices.length === 0
    || (isSafeDeepAbsenceExplanation(dimension, explanation) && !supportedCautionWording)
    || !evidenceSupportsCategory;
}

function repairOptionalInterpretations(
  deep: DeepAnalysisDetails,
  evidence: DeepDealAnalysis["evidence"],
  invalidEvidence: ReadonlySet<DeepAbsenceDimension>,
): DeepAnalysisDetails {
  const normalized = { ...deep };

  const timingEvidence = referencedEvidenceText(deep.timing_interpretation.evidence_indices, evidence);
  const priceValueEvidence = referencedEvidenceText(deep.price_value_interpretation.evidence_indices, evidence);
  const competitorEvidence = referencedEvidenceText(deep.competitor_dynamics.evidence_indices, evidence);
  const discountEvidence = referencedEvidenceText(deep.margin_discount_caution.evidence_indices, evidence);

  if (
    needsOptionalFallback(
      "timing",
      deep.timing_interpretation.category === "INSUFFICIENT_EVIDENCE",
      deep.timing_interpretation.explanation,
      deep.timing_interpretation.evidence_indices,
      supportsTimingCategory(deep.timing_interpretation.category, timingEvidence),
      invalidEvidence,
    )
  ) {
    normalized.timing_interpretation = {
      ...CANONICAL_DEEP_OPTIONAL_FALLBACKS.timing,
      evidence_indices: [],
    };
  }
  if (
    needsOptionalFallback(
      "price_value",
      deep.price_value_interpretation.category === "INSUFFICIENT_EVIDENCE",
      deep.price_value_interpretation.explanation,
      deep.price_value_interpretation.evidence_indices,
      supportsPriceValueCategory(deep.price_value_interpretation.category, priceValueEvidence),
      invalidEvidence,
      deep.price_value_interpretation.category === "PRICE_NOT_PRIMARY",
    )
  ) {
    normalized.price_value_interpretation = {
      ...CANONICAL_DEEP_OPTIONAL_FALLBACKS.price_value,
      evidence_indices: [],
    };
  }
  if (
    needsOptionalFallback(
      "competitor",
      deep.competitor_dynamics.category === "NO_MEANINGFUL_EVIDENCE",
      deep.competitor_dynamics.explanation,
      deep.competitor_dynamics.evidence_indices,
      supportsCompetitorCategory(deep.competitor_dynamics.category, competitorEvidence),
      invalidEvidence,
    )
  ) {
    normalized.competitor_dynamics = {
      ...CANONICAL_DEEP_OPTIONAL_FALLBACKS.competitor,
      evidence_indices: [],
    };
  }
  if (
    needsOptionalFallback(
      "discount",
      deep.margin_discount_caution.assessment === "UNSUPPORTED_BY_EVIDENCE",
      deep.margin_discount_caution.explanation,
      deep.margin_discount_caution.evidence_indices,
      supportsDiscountAssessment(discountEvidence),
      invalidEvidence,
      deep.margin_discount_caution.assessment === "PREMATURE"
        || deep.margin_discount_caution.assessment === "UNNECESSARY",
    )
  ) {
    normalized.margin_discount_caution = {
      ...CANONICAL_DEEP_OPTIONAL_FALLBACKS.discount,
      evidence_indices: [],
    };
  }

  return normalized;
}

function isSafeNoDecisionMakerWording(value: string): boolean {
  const normalized = semanticText(value);
  if (!normalized.includes("decision maker")) return false;
  return [
    /^(?:there is )?no supported decision maker (?:issue|blocker|concern|dynamic)s?(?: identified)?$/,
    /^(?:there is )?no (?:source |available )?evidence (?:that )?(?:supports?|identifies?|indicates?|shows?|establishes?) (?:a |any )?decision maker (?:issue|blocker|concern|dynamic)s?$/,
    /^no decision maker (?:issue|blocker|concern|dynamic)s? (?:is|are|was|were) (?:supported|identified|indicated|shown|established) by (?:the )?(?:available )?(?:source|record|evidence|source evidence)$/,
    /^(?:the )?(?:available |current )?(?:source|record|evidence|source evidence) (?:does not|doesnt|do not) (?:support|identify|indicate|show|establish) (?:a |any )?decision maker (?:issue|blocker|concern|dynamic)s?$/,
    /^(?:the )?(?:source|record|evidence) provides no (?:evidence of|support for) (?:a |any )?decision maker (?:issue|blocker|concern|dynamic)s?$/,
    /^(?:there is )?insufficient (?:source |available )?evidence to (?:support|identify|indicate|show|establish|determine) (?:a |any )?decision maker (?:issue|blocker|concern|dynamic)s?$/,
    /^no evidence of (?:a |any )?decision maker (?:issue|blocker|concern|dynamic)s? (?:is|was) (?:present|found|identified|available)$/,
  ].some((pattern) => pattern.test(normalized));
}

function remapIndices(
  indices: readonly number[],
  oldToNew: ReadonlyMap<number, number>,
): number[] {
  const mapped: number[] = [];
  for (const index of indices) {
    const canonical = oldToNew.get(index);
    if (canonical === undefined) invalid("evidence_index_failure");
    if (!mapped.includes(canonical)) mapped.push(canonical);
  }
  return mapped;
}

function normalizeDeepStrings(deep: DeepAnalysisDetails): DeepAnalysisDetails {
  return {
    primary_blocker: {
      ...deep.primary_blocker,
      explanation: compactText(deep.primary_blocker.explanation),
    },
    secondary_blockers: deep.secondary_blockers.map((item) => ({
      ...item,
      explanation: compactText(item.explanation),
    })),
    recovery_thesis: {
      ...deep.recovery_thesis,
      explanation: compactText(deep.recovery_thesis.explanation),
    },
    customer_readiness: {
      ...deep.customer_readiness,
      explanation: compactText(deep.customer_readiness.explanation),
    },
    objection_hierarchy: deep.objection_hierarchy.map((item) => ({
      ...item,
      explanation: compactText(item.explanation),
    })),
    decision_dynamics: {
      ...deep.decision_dynamics,
      explanation: compactText(deep.decision_dynamics.explanation),
    },
    timing_interpretation: {
      ...deep.timing_interpretation,
      explanation: compactText(deep.timing_interpretation.explanation),
    },
    price_value_interpretation: {
      ...deep.price_value_interpretation,
      explanation: compactText(deep.price_value_interpretation.explanation),
    },
    competitor_dynamics: {
      ...deep.competitor_dynamics,
      explanation: compactText(deep.competitor_dynamics.explanation),
    },
    recovery_strategy: {
      ...deep.recovery_strategy,
      objective: compactText(deep.recovery_strategy.objective),
      recommended_angle: compactText(deep.recovery_strategy.recommended_angle),
      lead_with: compactText(deep.recovery_strategy.lead_with),
      avoid_leading_with: compactText(deep.recovery_strategy.avoid_leading_with),
      next_best_step: compactText(deep.recovery_strategy.next_best_step),
    },
    recovery_risk: {
      ...deep.recovery_risk,
      explanation: compactText(deep.recovery_risk.explanation),
    },
    margin_discount_caution: {
      ...deep.margin_discount_caution,
      explanation: compactText(deep.margin_discount_caution.explanation),
    },
    follow_up_strategy: {
      ...deep.follow_up_strategy,
      communication_objective: compactText(deep.follow_up_strategy.communication_objective),
      tone: compactText(deep.follow_up_strategy.tone),
      key_point_to_address: compactText(deep.follow_up_strategy.key_point_to_address),
      key_point_to_avoid: compactText(deep.follow_up_strategy.key_point_to_avoid),
      recommended_sequence: deep.follow_up_strategy.recommended_sequence.map(compactText),
    },
  };
}

function remapDeepEvidence(
  deep: DeepAnalysisDetails,
  oldToNew: ReadonlyMap<number, number>,
): { deep: DeepAnalysisDetails; invalidOptionalEvidence: ReadonlySet<DeepAbsenceDimension> } {
  const remap = (indices: readonly number[]) => remapIndices(indices, oldToNew);
  const invalidOptionalEvidence = new Set<DeepAbsenceDimension>();
  const remapOptional = (dimension: DeepAbsenceDimension, indices: readonly number[]) => {
    const mapped: number[] = [];
    for (const index of indices) {
      const canonical = oldToNew.get(index);
      if (canonical === undefined) {
        invalidOptionalEvidence.add(dimension);
        return [];
      }
      if (!mapped.includes(canonical)) mapped.push(canonical);
    }
    return mapped;
  };
  return { deep: {
    ...deep,
    primary_blocker: { ...deep.primary_blocker, evidence_indices: remap(deep.primary_blocker.evidence_indices) },
    secondary_blockers: deep.secondary_blockers.map((item) => ({ ...item, evidence_indices: remap(item.evidence_indices) })),
    recovery_thesis: { ...deep.recovery_thesis, evidence_indices: remap(deep.recovery_thesis.evidence_indices) },
    customer_readiness: { ...deep.customer_readiness, evidence_indices: remap(deep.customer_readiness.evidence_indices) },
    objection_hierarchy: deep.objection_hierarchy.map((item) => ({ ...item, evidence_indices: remap(item.evidence_indices) })),
    decision_dynamics: { ...deep.decision_dynamics, evidence_indices: remap(deep.decision_dynamics.evidence_indices) },
    timing_interpretation: { ...deep.timing_interpretation, evidence_indices: remapOptional("timing", deep.timing_interpretation.evidence_indices) },
    price_value_interpretation: { ...deep.price_value_interpretation, evidence_indices: remapOptional("price_value", deep.price_value_interpretation.evidence_indices) },
    competitor_dynamics: { ...deep.competitor_dynamics, evidence_indices: remapOptional("competitor", deep.competitor_dynamics.evidence_indices) },
    recovery_strategy: { ...deep.recovery_strategy, evidence_indices: remap(deep.recovery_strategy.evidence_indices) },
    recovery_risk: { ...deep.recovery_risk, evidence_indices: remap(deep.recovery_risk.evidence_indices) },
    margin_discount_caution: { ...deep.margin_discount_caution, evidence_indices: remapOptional("discount", deep.margin_discount_caution.evidence_indices) },
    follow_up_strategy: { ...deep.follow_up_strategy, evidence_indices: remap(deep.follow_up_strategy.evidence_indices) },
  }, invalidOptionalEvidence };
}

export function normalizeDeepAnalysis(
  analysis: DeepDealAnalysis,
  source: TrustedDealSource,
): DeepDealAnalysis {
  const canonicalEvidence: DeepDealAnalysis["evidence"] = [];
  const evidenceIndexByKey = new Map<string, number>();
  const oldToNew = new Map<number, number>();

  analysis.evidence.forEach((evidence, oldIndex) => {
    if (!isEvidenceGrounded(evidence, source)) invalid("evidence_grounding_failure");
    const excerpt = normalizeEvidenceText(evidence.excerpt);
    const key = `${evidence.source}:${excerpt.toLocaleLowerCase("en-US")}`;
    let canonicalIndex = evidenceIndexByKey.get(key);
    if (canonicalIndex === undefined) {
      canonicalIndex = canonicalEvidence.length;
      evidenceIndexByKey.set(key, canonicalIndex);
      canonicalEvidence.push({ ...evidence, excerpt });
    }
    oldToNew.set(oldIndex, canonicalIndex);
  });

  const remapped = remapDeepEvidence(normalizeDeepStrings(analysis.deep), oldToNew);
  let deep = remapped.deep;
  deep = {
    ...deep,
    secondary_blockers: collapseDuplicateReasons(
      deep.secondary_blockers.filter((item) => item.reason !== analysis.lost_reason),
    ),
    objection_hierarchy: collapseDuplicateReasons(deep.objection_hierarchy),
  };
  deep = repairOptionalInterpretations(deep, canonicalEvidence, remapped.invalidOptionalEvidence);
  if (deep.decision_dynamics.evidence_indices.length === 0) {
    if (!isSafeNoDecisionMakerWording(deep.decision_dynamics.explanation)) {
      invalid("unsupported_decision_maker_claim");
    }
    deep.decision_dynamics.explanation = CANONICAL_NO_DECISION_MAKER;
  }

  return {
    ...analysis,
    lost_reason_detail: compactText(analysis.lost_reason_detail),
    evidence: canonicalEvidence,
    positive_signals: analysis.positive_signals.map(compactText),
    negative_signals: analysis.negative_signals.map(compactText),
    recommended_action: compactText(analysis.recommended_action),
    recommended_timing: compactText(analysis.recommended_timing),
    follow_up_message: analysis.follow_up_message === null ? null : compactText(analysis.follow_up_message),
    deep,
  };
}
