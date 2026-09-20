import Papa from "papaparse";

import {
  CANONICAL_FIELDS,
  FIELD_MAX_LENGTHS,
  MAX_CSV_FILENAME_LENGTH,
  MAX_CSV_FILE_BYTES,
  MAX_CSV_HEADER_LENGTH,
  MAX_CSV_ROWS,
  type CanonicalField,
} from "@/lib/csv/constants";
import {
  columnMappingToRecipe,
  normalizeHeader,
  validateMappingRecipe,
  type ColumnMapping,
  type MappingRecipe,
  type MappingRecipeEntry,
} from "@/lib/csv/mapping";

export const SOURCE_DATE_FORMATS = ["AUTO", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"] as const;
export type SourceDateFormat = (typeof SOURCE_DATE_FORMATS)[number];
export type StatusResolution = "lost" | "exclude";
export type StatusResolutions = Record<string, StatusResolution>;

export type ParsedCsvRow = {
  rowNumber: number;
  values: string[];
  parserErrors: string[];
};

export type ParsedCsv = {
  headers: string[];
  rows: ParsedCsvRow[];
  blankRows: number;
  malformedRows: number;
  parserErrors: string[];
};

export type NormalizedDeal = {
  rowNumber: number;
  external_deal_id: string | null;
  customer_name: string | null;
  deal_value: string;
  quote_date: string | null;
  status: "lost";
  salesperson: string | null;
  service_type: string | null;
  lead_source: string | null;
  sales_notes: string | null;
  transcript: string | null;
};

export type CsvIssueCategory = "mapping" | "value" | "duplicate" | "row";
export type CsvIssue = {
  category: CsvIssueCategory;
  code: string;
  message: string;
};

export type InvalidCsvRow = {
  rowNumber: number;
  customer: string | null;
  externalDealId: string | null;
  errors: string[];
  issues?: CsvIssue[];
};

export type ReviewCsvRow = InvalidCsvRow;

export type CsvValidationResult = {
  totalRows: number;
  validRows: NormalizedDeal[];
  invalidRows: InvalidCsvRow[];
};

export type SmartCsvValidationResult = {
  totalRows: number;
  readyRows: NormalizedDeal[];
  needsReviewRows: ReviewCsvRow[];
  invalidRows: InvalidCsvRow[];
  unknownStatuses: string[];
  ambiguousDates: string[];
};

export type CsvFileMetadata = {
  name: string;
  size: number;
  type?: string;
};

const LOST_STATUSES = new Set([
  "lost",
  "closed lost",
  "unsold",
  "not won",
  "declined",
  "not sold",
  "did not close",
  "unsuccessful",
]);
const WON_STATUSES = new Set(["won", "closed won", "completed", "sold"]);
const MAX_DEAL_VALUE = 999_999_999_999.99;

function isBlankRow(row: readonly string[]): boolean {
  return row.every((value) => !value.trim());
}

function cleanParserMessage(message: string): string {
  if (/quoted field malformed|missingquotes/i.test(message)) return "Malformed quoted CSV field.";
  return message.replace(/\s+/g, " ").trim() || "Malformed CSV row.";
}

export function validateCsvFileMetadata(file: CsvFileMetadata): string | null {
  const name = file.name.trim();
  if (!name) return "Choose a CSV file to continue.";
  if (name.length > MAX_CSV_FILENAME_LENGTH) {
    return `The filename must be ${MAX_CSV_FILENAME_LENGTH} characters or fewer.`;
  }
  if (!name.toLocaleLowerCase("en-US").endsWith(".csv")) {
    return "LostDeal AI accepts CSV files only.";
  }
  if (file.size <= 0) return "This CSV is empty.";
  if (file.size > MAX_CSV_FILE_BYTES) {
    return "This file is larger than 5 MB. Choose a smaller CSV.";
  }

  const mime = file.type?.toLocaleLowerCase("en-US").trim();
  const clearlyUnsupported = mime && [
    "application/pdf",
    "application/json",
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ].includes(mime);
  if (clearlyUnsupported) return "The selected file does not appear to be a CSV.";

  return null;
}

export function parseCsvText(text: string): ParsedCsv {
  if (!text.trim()) {
    return { headers: [], rows: [], blankRows: 0, malformedRows: 0, parserErrors: [] };
  }

  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), {
    quoteChar: '"',
    escapeChar: '"',
    skipEmptyLines: false,
  });
  const matrix = result.data.map((row) => row.map((value) => String(value ?? "")));
  while (matrix.length && isBlankRow(matrix[matrix.length - 1])) matrix.pop();
  if (!matrix.length || isBlankRow(matrix[0])) {
    return {
      headers: [],
      rows: [],
      blankRows: Math.max(matrix.length - 1, 0),
      malformedRows: 0,
      parserErrors: result.errors.map((error) => cleanParserMessage(error.message)),
    };
  }

  const headers = matrix[0].map((header) => header.trim());
  const errorsByDataIndex = new Map<number, string[]>();
  for (const error of result.errors) {
    const dataIndex = Math.max((error.row ?? 1) - 1, 0);
    const existing = errorsByDataIndex.get(dataIndex) ?? [];
    existing.push(cleanParserMessage(error.message));
    errorsByDataIndex.set(dataIndex, existing);
  }

  const rows: ParsedCsvRow[] = [];
  let blankRows = 0;
  for (let dataIndex = 1; dataIndex < matrix.length; dataIndex += 1) {
    const values = matrix[dataIndex];
    if (isBlankRow(values)) {
      blankRows += 1;
      continue;
    }
    const parserErrors = errorsByDataIndex.get(dataIndex - 1) ?? [];
    if (values.length !== headers.length) {
      parserErrors.push(`Expected ${headers.length} columns but found ${values.length}.`);
    }
    rows.push({ rowNumber: dataIndex + 1, values, parserErrors });
  }

  const duplicateHeaders = new Set<string>();
  const seenHeaders = new Set<string>();
  for (const header of headers.map(normalizeHeader).filter(Boolean)) {
    if (seenHeaders.has(header)) duplicateHeaders.add(header);
    seenHeaders.add(header);
  }

  const parserErrors = result.errors
    .filter((error) => (error.row ?? 1) === 0)
    .map((error) => cleanParserMessage(error.message));
  if (headers.some((header) => !header.trim())) parserErrors.push("Every CSV column needs a header.");
  if (duplicateHeaders.size) parserErrors.push("CSV headers must be unique.");

  return {
    headers,
    rows,
    blankRows,
    malformedRows: rows.filter((row) => row.parserErrors.length > 0).length,
    parserErrors: Array.from(new Set(parserErrors)),
  };
}

