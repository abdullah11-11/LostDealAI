import "server-only";

import OpenAI from "openai";

import { AI_CONFIG } from "@/lib/ai/config";
import { DealAnalysisError } from "@/lib/ai/errors";

let client: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new DealAnalysisError("OPENAI_NOT_CONFIGURED");
  if (!client) {
    client = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: AI_CONFIG.requestTimeoutMs,
    });
  }
  return client;
}
