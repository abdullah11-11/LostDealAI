import { AI_CONFIG } from "@/lib/ai/config";
import {
  DealAnalysisSchema,
  type DealAnalysis,
  type DealAnalysisModelResult,
} from "@/lib/ai/deal-analysis-schema";
import { unsupportedNumericClaims } from "@/lib/ai/claim-grounding";
import { DealAnalysisError, toDealAnalysisError } from "@/lib/ai/errors";
import { validateAndGroundEvidence } from "@/lib/ai/validate-evidence";

export type TrustedDealSource = {
  dealValue: string;
  quoteDate: string | null;
  serviceType: string | null;
  status: string;
  salesNotes: string | null;
  transcript: string | null;
};

export type MinimizedDealInput = {
  deal_value: string;
  quote_date: string | null;
  service_type: string | null;
  status: string;
  sales_notes: string | null;
  transcript: string | null;
};

export type AnalysisModelRunner = (input: MinimizedDealInput) => Promise<DealAnalysisModelResult>;

export type CompletedDealAnalysis = {
  analysis: DealAnalysis;
  metadata: {
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

export function minimizeDealInput(
  source: TrustedDealSource,
  sourceCharacterLimit: number = AI_CONFIG.sourceCharacterLimit,
): {
  input: MinimizedDealInput;
  sourceCharacters: number;
} {
  const salesNotes = source.salesNotes?.trim() || null;
  const transcript = source.transcript?.trim() || null;
  const sourceCharacters = (salesNotes?.length ?? 0) + (transcript?.length ?? 0);

  if (sourceCharacters === 0) throw new DealAnalysisError("INSUFFICIENT_SOURCE");
  if (sourceCharacters > sourceCharacterLimit) throw new DealAnalysisError("SOURCE_TOO_LONG");

  return {
    input: {
      deal_value: source.dealValue,
      quote_date: source.quoteDate,
      service_type: source.serviceType,
      status: source.status,
      sales_notes: salesNotes,
      transcript,
    },
    sourceCharacters,
  };
}

function sourceContains(source: TrustedDealSource, value: string): boolean {
  return `${source.salesNotes ?? ""}\n${source.transcript ?? ""}`.toLocaleLowerCase("en-US")
    .includes(value.toLocaleLowerCase("en-US"));
}

export function enforceFollowUpSafety(analysis: DealAnalysis, source: TrustedDealSource): DealAnalysis {
  if (analysis.recommended_channel === "NO_ACTION") {
    return { ...analysis, follow_up_message: null };
  }
  if (!analysis.follow_up_message) return analysis;

  const message = analysis.follow_up_message;
  const riskyTerms = ["discount", "apr", "guarantee", "reserved", "pre-approved", "appointment available"];
  for (const term of riskyTerms) {
    if (message.toLocaleLowerCase("en-US").includes(term) && !sourceContains(source, term)) {
      throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "semantic_validation_failure");
    }
  }
  const trustedSourceText = [
    source.salesNotes ?? "",
    source.transcript ?? "",
    source.quoteDate ?? "",
    `$${source.dealValue}`,
    `USD ${source.dealValue}`,
  ].join("\n");
  if (unsupportedNumericClaims(message, trustedSourceText).length > 0) {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "unsupported_numeric_claim");
  }
  return analysis;
}

export async function analyzeDeal(
  source: TrustedDealSource,
  runModel: AnalysisModelRunner,
): Promise<CompletedDealAnalysis> {
  const { input, sourceCharacters } = minimizeDealInput(source);
  let attempts = 0;

  while (true) {
    try {
      const modelResult = await runModel(input);
      const parsed = DealAnalysisSchema.safeParse(modelResult.analysis);
      if (!parsed.success) {
        throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "zod_validation_failure");
      }
      const grounded = validateAndGroundEvidence(parsed.data, {
        salesNotes: input.sales_notes,
        transcript: input.transcript,
      });
      const safeAnalysis = enforceFollowUpSafety(grounded, source);
      return {
        analysis: safeAnalysis,
        metadata: {
          model: modelResult.model,
          response_id: modelResult.responseId,
          ...(modelResult.usage ? {
            input_tokens: modelResult.usage.inputTokens,
            output_tokens: modelResult.usage.outputTokens,
            total_tokens: modelResult.usage.totalTokens,
          } : {}),
          analyzed_at: new Date().toISOString(),
          source_characters: sourceCharacters,
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
