export const ANALYSIS_ERROR_CODES = [
  "OPENAI_NOT_CONFIGURED",
  "AI_TEMPORARILY_UNAVAILABLE",
  "AI_RATE_LIMITED",
  "AI_RESPONSE_INVALID",
  "SOURCE_TOO_LONG",
  "INSUFFICIENT_SOURCE",
  "AI_REFUSAL",
  "ANALYSIS_FAILED",
] as const;

export type AnalysisErrorCode = (typeof ANALYSIS_ERROR_CODES)[number];

export const DEEP_SEMANTIC_FAILURE_CLASSES = [
  "duplicate_secondary_blocker",
  "primary_secondary_overlap",
  "duplicate_objection_reason",
  "weak_evidence_contract",
  "timing_category_evidence_mismatch",
  "price_value_category_evidence_mismatch",
  "competitor_category_evidence_mismatch",
  "discount_category_evidence_mismatch",
] as const;

export type DeepSemanticFailureClass = (typeof DEEP_SEMANTIC_FAILURE_CLASSES)[number];

export const ANALYSIS_DIAGNOSTIC_CATEGORIES = [
  "provider_incomplete",
  "provider_refusal",
  "provider_unavailable",
  "schema_parse_failure",
  "zod_validation_failure",
  "normalization_failure",
  "evidence_grounding_failure",
  "evidence_index_failure",
  "unsupported_numeric_claim",
  "unsupported_decision_maker_claim",
  "unsupported_competitor_claim",
  "unsupported_psychological_claim",
  "unsupported_factual_claim",
  "prompt_injection_output",
  "blocker_mismatch",
  "semantic_validation_failure",
  ...DEEP_SEMANTIC_FAILURE_CLASSES,
  "persistence_failure",
  "usage_finalization_failure",
] as const;

export type AnalysisDiagnosticCategory = (typeof ANALYSIS_DIAGNOSTIC_CATEGORIES)[number];

export class DealAnalysisError extends Error {
  constructor(
    public readonly code: AnalysisErrorCode,
    public readonly retryable = false,
    public readonly diagnosticCategory: AnalysisDiagnosticCategory | null = null,
  ) {
    super(code);
    this.name = "DealAnalysisError";
  }
}

/**
 * A bounded, content-free refinement of semantic validation failures. The exact
 * enum value is safe to persist; provider and customer content remain excluded.
 */
export class DeepSemanticValidationError extends DealAnalysisError {
  constructor(public readonly semanticFailureClass: DeepSemanticFailureClass) {
    super("AI_RESPONSE_INVALID", false, semanticFailureClass);
    this.name = "DeepSemanticValidationError";
  }
}

export function getDeepSemanticFailureClass(error: unknown): DeepSemanticFailureClass | null {
  return error instanceof DeepSemanticValidationError ? error.semanticFailureClass : null;
}

export function toDealAnalysisError(error: unknown): DealAnalysisError {
  if (error instanceof DealAnalysisError) return error;

  if (error && typeof error === "object") {
    const candidate = error as { status?: unknown; code?: unknown; name?: unknown };
    const status = typeof candidate.status === "number" ? candidate.status : null;
    const code = typeof candidate.code === "string" ? candidate.code.toLowerCase() : "";
    const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";

    if (status === 429) return new DealAnalysisError("AI_RATE_LIMITED", true, "provider_unavailable");
    if (status !== null && status >= 500) return new DealAnalysisError("AI_TEMPORARILY_UNAVAILABLE", true, "provider_unavailable");
    if (name.includes("timeout") || name.includes("connection") || code.includes("timeout")) {
      return new DealAnalysisError("AI_TEMPORARILY_UNAVAILABLE", true, "provider_unavailable");
    }
    if (status === 401 || status === 403 || code.includes("invalid_api_key")) {
      return new DealAnalysisError("OPENAI_NOT_CONFIGURED");
    }
    if (code.includes("insufficient_quota") || code.includes("billing") || code.includes("model_not_found")) {
      return new DealAnalysisError("ANALYSIS_FAILED");
    }
    if (name.includes("zod")) {
      return new DealAnalysisError("AI_RESPONSE_INVALID", false, "zod_validation_failure");
    }
  }

  return new DealAnalysisError("ANALYSIS_FAILED");
}
