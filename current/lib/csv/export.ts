import Papa from "papaparse";

import { CANONICAL_FIELDS, type CanonicalField } from "@/lib/csv/constants";
import { normalizeUploadedFilename } from "@/lib/csv/filename";
import type { NormalizedDeal } from "@/lib/csv/validation";

export type CanonicalCsvRowValues = Readonly<Record<CanonicalField, string | null>>;

const FORMULA_PREFIX = /^[=+\-@]/;

/** Keeps spreadsheet applications from interpreting customer-provided text as a formula. */
export function makeSpreadsheetTextInert(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function normalizedCsvFilename(originalName: string): string {
  const safe = normalizeUploadedFilename(originalName)
    .replace(/\.csv$/i, "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 120);
  return `${safe || "upload"}-lostdeal-normalized.csv`;
}

function exportedValue(row: CanonicalCsvRowValues, field: CanonicalField): string {
  const raw = row[field];
  return raw === null ? "" : makeSpreadsheetTextInert(String(raw));
}

export function createNormalizedCsv(rows: readonly NormalizedDeal[]): string {
  return createCanonicalCsv(rows);
}

export function createCanonicalCsv(rows: readonly CanonicalCsvRowValues[]): string {
  return Papa.unparse({
    fields: [...CANONICAL_FIELDS],
    data: rows.map((row) => CANONICAL_FIELDS.map((field) => exportedValue(row, field))),
  }, {
    newline: "\r\n",
  });
}
