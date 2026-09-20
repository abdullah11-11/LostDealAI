const TESTED_COST_SAFE_ANALYSIS_FALLBACK = "gpt-5.6-terra";
const legacyAnalysisModel = process.env.OPENAI_MODEL?.trim() || "gpt-5.6";
const safeLegacyAnalysisModel = legacyAnalysisModel === TESTED_COST_SAFE_ANALYSIS_FALLBACK
  ? legacyAnalysisModel
  : TESTED_COST_SAFE_ANALYSIS_FALLBACK;

export const AI_CONFIG = Object.freeze({
  /** Preserve the existing AI Mapping and Auto Convert fallback contract. */
  model: legacyAnalysisModel,
  standardModel: process.env.OPENAI_STANDARD_ANALYSIS_MODEL?.trim() || safeLegacyAnalysisModel,
  deepModel: process.env.OPENAI_DEEP_ANALYSIS_MODEL?.trim() || safeLegacyAnalysisModel,
  standardSchemaVersion: "standard-1.0",
  deepSchemaVersion: "deep-1.0",
  standardPromptVersion: "standard-1.0",
  deepPromptVersion: "deep-1.3",
  sourceCharacterLimit: 50_000,
  deepSourceCharacterLimit: 60_000,
  batchSizeLimit: 25,
  batchConcurrency: 2,
  maxAutomaticRetries: 1,
  requestTimeoutMs: 45_000,
  maxOutputTokens: 2_000,
  deepMaxOutputTokens: 4_000,
});

export function getStandardAnalysisModel(): string {
  return AI_CONFIG.standardModel;
}

export function getDeepAnalysisModel(): string {
  return AI_CONFIG.deepModel;
}

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
