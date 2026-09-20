import "server-only";

import {
  CANONICAL_FIELDS,
  FIELD_DETAILS,
  MAX_CSV_FILE_BYTES,
  MAX_REVIEW_ROWS_RETURNED,
  VALIDATION_PREVIEW_ROWS,
  type CanonicalField,
} from "@/lib/csv/constants";
import { normalizeUploadedFilename } from "@/lib/csv/filename";
import {
  ignoredSourceColumns,
  parseMappingRecipe,
  validateMappingRecipe,
  type MappingRecipe,
} from "@/lib/csv/mapping";
import {
  applyMappingRecipe,
  collectMappedExternalIds,
  parseCsvText,
  parseSourceDateFormat,
  parseStatusResolutions,
  validateCsvFileMetadata,
  validateParsedCsvShape,
  validateSmartCsvRows,
  type CsvIssueCategory,
  type InvalidCsvRow,
  type NormalizedDeal,
  type ParsedCsv,
  type SmartCsvValidationResult,
  type SourceDateFormat,
  type StatusResolutions,
} from "@/lib/csv/validation";
import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export class CsvImportError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "CsvImportError";
  }
}

export type AuthoritativeCsvValidation = {
  filename: string;
  parsed: ParsedCsv;
  recipe: MappingRecipe;
  dateFormat: SourceDateFormat;
  statusResolutions: StatusResolutions;
  skipConfirmed: boolean;
  validation: SmartCsvValidationResult;
};

export type CsvPreviewRow = Pick<
  NormalizedDeal,
  | "rowNumber"
  | "customer_name"
  | "deal_value"
  | "quote_date"
  | "service_type"
  | "salesperson"
> & {
  original_deal_value: string;
  original_quote_date: string;
  context: string;
};

export type CsvValidationResponse = {
  totalRows: number;
  readyRows: number;
  validRows: number;
  needsReviewRows: number;
  invalidRows: number;
  blankRows: number;
  malformedRows: number;
  mappedFields: number;
  missingOptionalFields: string[];
  ignoredColumns: string[];
  unknownStatuses: string[];
  ambiguousDates: string[];
  issueGroups: Record<CsvIssueCategory, number>;
  invalid: InvalidCsvRow[];
  needsReview: InvalidCsvRow[];
  issueRowsTruncated: boolean;
  preview: CsvPreviewRow[];
};

const BASE_FORM_KEYS = new Set([
  "file",
  "mapping_recipe",
  "mapping",
  "date_format",
  "status_resolutions",
]);

function assertFormShape(formData: FormData, allowConfirmation: boolean): void {
  const allowed = allowConfirmation
    ? new Set([...BASE_FORM_KEYS, "confirm_skipped"])
    : BASE_FORM_KEYS;
  for (const key of formData.keys()) {
    if (!allowed.has(key)) {
      throw new CsvImportError("The upload request contains unsupported fields.");
    }
  }
  for (const key of allowed) {
    if (formData.getAll(key).length > 1) {
      throw new CsvImportError("The upload request contains duplicate fields.");
    }
  }
  if (formData.has("mapping") && formData.has("mapping_recipe")) {
    throw new CsvImportError("Submit one column mapping recipe.");
  }
}

async function readUtf8File(file: File): Promise<string> {
  if (file.size > MAX_CSV_FILE_BYTES) {
    throw new CsvImportError("This file is larger than 5 MB. Choose a smaller CSV.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new CsvImportError("The CSV must use valid UTF-8 text encoding.");
  }
}

export async function parseCsvUploadFile(file: File): Promise<{
  filename: string;
  parsed: ParsedCsv;
}> {
  const fileError = validateCsvFileMetadata(file);
  if (fileError) throw new CsvImportError(fileError);
  const filename = normalizeUploadedFilename(file.name);
  const parsed = parseCsvText(await readUtf8File(file));
  const shapeError = validateParsedCsvShape(parsed);
  if (shapeError) throw new CsvImportError(shapeError);
  return { filename, parsed };
}

async function existingExternalIds(
  supabase: ServerSupabaseClient,
  organizationId: string,
  candidateIds: readonly string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  const uniqueIds = Array.from(new Set(candidateIds.filter(Boolean)));

  for (let offset = 0; offset < uniqueIds.length; offset += 100) {
    const batch = uniqueIds.slice(offset, offset + 100);
    if (!batch.length) continue;
    const { data, error } = await supabase
      .from("deals")
      .select("external_deal_id")
      .eq("organization_id", organizationId)
      .in("external_deal_id", batch);
    if (error) {
      throw new CsvImportError(
        "LostDeal AI could not check existing deal IDs. Please try again.",
        503,
      );
    }
    for (const row of data ?? []) {
      if (row.external_deal_id) {
        existing.add(row.external_deal_id.toLocaleLowerCase("en-US"));
      }
    }
  }

  return existing;
}

function parseJsonField(value: FormDataEntryValue | null, label: string): unknown {
  if (typeof value !== "string") throw new CsvImportError(`${label} is missing.`);
  try {
    return JSON.parse(value);
  } catch {
    throw new CsvImportError(`${label} is invalid.`);
  }
}

export async function validateCsvFormData(
  formData: FormData,
  supabase: ServerSupabaseClient,
  organizationId: string,
  options: { allowConfirmation?: boolean } = {},
): Promise<AuthoritativeCsvValidation> {
  assertFormShape(formData, Boolean(options.allowConfirmation));
  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) throw new CsvImportError("Choose a CSV file to continue.");

  const { filename, parsed } = await parseCsvUploadFile(fileValue);

  const recipeJson = parseJsonField(
    formData.get("mapping_recipe") ?? formData.get("mapping"),
    "Column mapping",
  );
  const recipe = parseMappingRecipe(recipeJson, parsed.headers.length);
  if (!recipe) throw new CsvImportError("Column mapping is invalid. Return to the mapping step.");
  const mappingErrors = validateMappingRecipe(recipe, parsed.headers.length);
  if (mappingErrors.length) throw new CsvImportError(mappingErrors.join(" "));

  const rawDateFormat = formData.get("date_format");
  const dateFormat = rawDateFormat === null ? "AUTO" : parseSourceDateFormat(rawDateFormat);
  if (!dateFormat) throw new CsvImportError("The selected source date format is invalid.");

  const rawResolutions = formData.get("status_resolutions");
  const statusJson = rawResolutions === null ? {} : parseJsonField(rawResolutions, "Status review choices");
  const statusResolutions = parseStatusResolutions(statusJson);
  if (!statusResolutions) throw new CsvImportError("Status review choices are invalid.");

  const candidates = collectMappedExternalIds(parsed, recipe);
  const existingIds = await existingExternalIds(supabase, organizationId, candidates);
  const validation = validateSmartCsvRows(parsed, recipe, {
    existingExternalIds: existingIds,
    dateFormat,
    statusResolutions,
  });
  const skipConfirmed = Boolean(options.allowConfirmation) && formData.get("confirm_skipped") === "true";

  return {
    filename,
    parsed,
    recipe,
    dateFormat,
    statusResolutions,
    skipConfirmed,
    validation,
  };
}

