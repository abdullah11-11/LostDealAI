import {
  MAX_AI_MAPPING_COLUMNS,
  MAX_AI_MAPPING_SAMPLES_PER_COLUMN,
  MAX_AI_MAPPING_SAMPLE_LENGTH,
} from "@/lib/csv/constants";
import type { ParsedCsv } from "@/lib/csv/validation";

export const COLUMN_PROFILE_TYPES = [
  "mostly_numeric",
  "currency_like",
  "date_like",
  "short_text",
  "long_text",
  "categorical_like",
  "mostly_empty",
] as const;

export type ColumnProfileType = (typeof COLUMN_PROFILE_TYPES)[number];
export type AiMappingColumnProfile = {
  source_column: string;
  profile: ColumnProfileType;
  samples: string[];
};

function boundedSample(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_AI_MAPPING_SAMPLE_LENGTH);
}

function inferProfile(values: readonly string[], totalRows: number): ColumnProfileType {
  if (!values.length || values.length < Math.max(1, totalRows * 0.2)) return "mostly_empty";
  const numeric = values.filter((value) => /^-?\d+(?:\.\d+)?$/.test(value.replaceAll(",", ""))).length;
  const currency = values.filter((value) => /^(?:USD\s*|\$\s*)?\d[\d,]*(?:\.\d{1,2})?(?:\s*USD)?$/i.test(value)).length;
  const dates = values.filter((value) => /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/.test(value)).length;
  const threshold = Math.max(1, Math.ceil(values.length * 0.7));
  if (currency >= threshold && currency >= numeric) return "currency_like";
  if (dates >= threshold) return "date_like";
  if (numeric >= threshold) return "mostly_numeric";
  const unique = new Set(values.map((value) => value.toLocaleLowerCase("en-US"))).size;
  if (unique <= Math.max(8, Math.ceil(values.length * 0.35))) return "categorical_like";
  const average = values.reduce((sum, value) => sum + value.length, 0) / values.length;
  return average > 80 ? "long_text" : "short_text";
}

export function profileSourceColumns(
  parsed: ParsedCsv,
  candidateIndexes?: readonly number[],
): AiMappingColumnProfile[] {
  const requested = candidateIndexes ?? parsed.headers.map((_, index) => index);
  const indexes = Array.from(new Set(requested))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < parsed.headers.length)
    .slice(0, MAX_AI_MAPPING_COLUMNS);

  return indexes.map((index) => {
    const values = parsed.rows
      .map((row) => boundedSample(row.values[index] ?? ""))
      .filter(Boolean);
    const samples = Array.from(new Set(values)).slice(0, MAX_AI_MAPPING_SAMPLES_PER_COLUMN);
    return {
      source_column: parsed.headers[index].slice(0, 200),
      profile: inferProfile(values, parsed.rows.length),
      samples,
    };
  });
}
