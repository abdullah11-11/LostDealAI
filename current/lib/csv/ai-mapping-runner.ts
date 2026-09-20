import "server-only";

import { zodTextFormat } from "openai/helpers/zod";

import { AI_CONFIG } from "@/lib/ai/config";
import { getOpenAIClient } from "@/lib/ai/openai";
import { AI_MAPPING_INSTRUCTIONS, buildAiMappingPrompt, type AiMappingRunner } from "@/lib/csv/ai-mapping";
import { AiMappingOutputSchema } from "@/lib/csv/ai-mapping-schema";

export function createOpenAiMappingRunner(model: string): AiMappingRunner {
  return async (request) => {
    const response = await getOpenAIClient().responses.parse({
      model,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 1_400,
      input: [
        { role: "developer", content: AI_MAPPING_INSTRUCTIONS },
        { role: "user", content: buildAiMappingPrompt(request) },
      ],
      text: {
        format: zodTextFormat(AiMappingOutputSchema, "lostdeal_csv_mapping"),
      },
    });
    if (response.status === "incomplete" || !response.output_parsed) {
      throw new Error("AI_MAPPING_RESPONSE_INVALID");
    }
    return response.output_parsed;
  };
}

export const runOpenAiMapping: AiMappingRunner = createOpenAiMappingRunner(AI_CONFIG.model);