function previewContext(row: NormalizedDeal): string {
  if (row.transcript) return "Transcript available";
  if (!row.sales_notes) return "No context";
  return row.sales_notes.length > 120 ? `${row.sales_notes.slice(0, 120)}…` : row.sales_notes;
}

function countIssueGroups(validation: SmartCsvValidationResult): Record<CsvIssueCategory, number> {
  const counts: Record<CsvIssueCategory, number> = {
    mapping: 0,
    value: 0,
    duplicate: 0,
    row: 0,
  };
  for (const row of [...validation.needsReviewRows, ...validation.invalidRows]) {
    for (const issue of row.issues ?? []) counts[issue.category] += 1;
  }
  return counts;
}

export function toCsvValidationResponse(
  result: AuthoritativeCsvValidation,
): CsvValidationResponse {
  const { parsed, recipe, validation } = result;
  const readyByRow = new Map(validation.readyRows.map((row) => [row.rowNumber, row]));
  const preview = parsed.rows
    .filter((row) => readyByRow.has(row.rowNumber))
    .slice(0, VALIDATION_PREVIEW_ROWS)
    .map((sourceRow) => {
      const row = readyByRow.get(sourceRow.rowNumber) as NormalizedDeal;
      const original = applyMappingRecipe(sourceRow, parsed.headers, recipe);
      return {
        rowNumber: row.rowNumber,
        customer_name: row.customer_name,
        deal_value: row.deal_value,
        quote_date: row.quote_date,
        service_type: row.service_type,
        salesperson: row.salesperson,
        original_deal_value: original.deal_value,
        original_quote_date: original.quote_date,
        context: previewContext(row),
      };
    });
  const mappedFields = CANONICAL_FIELDS.filter((field) => recipe[field]).length;
  const missingOptionalFields = CANONICAL_FIELDS.filter(
    (field) => !recipe[field] && !FIELD_DETAILS[field].required,
  ).map((field) => FIELD_DETAILS[field].label);
  return {
    totalRows: validation.totalRows,
    readyRows: validation.readyRows.length,
    validRows: validation.readyRows.length,
    needsReviewRows: validation.needsReviewRows.length,
    invalidRows: validation.invalidRows.length,
    blankRows: parsed.blankRows,
    malformedRows: parsed.malformedRows,
    mappedFields,
    missingOptionalFields,
    ignoredColumns: ignoredSourceColumns(parsed.headers, recipe).map((index) => parsed.headers[index]),
    unknownStatuses: validation.unknownStatuses,
    ambiguousDates: validation.ambiguousDates,
    issueGroups: countIssueGroups(validation),
    invalid: validation.invalidRows.slice(0, MAX_REVIEW_ROWS_RETURNED),
    needsReview: validation.needsReviewRows.slice(0, MAX_REVIEW_ROWS_RETURNED),
    issueRowsTruncated:
      validation.needsReviewRows.length > MAX_REVIEW_ROWS_RETURNED
      || validation.invalidRows.length > MAX_REVIEW_ROWS_RETURNED,
    preview,
  };
}

export function mappedFieldCount(recipe: MappingRecipe): number {
  return CANONICAL_FIELDS.filter((field: CanonicalField) => recipe[field]).length;
}
