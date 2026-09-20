import "server-only";

import { zodTextFormat } from "openai/helpers/zod";

import { AI_CONFIG, getStandardAnalysisModel } from "@/lib/ai/config";
import {
  DealAnalysisSchema,
  type DealAnalysisModelResult,
} from "@/lib/ai/deal-analysis-schema";
import { DealAnalysisError } from "@/lib/ai/errors";
import { buildDealAnalysisUserPrompt, LOSTDEAL_ANALYSIS_INSTRUCTIONS } from "@/lib/ai/instructions";
import { getOpenAIClient } from "@/lib/ai/openai";
import type { AnalysisModelRunner } from "@/lib/ai/analyze-deal";

function findRefusal(output: unknown): boolean {
  if (!Array.isArray(output)) return false;
  return output.some((item) => {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) return false;
    return item.content.some((content: unknown) => content && typeof content === "object" && "type" in content && content.type === "refusal");
  });
}

export function createOpenAIAnalysisRunner(model: string): AnalysisModelRunner {
  return async (input): Promise<DealAnalysisModelResult> => {
  const openai = getOpenAIClient();
  const response = await openai.responses.parse({
    model,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: AI_CONFIG.maxOutputTokens,
    input: [
      { role: "developer", content: LOSTDEAL_ANALYSIS_INSTRUCTIONS },
      {
        role: "user",
        content: buildDealAnalysisUserPrompt(input),
      },
    ],
    text: {
      format: zodTextFormat(DealAnalysisSchema, "lostdeal_analysis"),
    },
  });

  if (findRefusal(response.output)) {
    throw new DealAnalysisError("AI_REFUSAL", false, "provider_refusal");
  }
  if (response.status === "incomplete") {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "provider_incomplete");
  }
  if (!response.output_parsed) {
    throw new DealAnalysisError("AI_RESPONSE_INVALID", false, "schema_parse_failure");
  }

  return {
    analysis: response.output_parsed,
    responseId: response.id || null,
    model: response.model || model,
    usage: response.usage ? {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.total_tokens,
    } : null,
  };
  };
}

export const runOpenAIAnalysis: AnalysisModelRunner = createOpenAIAnalysisRunner(getStandardAnalysisModel());
