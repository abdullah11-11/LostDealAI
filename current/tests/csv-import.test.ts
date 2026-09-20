import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { MAX_CSV_FILE_BYTES, MAX_CSV_ROWS } from "../lib/csv/constants";
import {
  autoMapColumns,
  emptyColumnMapping,
  validateColumnMapping,
} from "../lib/csv/mapping";
import {
  normalizeDealValue,
  normalizeLostStatus,
  normalizeQuoteDate,
  parseCsvText,
  validateCsvFileMetadata,
  validateCsvRows,
  validateParsedCsvShape,
} from "../lib/csv/validation";

const fixtureRoot = new URL("./fixtures/csv/", import.meta.url);

async function fixture(name: string): Promise<string> {
  return readFile(new URL(name, fixtureRoot), "utf8");
}

async function mappedValidation(name: string, existing = new Set<string>()) {
  const parsed = parseCsvText(await fixture(name));
  const mapping = autoMapColumns(parsed.headers);
  assert.deepEqual(validateColumnMapping(mapping, parsed.headers.length), []);
  return { parsed, mapping, result: validateCsvRows(parsed, mapping, existing) };
}

test("A: valid CSV handles quoted commas and escaped quotes", async () => {
  const { parsed, result } = await mappedValidation("a-valid.csv");
  assert.equal(parsed.rows.length, 1);
  assert.equal(result.validRows.length, 1);
  assert.equal(result.validRows[0].deal_value, "8500.00");
  assert.match(result.validRows[0].sales_notes ?? "", /Quoted field, with comma/);
  assert.match(result.validRows[0].transcript ?? "", /"call next quarter"/);
});

test("B: missing deal value is invalid", async () => {
  const { result } = await mappedValidation("b-missing-deal-value.csv");
  assert.equal(result.validRows.length, 0);
  assert.match(result.invalidRows[0].errors.join(" "), /Missing deal value/);
});

test("C: missing both notes and transcript is invalid", async () => {
  const { result } = await mappedValidation("c-missing-context.csv");
  assert.equal(result.validRows.length, 0);
  assert.match(result.invalidRows[0].errors.join(" "), /Missing sales notes or transcript/);
});

test("D: obviously won status is invalid", async () => {
  const { result } = await mappedValidation("d-won-status.csv");
  assert.equal(result.validRows.length, 0);
  assert.match(result.invalidRows[0].errors.join(" "), /appears won/);
});

test("E and F: currency validation rejects text and normalizes $8,500", async () => {
  const invalid = await mappedValidation("e-invalid-currency.csv");
  const formatted = await mappedValidation("f-formatted-currency.csv");
  assert.equal(invalid.result.validRows.length, 0);
  assert.equal(formatted.result.validRows[0].deal_value, "8500.00");
  assert.equal(normalizeDealValue("-4").error, "Deal value cannot be negative.");
  assert.equal(normalizeDealValue("8,500 USD").value, "8500.00");
});

test("G: subsequent duplicate external ID is invalid", async () => {
  const { result } = await mappedValidation("g-duplicate-external-id.csv");
  assert.equal(result.validRows.length, 1);
  assert.equal(result.invalidRows.length, 1);
  assert.match(result.invalidRows[0].errors.join(" "), /duplicated in this CSV/);
});

test("existing workspace external ID is friendly and invalid", async () => {
  const { result } = await mappedValidation("m-notes-only.csv", new Set(["notes-1"]));
  assert.equal(result.validRows.length, 0);
  assert.match(result.invalidRows[0].errors.join(" "), /already exists in this workspace/);
});

test("H: empty CSV is rejected", async () => {
  const parsed = parseCsvText(await fixture("h-empty.csv"));
  assert.match(validateParsedCsvShape(parsed) ?? "", /header row/);
});

test("I: more than the row limit is rejected without truncation", () => {
  const text = ["deal_value,sales_notes", ...Array.from({ length: MAX_CSV_ROWS + 1 }, (_, index) => `${index + 1},Synthetic note`)].join("\n");
  const parsed = parseCsvText(text);
  assert.equal(parsed.rows.length, MAX_CSV_ROWS + 1);
  assert.match(validateParsedCsvShape(parsed) ?? "", /up to 2,000 deals/);
});

