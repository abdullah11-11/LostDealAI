import { writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { DEMO_SCENARIOS } from "./demo-data-scenarios.mjs";

export const DEMO_HEADERS = Object.freeze([
  "external_deal_id",
  "customer_name",
  "deal_value",
  "quote_date",
  "status",
  "salesperson",
  "service_type",
  "lead_source",
  "sales_notes",
  "transcript",
]);

const DAY_MS = 86_400_000;

function dateOnlyEpoch(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError("asOfDate must use YYYY-MM-DD format.");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const epoch = Date.UTC(year, month - 1, day);
  const check = new Date(epoch);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new TypeError("asOfDate must be a valid calendar date.");
  }
  return epoch;
}

function quoteDate(asOfEpoch, ageDays) {
  return new Date(asOfEpoch - ageDays * DAY_MS).toISOString().slice(0, 10);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function generateDemoRows(asOfDate) {
  const asOfEpoch = dateOnlyEpoch(asOfDate);
  return DEMO_SCENARIOS.map((scenario) => ({
    external_deal_id: scenario.externalDealId,
    customer_name: scenario.customerName,
    deal_value: scenario.dealValue,
    quote_date: quoteDate(asOfEpoch, scenario.ageDays),
    status: scenario.status,
    salesperson: scenario.salesperson,
    service_type: scenario.serviceType,
    lead_source: scenario.leadSource,
    sales_notes: scenario.salesNotes,
    transcript: scenario.transcript,
  }));
}

export function generateDemoCsv(asOfDate) {
  const rows = generateDemoRows(asOfDate);
  return [
    DEMO_HEADERS.join(","),
    ...rows.map((row) => DEMO_HEADERS.map((header) => csvCell(row[header])).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  const asOfDate = process.argv[2];
  if (!asOfDate) throw new TypeError("Usage: node scripts/generate-demo-data.mjs YYYY-MM-DD");
  const outputUrl = new URL("../public/lostdeal-demo-hvac.csv", import.meta.url);
  await writeFile(outputUrl, generateDemoCsv(asOfDate), "utf8");
  console.log(`Generated 20 synthetic HVAC deals as of ${asOfDate} at ${fileURLToPath(outputUrl)}.`);
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Demo data generation failed.");
    process.exitCode = 1;
  });
}
