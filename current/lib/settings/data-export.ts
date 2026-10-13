import Papa from "papaparse";
import { makeSpreadsheetTextInert } from "@/lib/csv/export";

export const DATA_EXPORT_MAX_ROWS = 5_000;
export const DATA_EXPORT_MAX_BYTES = 8 * 1024 * 1024;
export const DATA_EXPORT_PAGE_SIZE = 100;
const COLUMNS = ["external_deal_id", "customer_name", "deal_value", "quote_date", "status", "salesperson", "service_type", "lead_source", "sales_notes", "transcript"] as const;
export const DATA_EXPORT_FIELDS = ["id", "organization_id", ...COLUMNS].join(",");
export type ExportRow = Record<string, unknown>;
export type ExportPage = { rows: ExportRow[]; count: number | null; error: boolean };
export class DataExportError extends Error {
  constructor(public reason: "unavailable" | "too_large" | "invalid_scope") { super(reason); }
}

/** No silent truncation, duplicates, cross-tenant rows or spreadsheet formulas. */
export async function buildTenantDataExport(organizationId: string, loadPage: (from: number, to: number) => Promise<ExportPage>): Promise<string> {
  const data: string[][] = [];
  const seen = new Set<string>();
  let sourceBytes = 0;
  let expected: number | null = null;
  while (true) {
    const page = await loadPage(data.length, data.length + DATA_EXPORT_PAGE_SIZE - 1);
    if (page.error) throw new DataExportError("unavailable");
    if (page.rows.length > DATA_EXPORT_PAGE_SIZE) throw new DataExportError("too_large");
    if (page.count === null || !Number.isSafeInteger(page.count) || page.count < 0) throw new DataExportError("unavailable");
    if (page.count > DATA_EXPORT_MAX_ROWS) throw new DataExportError("too_large");
    if (expected !== null && page.count !== expected) throw new DataExportError("unavailable");
    expected = page.count;
    if (page.rows.length === 0) {
      if (data.length !== expected) throw new DataExportError("unavailable");
      break;
    }
    for (const row of page.rows) {
      if (row.organization_id !== organizationId || typeof row.id !== "string" || !row.id || seen.has(row.id)) throw new DataExportError("invalid_scope");
      seen.add(row.id);
      const values = COLUMNS.map(column => {
        const value = row[column];
        if (value !== null && value !== undefined && typeof value !== "string" && typeof value !== "number") throw new DataExportError("unavailable");
        if (typeof value === "number" && !Number.isFinite(value)) throw new DataExportError("unavailable");
        return makeSpreadsheetTextInert(value === null || value === undefined ? "" : String(value));
      });
      sourceBytes += new TextEncoder().encode(values.join(",")).length;
      if (sourceBytes > DATA_EXPORT_MAX_BYTES || data.length >= DATA_EXPORT_MAX_ROWS) throw new DataExportError("too_large");
      data.push(values);
    }
    if (data.length > expected) throw new DataExportError("unavailable");
    if (data.length === expected) break;
    if (page.rows.length < DATA_EXPORT_PAGE_SIZE) throw new DataExportError("unavailable");
  }
  if (data.length === 0) return COLUMNS.join(",");
  const csv = Papa.unparse({ fields: [...COLUMNS], data }, { newline: "\r\n" });
  if (new TextEncoder().encode(csv).length > DATA_EXPORT_MAX_BYTES) throw new DataExportError("too_large");
  return csv;
}