test("J: malformed quoted CSV is detected", async () => {
  const { parsed, result } = await mappedValidation("j-malformed-quoted.csv");
  assert.ok(parsed.malformedRows > 0 || parsed.parserErrors.length > 0);
  assert.equal(result.validRows.length, 0);
});

test("K: ambiguous short date is invalid", async () => {
  const { result } = await mappedValidation("k-invalid-date.csv");
  assert.equal(result.validRows.length, 0);
  assert.match(result.invalidRows[0].errors.join(" "), /ambiguous/);
  assert.equal(normalizeQuoteDate("2026-02-28").value, "2026-02-28");
  assert.equal(normalizeQuoteDate("13/02/2026").value, "2026-02-13");
});

test("L and M: transcript-only and notes-only rows are valid", async () => {
  const transcript = await mappedValidation("l-transcript-only.csv");
  const notes = await mappedValidation("m-notes-only.csv");
  assert.equal(transcript.result.validRows.length, 1);
  assert.equal(notes.result.validRows.length, 1);
});

test("automatic mapping is case, whitespace, underscore, and dash tolerant", () => {
  const mapping = autoMapColumns([" Deal-ID ", "QUOTE_AMOUNT", "Sales-Notes"]);
  assert.equal(mapping.external_deal_id, 0);
  assert.equal(mapping.deal_value, 1);
  assert.equal(mapping.sales_notes, 2);
});

test("manual mapping is accepted and duplicate source mapping is rejected", () => {
  const mapping = emptyColumnMapping();
  mapping.deal_value = 0;
  mapping.transcript = 1;
  assert.deepEqual(validateColumnMapping(mapping, 2), []);
  mapping.sales_notes = 1;
  assert.match(validateColumnMapping(mapping, 2).join(" "), /cannot map to both/);
});

test("required mapping errors explain missing context", () => {
  const mapping = emptyColumnMapping();
  mapping.deal_value = 0;
  assert.match(validateColumnMapping(mapping, 1).join(" "), /needs sales notes or a transcript/);
});

test("file selection checks extension, size, emptiness, and hostile MIME", () => {
  assert.match(validateCsvFileMetadata({ name: "deals.xlsx", size: 10 }) ?? "", /CSV files only/);
  assert.match(validateCsvFileMetadata({ name: "deals.csv", size: 0 }) ?? "", /empty/);
  assert.match(validateCsvFileMetadata({ name: "deals.csv", size: MAX_CSV_FILE_BYTES + 1 }) ?? "", /larger than 5 MB/);
  assert.match(validateCsvFileMetadata({ name: "deals.csv", size: 10, type: "application/pdf" }) ?? "", /does not appear/);
  assert.equal(validateCsvFileMetadata({ name: "deals.csv", size: 10, type: "text/csv" }), null);
});

test("lost status variants normalize and formulas remain inert text", () => {
  assert.equal(normalizeLostStatus("closed_lost").value, "lost");
  assert.match(normalizeLostStatus("sold").error ?? "", /appears won/);
  const parsed = parseCsvText("deal_value,sales_notes\n1000,=SUM(1+1)");
  const validation = validateCsvRows(parsed, autoMapColumns(parsed.headers));
  assert.equal(validation.validRows[0].sales_notes, "=SUM(1+1)");
});

test("the downloadable sample contains exactly 10 valid synthetic deals", async () => {
  const sample = await readFile(new URL("../public/sample-lost-deals.csv", import.meta.url), "utf8");
  const parsed = parseCsvText(sample);
  const mapping = autoMapColumns(parsed.headers);
  const validation = validateCsvRows(parsed, mapping);
  assert.equal(parsed.rows.length, 10);
  assert.equal(validation.validRows.length, 10);
  assert.equal(validation.invalidRows.length, 0);
  assert.ok(validation.validRows.every((row) => (row.customer_name ?? "").startsWith("Synthetic")));
});
