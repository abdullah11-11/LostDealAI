import { z } from "zod";

import {
  CANONICAL_FIELDS,
  MAX_AI_MAPPING_COLUMNS,
  MAX_AI_MAPPING_SAMPLES_PER_COLUMN,
  MAX_AI_MAPPING_SAMPLE_LENGTH,
} from "@/lib/csv/constants";
import { COLUMN_PROFILE_TYPES } from "@/lib/csv/profiling";

export const AI_MAPPING_TARGETS = [...CANONICAL_FIELDS, "IGNORE"] as const;
export const AI_MAPPING_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;

export const AiMappingColumnSchema = z.object({
  source_column: z.string().min(1).max(200),
  profile: z.enum(COLUMN_PROFILE_TYPES),
  samples: z.array(z.string().max(MAX_AI_MAPPING_SAMPLE_LENGTH)).max(MAX_AI_MAPPING_SAMPLES_PER_COLUMN),
}).strict();

export const AiMappingCurrentTargetSchema = z.object({
  target: z.enum(CANONICAL_FIELDS),
  source_count: z.number().int().min(1).max(5),
}).strict();

export const AiMappingRequestSchema = z.object({
  columns: z.array(AiMappingColumnSchema).min(1).max(MAX_AI_MAPPING_COLUMNS),
  current_mappings: z.array(AiMappingCurrentTargetSchema).max(CANONICAL_FIELDS.length).optional(),
}).strict().superRefine((value, context) => {
  const sourceColumns = value.columns.map((column) => column.source_column);
  if (new Set(sourceColumns).size !== sourceColumns.length) {
    context.addIssue({ code: "custom", message: "Source columns must be unique.", path: ["columns"] });
  }
  const targets = (value.current_mappings ?? []).map((mapping) => mapping.target);
  if (new Set(targets).size !== targets.length) {
    context.addIssue({ code: "custom", message: "Current mapping targets must be unique.", path: ["current_mappings"] });
  }
});

export const AiMappingSuggestionSchema = z.object({
  source_column: z.string().min(1).max(200),
  target: z.enum(AI_MAPPING_TARGETS),
  confidence: z.enum(AI_MAPPING_CONFIDENCES),
  reason: z.string().min(1).max(180),
}).strict();

export const AiMappingOutputSchema = z.object({
  suggestions: z.array(AiMappingSuggestionSchema).max(MAX_AI_MAPPING_COLUMNS),
}).strict();

export type AiMappingRequest = z.infer<typeof AiMappingRequestSchema>;
export type AiMappingSuggestion = z.infer<typeof AiMappingSuggestionSchema>;
export type AiMappingOutput = z.infer<typeof AiMappingOutputSchema>;