export function sanitizeCsvText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function mappedEntryValue(
  row: ParsedCsvRow,
  headers: readonly string[],
  entry: MappingRecipeEntry | null,
): string {
  if (!entry) return "";
  const values = entry.sources.map((source) => sanitizeCsvText(row.values[source] ?? ""));
  if (entry.strategy === "direct") return values[0] ?? "";
  if (entry.strategy === "join_space") return values.filter(Boolean).join(" ");
  return entry.sources
    .map((source, index) => {
      const value = values[index];
      return value ? `${sanitizeCsvText(headers[source] ?? `Column ${source + 1}`)}: ${value}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function applyMappingRecipe(
  row: ParsedCsvRow,
  headers: readonly string[],
  recipe: MappingRecipe,
): Record<CanonicalField, string> {
  return Object.fromEntries(
    CANONICAL_FIELDS.map((field) => [field, mappedEntryValue(row, headers, recipe[field])]),
  ) as Record<CanonicalField, string>;
}

export function normalizeDealValue(value: string):
  | { value: string; error: null }
  | { value: null; error: string } {
  const trimmed = sanitizeCsvText(value);
  if (!trimmed) return { value: null, error: "Missing deal value." };
  if (/^\(.*\)$/.test(trimmed) || /^-/.test(trimmed)) {
    return { value: null, error: "Deal value cannot be negative." };
  }
  if (/^\D*\d{1,3}(?:\.\d{3})+,\d{2}\D*$/.test(trimmed)) {
    return { value: null, error: "Deal value uses an ambiguous foreign number format." };
  }

  let normalized = trimmed
    .replace(/^USD\s*/i, "")
    .replace(/\s*USD$/i, "")
    .replace(/^\$\s*/, "")
    .replaceAll(",", "")
    .trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return { value: null, error: "Deal value is not a valid amount." };
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric > MAX_DEAL_VALUE) {
    return { value: null, error: "Deal value is outside the supported range." };
  }
  normalized = numeric.toFixed(2);
  return { value: normalized, error: null };
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

function isoDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

const MONTHS = new Map(
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map(
    (month, index) => [month, index + 1],
  ),
);

type DateNormalization =
  | { value: string | null; error: null; needsReview: false }
  | { value: null; error: string; needsReview: boolean };

export function normalizeQuoteDateWithFormat(
  value: string,
  format: SourceDateFormat = "AUTO",
): DateNormalization {
  const trimmed = sanitizeCsvText(value);
  if (!trimmed) return { value: null, error: null, needsReview: false };

  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) {
    const [, year, month, day] = match.map(Number);
    return validDateParts(year, month, day)
      ? { value: isoDate(year, month, day), error: null, needsReview: false }
      : { value: null, error: "Quote date is not a valid calendar date.", needsReview: false };
  }

  match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(trimmed);
  if (match) {
    const [, year, month, day] = match.map(Number);
    return validDateParts(year, month, day)
      ? { value: isoDate(year, month, day), error: null, needsReview: false }
      : { value: null, error: "Quote date is not a valid calendar date.", needsReview: false };
  }

  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (match) {
    const [, first, second, year] = match.map(Number);
    if (first < 1 || second < 1) {
      return { value: null, error: "Quote date is not a valid calendar date.", needsReview: false };
    }
    if (format === "YYYY-MM-DD") {
      return { value: null, error: "Quote date does not match the selected YYYY-MM-DD format.", needsReview: false };
    }
    if (format === "MM/DD/YYYY" || format === "DD/MM/YYYY") {
      const month = format === "MM/DD/YYYY" ? first : second;
      const day = format === "MM/DD/YYYY" ? second : first;
      return validDateParts(year, month, day)
        ? { value: isoDate(year, month, day), error: null, needsReview: false }
        : { value: null, error: "Quote date is not valid for the selected date format.", needsReview: false };
    }
    if (first <= 12 && second <= 12) {
      return {
        value: null,
        error: "Quote date is ambiguous. Choose MM/DD/YYYY or DD/MM/YYYY.",
        needsReview: true,
      };
    }
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return validDateParts(year, month, day)
      ? { value: isoDate(year, month, day), error: null, needsReview: false }
      : { value: null, error: "Quote date is not a valid calendar date.", needsReview: false };
  }

  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2}$/.test(trimmed)) {
    return { value: null, error: "Quote date is ambiguous; use a four-digit year.", needsReview: true };
  }

  match = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(trimmed);
  if (match) {
    const month = MONTHS.get(match[1].slice(0, 3).toLocaleLowerCase("en-US"));
    const day = Number(match[2]);
    const year = Number(match[3]);
    return month && validDateParts(year, month, day)
      ? { value: isoDate(year, month, day), error: null, needsReview: false }
      : { value: null, error: "Quote date is not a valid calendar date.", needsReview: false };
  }

  match = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(trimmed);
  if (match) {
    const day = Number(match[1]);
    const month = MONTHS.get(match[2].slice(0, 3).toLocaleLowerCase("en-US"));
    const year = Number(match[3]);
    return month && validDateParts(year, month, day)
      ? { value: isoDate(year, month, day), error: null, needsReview: false }
      : { value: null, error: "Quote date is not a valid calendar date.", needsReview: false };
  }

  return { value: null, error: "Quote date is invalid; use YYYY-MM-DD.", needsReview: false };
}

export function normalizeQuoteDate(value: string):
  | { value: string | null; error: null }
  | { value: null; error: string } {
  const result = normalizeQuoteDateWithFormat(value);
  return result.error ? { value: null, error: result.error } : { value: result.value, error: null };
}

export function normalizeStatusKey(value: string): string {
  return sanitizeCsvText(value)
    .toLocaleLowerCase("en-US")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type StatusNormalization =
  | { value: "lost"; error: null; needsReview: false }
  | { value: null; error: string; needsReview: boolean };

export function normalizeLostStatusWithResolutions(
  value: string,
  resolutions: StatusResolutions = {},
): StatusNormalization {
  const raw = sanitizeCsvText(value);
  const normalized = normalizeStatusKey(raw);
  if (!normalized || LOST_STATUSES.has(normalized)) {
    return { value: "lost", error: null, needsReview: false };
  }
  if (WON_STATUSES.has(normalized)) {
    return {
      value: null,
      error: resolutions[normalized] === "lost"
        ? `Known won/sold status “${raw}” cannot be reclassified as Lost.`
        : `Deal status “${raw}” appears won.`,
      needsReview: false,
    };
  }
  if (resolutions[normalized] === "lost") {
    return { value: "lost", error: null, needsReview: false };
  }
  if (resolutions[normalized] === "exclude") {
    return { value: null, error: `Status “${raw}” is marked Exclude.`, needsReview: false };
  }
  return {
    value: null,
    error: `Status “${raw}” needs review. Confirm Lost or Exclude.`,
    needsReview: true,
  };
}

export function normalizeLostStatus(value: string):
  | { value: "lost"; error: null }
  | { value: null; error: string } {
  const result = normalizeLostStatusWithResolutions(value);
  return result.error ? { value: null, error: result.error } : { value: "lost", error: null };
}

export function parseSourceDateFormat(value: unknown): SourceDateFormat | null {
  return typeof value === "string" && (SOURCE_DATE_FORMATS as readonly string[]).includes(value)
    ? value as SourceDateFormat
    : null;
}

export function parseStatusResolutions(value: unknown): StatusResolutions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 50) return null;
  const parsed: StatusResolutions = {};
  for (const [rawKey, resolution] of entries) {
    const key = normalizeStatusKey(rawKey);
    if (!key || rawKey.length > 80 || (resolution !== "lost" && resolution !== "exclude")) return null;
    if (WON_STATUSES.has(key) && resolution === "lost") return null;
    parsed[key] = resolution;
  }
  return parsed;
}

function issue(category: CsvIssueCategory, code: string, message: string): CsvIssue {
  return { category, code, message };
}

function problemRow(
  rowNumber: number,
  values: Record<CanonicalField, string>,
  issues: CsvIssue[],
): InvalidCsvRow {
  return {
    rowNumber,
    customer: values.customer_name || null,
    externalDealId: values.external_deal_id || null,
    errors: Array.from(new Set(issues.map((item) => item.message))),
    issues,
  };
}

export function validateSmartCsvRows(
  parsed: ParsedCsv,
  recipe: MappingRecipe,
  options: {
    existingExternalIds?: ReadonlySet<string>;
    dateFormat?: SourceDateFormat;
    statusResolutions?: StatusResolutions;
  } = {},
): SmartCsvValidationResult {
  const readyRows: NormalizedDeal[] = [];
  const needsReviewRows: ReviewCsvRow[] = [];
  const invalidRows: InvalidCsvRow[] = [];
  const unknownStatuses = new Set<string>();
  const ambiguousDates = new Set<string>();
  const seenExternalIds = new Set<string>();
  const existingExternalIds = options.existingExternalIds ?? new Set<string>();
  const dateFormat = options.dateFormat ?? "AUTO";
  const statusResolutions = options.statusResolutions ?? {};

  const mappingErrors = validateMappingRecipe(recipe, parsed.headers.length);
  if (mappingErrors.length) {
    return {
      totalRows: parsed.rows.length,
      readyRows,
      needsReviewRows,
      invalidRows: parsed.rows.map((row) => ({
        rowNumber: row.rowNumber,
        customer: null,
        externalDealId: null,
        errors: mappingErrors,
        issues: mappingErrors.map((message) => issue("mapping", "MAPPING_INVALID", message)),
      })),
      unknownStatuses: [],
      ambiguousDates: [],
    };
  }

  for (const row of parsed.rows) {
    const values = applyMappingRecipe(row, parsed.headers, recipe);
    const invalidIssues = row.parserErrors.map((message) => issue("row", "CSV_MALFORMED", message));
    const reviewIssues: CsvIssue[] = [];

    for (const field of CANONICAL_FIELDS) {
      if (values[field].length > FIELD_MAX_LENGTHS[field]) {
        invalidIssues.push(issue(
          "value",
          "VALUE_TOO_LONG",
          `${field.replaceAll("_", " ")} exceeds the ${FIELD_MAX_LENGTHS[field]} character limit.`,
        ));
      }
    }

    const dealValue = normalizeDealValue(values.deal_value);
    if (dealValue.error) invalidIssues.push(issue("value", "DEAL_VALUE_INVALID", dealValue.error));
    if (!values.sales_notes && !values.transcript) {
      invalidIssues.push(issue(
        "row",
        "SOURCE_CONTEXT_MISSING",
        "Missing sales notes or transcript. This deal has no sales notes or transcript to analyze. Map an available comments/notes column or correct the source file.",
      ));
    }

    const quoteDate = normalizeQuoteDateWithFormat(values.quote_date, dateFormat);
    if (quoteDate.error) {
      const nextIssue = issue("value", quoteDate.needsReview ? "DATE_AMBIGUOUS" : "DATE_INVALID", quoteDate.error);
      if (quoteDate.needsReview) {
        reviewIssues.push(nextIssue);
        if (values.quote_date) ambiguousDates.add(values.quote_date);
      } else {
        invalidIssues.push(nextIssue);
      }
    }

    const status = normalizeLostStatusWithResolutions(values.status, statusResolutions);
    if (status.error) {
      const nextIssue = issue("value", status.needsReview ? "STATUS_UNKNOWN" : "STATUS_INVALID", status.error);
      if (status.needsReview) {
        reviewIssues.push(nextIssue);
        if (values.status) unknownStatuses.add(values.status);
      } else {
        invalidIssues.push(nextIssue);
      }
    }

    const externalIdKey = values.external_deal_id.toLocaleLowerCase("en-US");
    if (externalIdKey) {
      if (seenExternalIds.has(externalIdKey)) {
        invalidIssues.push(issue("duplicate", "DUPLICATE_IN_FILE", `Deal ID ${values.external_deal_id} is duplicated in this CSV.`));
      } else if (existingExternalIds.has(externalIdKey)) {
        invalidIssues.push(issue("duplicate", "DUPLICATE_IN_WORKSPACE", `Deal ID ${values.external_deal_id} already exists in this workspace.`));
      }
      seenExternalIds.add(externalIdKey);
    }

    if (invalidIssues.length || !dealValue.value || status.needsReview === false && status.error) {
      invalidRows.push(problemRow(row.rowNumber, values, invalidIssues));
      continue;
    }
    if (reviewIssues.length || quoteDate.needsReview || status.needsReview) {
      needsReviewRows.push(problemRow(row.rowNumber, values, reviewIssues));
      continue;
    }

    readyRows.push({
      rowNumber: row.rowNumber,
      external_deal_id: values.external_deal_id || null,
      customer_name: values.customer_name || null,
      deal_value: dealValue.value,
      quote_date: quoteDate.value,
      status: "lost",
      salesperson: values.salesperson || null,
      service_type: values.service_type || null,
      lead_source: values.lead_source || null,
      sales_notes: values.sales_notes || null,
      transcript: values.transcript || null,
    });
  }

  return {
    totalRows: parsed.rows.length,
    readyRows,
    needsReviewRows,
    invalidRows,
    unknownStatuses: [...unknownStatuses],
    ambiguousDates: [...ambiguousDates],
  };
}

export function validateCsvRows(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  existingExternalIds: ReadonlySet<string> = new Set(),
): CsvValidationResult {
  const smart = validateSmartCsvRows(parsed, columnMappingToRecipe(mapping), { existingExternalIds });
  return {
    totalRows: smart.totalRows,
    validRows: smart.readyRows,
    invalidRows: [...smart.invalidRows, ...smart.needsReviewRows].sort((a, b) => a.rowNumber - b.rowNumber),
  };
}

export function collectMappedExternalIds(parsed: ParsedCsv, recipe: MappingRecipe): string[] {
  return parsed.rows
    .map((row) => applyMappingRecipe(row, parsed.headers, recipe).external_deal_id)
    .filter(Boolean);
}

export function detectAmbiguousDateValues(parsed: ParsedCsv, recipe: MappingRecipe): string[] {
  if (!recipe.quote_date) return [];
  const values = new Set<string>();
  for (const row of parsed.rows) {
    const raw = applyMappingRecipe(row, parsed.headers, recipe).quote_date;
    const normalized = normalizeQuoteDateWithFormat(raw, "AUTO");
    if (normalized.needsReview && raw) values.add(raw);
    if (values.size >= 20) break;
  }
  return [...values];
}

export function validateParsedCsvShape(parsed: ParsedCsv): string | null {
  if (!parsed.headers.length) return "This CSV does not contain a header row.";
  if (parsed.headers.some((header) => header.length > MAX_CSV_HEADER_LENGTH)) {
    return `CSV headers must be ${MAX_CSV_HEADER_LENGTH} characters or fewer.`;
  }
  if (parsed.parserErrors.length) return parsed.parserErrors.join(" ");
  if (!parsed.rows.length) return "This CSV contains headers but no deal rows.";
  if (parsed.rows.length > MAX_CSV_ROWS) {
    return "LostDeal AI currently supports up to 2,000 deals per CSV import.";
  }
  return null;
}
