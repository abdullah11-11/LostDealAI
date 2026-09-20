import { z } from "zod";

import { LOST_REASONS, RECOMMENDED_CHANNELS } from "@/types/database";

export const EvidenceSchema = z.object({
  source: z.enum(["SALES_NOTES", "TRANSCRIPT"]),
  excerpt: z.string().min(1).max(320),
}).strict();

export const DealAnalysisSchema = z.object({
  lost_reason: z.enum(LOST_REASONS),
  lost_reason_detail: z.string().min(1).max(500),
  buying_intent_score: z.number().int().min(0).max(100),
  confidence_score: z.number().int().min(0).max(100),
  evidence: z.array(EvidenceSchema).max(8),
  positive_signals: z.array(z.string().min(1).max(180)).max(8),
  negative_signals: z.array(z.string().min(1).max(180)).max(8),
  recommended_action: z.string().min(1).max(400),
  recommended_timing: z.string().min(1).max(180),
  recommended_channel: z.enum(RECOMMENDED_CHANNELS),
  follow_up_message: z.string().min(1).max(700).nullable(),
}).strict();

export type DealAnalysis = z.infer<typeof DealAnalysisSchema>;
export type DealEvidence = z.infer<typeof EvidenceSchema>;

export type DealAnalysisModelResult = {
  analysis: DealAnalysis;
  responseId: string | null;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
};
