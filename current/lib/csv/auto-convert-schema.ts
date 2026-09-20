import { z } from "zod";

import { FIELD_MAX_LENGTHS } from "@/lib/csv/constants";

const MAX_SOURCE_ROW_REFERENCE = 10_000_000;
const MAX_EXTRACTED_VALUE_LENGTH = Math.max(
  FIELD_MAX_LENGTHS.external_deal_id,
  FIELD_MAX_LENGTHS.customer_name,
  FIELD_MAX_LENGTHS.deal_value,
  FIELD_MAX_LENGTHS.quote_date,
  FIELD_MAX_LENGTHS.status,
  FIELD_MAX_LENGTHS.salesperson,
  FIELD_MAX_LENGTHS.service_type,
  FIELD_MAX_LENGTHS.lead_source,
);

export const AUTO_CONVERT_EXTRACTION_TARGETS = [
  "external_deal_id",
  "customer_name",
  "deal_value",
  "quote_date",
  "status",
  "salesperson",
  "service_type",
  "lead_source",
] as const;

export type AutoConvertExtractionTarget = (typeof AUTO_CONVERT_EXTRACTION_TARGETS)[number];

export const AUTO_CONVERT_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
export type AutoConvertConfidence = (typeof AUTO_CONVERT_CONFIDENCES)[number];

export const AutoConvertSourceSchema = z.object({
  column: z.string().min(1).max(200),
  value: z.string().min(1).max(6_000),
}).strict();

export const AutoConvertExtractionRowSchema = z.object({
  row_reference: z.number().int().min(2).max(MAX_SOURCE_ROW_REFERENCE),
  unresolved_targets: z.array(z.enum(AUTO_CONVERT_EXTRACTION_TARGETS)).min(1).max(AUTO_CONVERT_EXTRACTION_TARGETS.length),
  sources: z.array(AutoConvertSourceSchema).min(1).max(8),
}).strict();

export const AutoConvertExtractionRequestSchema = z.object({
  rows: z.array(AutoConvertExtractionRowSchema).min(1).max(25),
}).strict();

export const AutoConvertExtractedFieldSchema = z.object({
  target: z.enum(AUTO_CONVERT_EXTRACTION_TARGETS),
  value: z.string().min(1).max(MAX_EXTRACTED_VALUE_LENGTH),
  confidence: z.enum(AUTO_CONVERT_CONFIDENCES),
  source_column: z.string().min(1).max(200),
  evidence: z.string().min(1).max(500),
}).strict();

export const AutoConvertExtractionResultSchema = z.object({
  row_reference: z.number().int().min(2).max(MAX_SOURCE_ROW_REFERENCE),
  fields: z.array(AutoConvertExtractedFieldSchema).max(AUTO_CONVERT_EXTRACTION_TARGETS.length),
}).strict();

export const AutoConvertExtractionOutputSchema = z.object({
  results: z.array(AutoConvertExtractionResultSchema).max(25),
}).strict();

export type AutoConvertExtractionRequest = z.infer<typeof AutoConvertExtractionRequestSchema>;
export type AutoConvertExtractionOutput = z.infer<typeof AutoConvertExtractionOutputSchema>;
export type AutoConvertExtractedField = z.infer<typeof AutoConvertExtractedFieldSchema>;
