import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { minimizeDealInput } from "@/lib/ai/analyze-deal";
import { CANONICAL_FIELDS } from "@/lib/csv/constants";
import { autoMapColumns, validateColumnMapping } from "@/lib/csv/mapping";
import {
  normalizeLostStatus,
  parseCsvText,
  validateCsvRows,
  validateParsedCsvShape,
} from "@/lib/csv/validation";
import { formatDealCurrency } from "@/lib/deals/format";
import { RECOVERY_WEIGHTS } from "@/lib/scoring/constants";
import {
  DEMO_SCENARIOS,
  MULTI_EXAMPLE_REASONS,
  REQUIRED_DEMO_REASONS,
} from "../scripts/demo-data-scenarios.mjs";
import {
  DEMO_HEADERS,
  generateDemoCsv,
  generateDemoRows,
} from "../scripts/generate-demo-data.mjs";

const RELEASE_DATE = "2026-08-30";
const demoUrl = new URL("../public/lostdeal-demo-hvac.csv", import.meta.url);
const sampleUrl = new URL("../public/sample-lost-deals.csv", import.meta.url);

async function demoValidation(existingExternalIds = new Set<string>()) {
  const csv = await readFile(demoUrl, "utf8");
  const parsed = parseCsvText(csv);
  const mapping = autoMapColumns(parsed.headers);
  assert.deepEqual(validateColumnMapping(mapping, parsed.headers.length), []);
  return {
    csv,
    parsed,
    mapping,
    validation: validateCsvRows(parsed, mapping, existingExternalIds),
  };
}

function recordsFromCsv(csv: string): Array<Record<string, string>> {
  const parsed = parseCsvText(csv);
  return parsed.rows.map((row) => Object.fromEntries(
    parsed.headers.map((header, index) => [header, row.values[index] ?? ""]),
  ));
}

test("production HVAC CSV is deterministic, UTF-8, canonical, and exactly 20 rows", async () => {
  const bytes = await readFile(demoUrl);
  const csv = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.equal(csv, generateDemoCsv(RELEASE_DATE));
  assert.equal(generateDemoCsv(RELEASE_DATE), generateDemoCsv(RELEASE_DATE));
  assert.notEqual(generateDemoCsv("2026-09-01"), csv);

  const { parsed } = await demoValidation();
  assert.deepEqual(parsed.headers, [...CANONICAL_FIELDS]);
  assert.deepEqual(parsed.headers, [...DEMO_HEADERS]);
  assert.equal(parsed.rows.length, 20);
  assert.equal(validateParsedCsvShape(parsed), null);
  assert.equal(parsed.parserErrors.length, 0);
  assert.equal(parsed.malformedRows, 0);
});

test("all 20 rows pass the actual Prompt 5 importer contract", async () => {
  const { validation } = await demoValidation();
  assert.equal(validation.totalRows, 20);
  assert.equal(validation.validRows.length, 20);
  assert.equal(validation.invalidRows.length, 0);
  assert.ok(validation.validRows.every((row) => row.status === "lost"));
  assert.ok(validation.validRows.every((row) => row.sales_notes || row.transcript));
  assert.ok(validation.validRows.some((row) => row.sales_notes && !row.transcript));
  assert.ok(validation.validRows.some((row) => !row.sales_notes && row.transcript));
});

test("demo identifiers are unique, obvious, and duplicate imports use existing protection", async () => {
  const first = await demoValidation();
  const ids = first.validation.validRows.map((row) => row.external_deal_id ?? "");
  assert.equal(new Set(ids).size, 20);
  assert.ok(ids.every((id) => /^DEMO-HVAC-\d{4}$/.test(id)));
  assert.deepEqual(ids, DEMO_SCENARIOS.map((scenario) => scenario.externalDealId));

  const existing = new Set(ids.map((id) => id.toLocaleLowerCase("en-US")));
  const second = await demoValidation(existing);
  assert.equal(second.validation.validRows.length, 0);
  assert.equal(second.validation.invalidRows.length, 20);
  assert.ok(second.validation.invalidRows.every((row) =>
    row.errors.some((error) => /already exists in this workspace/.test(error)),
  ));
});

test("demo values, dates, statuses, and source cells are safe", async () => {
  const { csv, validation } = await demoValidation();
  const records = recordsFromCsv(csv);
  const unsafeFormulaPrefix = /^[=+\-@]/;
  const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const phonePattern = /\b(?:\+?\d[\s().-]*){7,}\d\b/;

  for (const record of records) {
    assert.ok(Object.values(record).every((value) => !unsafeFormulaPrefix.test(value.trim())));
    assert.match(record.quote_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(normalizeLostStatus(record.status).error, null);
    assert.ok(record.customer_name.startsWith("Synthetic "));
    const sourceText = `${record.customer_name} ${record.sales_notes} ${record.transcript}`;
    assert.doesNotMatch(sourceText, emailPattern);
    assert.doesNotMatch(sourceText, phonePattern);
  }

  for (const row of validation.validRows) {
    const value = Number(row.deal_value);
    assert.ok(Number.isFinite(value) && value >= 1_200 && value <= 25_000);
    assert.match(row.quote_date ?? "", /^\d{4}-\d{2}-\d{2}$/);
  }

  assert.match(csv, /""The system is the one we want/);
  assert.match(csv, /Homeowner preferred the high-efficiency system, but/);
});

test("scenario metadata covers every intended loss reason and recovery band", () => {
  const reasonCounts = new Map<string, number>();
  for (const scenario of DEMO_SCENARIOS) {
    reasonCounts.set(scenario.expectedReason, (reasonCounts.get(scenario.expectedReason) ?? 0) + 1);
  }
  for (const reason of REQUIRED_DEMO_REASONS) assert.ok((reasonCounts.get(reason) ?? 0) >= 1, reason);
  for (const reason of MULTI_EXAMPLE_REASONS) assert.ok((reasonCounts.get(reason) ?? 0) >= 2, reason);

  for (const band of ["HIGH", "MEDIUM", "LOW"]) {
    assert.ok(DEMO_SCENARIOS.some((scenario) => scenario.recoveryBand === band), band);
  }
  assert.ok(DEMO_SCENARIOS.some((scenario) => scenario.expectedNoAction));
  assert.ok(DEMO_SCENARIOS.some((scenario) => scenario.weakEvidence));
  assert.ok(DEMO_SCENARIOS.some((scenario) => scenario.notesOnly));
  assert.ok(DEMO_SCENARIOS.some((scenario) => scenario.transcriptOnly));
  assert.ok(DEMO_SCENARIOS.some((scenario) =>
    scenario.salesNotes.length > 50 && !scenario.transcript && !scenario.weakEvidence,
  ));
  assert.ok(DEMO_SCENARIOS.some((scenario) =>
    !scenario.salesNotes && scenario.transcript.length > 50,
  ));
  assert.equal(DEMO_SCENARIOS.filter((scenario) => scenario.recommendedForDemo).length, 7);

  const ages = DEMO_SCENARIOS.map((scenario) => scenario.ageDays);
  assert.ok(ages.some((age) => age <= 14));
  assert.ok(ages.some((age) => age >= 15 && age <= 30));
  assert.ok(ages.some((age) => age >= 31 && age <= 60));
  assert.ok(ages.some((age) => age >= 61 && age <= 90));
  assert.ok(ages.some((age) => age > 90));

  assert.ok(new Set(DEMO_SCENARIOS.map((scenario) => scenario.serviceType)).size >= 9);
  assert.deepEqual(new Set(DEMO_SCENARIOS.map((scenario) => scenario.salesperson)), new Set([
    "Maya Reed", "Alex Carter", "Noah Brooks", "Casey Shah",
  ]));
  assert.ok(new Set(DEMO_SCENARIOS.map((scenario) => scenario.leadSource)).size >= 7);
});

test("every demo source fits the Prompt 7 input contract without an OpenAI call", async () => {
  const { validation } = await demoValidation();
  for (const row of validation.validRows) {
    const minimized = minimizeDealInput({
      dealValue: row.deal_value,
      quoteDate: row.quote_date,
      serviceType: row.service_type,
      status: row.status,
      salesNotes: row.sales_notes,
      transcript: row.transcript,
    });
    assert.ok(minimized.sourceCharacters > 0 && minimized.sourceCharacters <= 50_000);
  }

  const generator = await readFile(new URL("../scripts/generate-demo-data.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(generator, /openai|supabase|fetch\s*\(|https?:\/\//i);
});

test("sample and demo downloads are preserved, explicit, and side-effect free", async () => {
  const [sample, workflow, uploadPage, validateRoute, importRoute] = await Promise.all([
    readFile(sampleUrl, "utf8"),
    readFile(new URL("../components/csv-import-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/upload/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/uploads/validate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/uploads/import/route.ts", import.meta.url), "utf8"),
  ]);
  const parsedSample = parseCsvText(sample);
  const sampleValidation = validateCsvRows(parsedSample, autoMapColumns(parsedSample.headers));
  assert.equal(sampleValidation.validRows.length, 10);
  assert.match(workflow, /"\/sample-lost-deals\.csv"/);
  assert.match(workflow, /"\/lostdeal-demo-hvac\.csv"/);
  assert.match(workflow, /\["Sample CSV", "10 canonical rows"/);
  assert.match(workflow, /\["Demo HVAC", "20 walkthrough rows"/);
  assert.match(workflow, /Synthetic data only/);
  assert.match(workflow, /lg:grid-cols/);
  const uploadSources = `${workflow}\n${uploadPage}\n${validateRoute}\n${importRoute}`;
  assert.doesNotMatch(uploadSources, /openai|analyze-batch|\/api\/deals\/analyze/i);
  assert.doesNotMatch(`${validateRoute}\n${importRoute}`, /DEMO-HVAC|service_role|SUPABASE_SERVICE_ROLE/i);
  assert.doesNotMatch(await readFile(demoUrl, "utf8"), /ignore (?:all |any )?(?:previous )?instructions|system prompt|prompt injection/i);
});

test("Dashboard, Deals, and Deal Detail retain centralized currency formatting", async () => {
  assert.equal(formatDealCurrency("300250.5"), "$300,250.50");
  const sources = await Promise.all([
    readFile(new URL("../app/(dashboard)/dashboard/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/deals/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/deals/[id]/page.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of sources) {
    assert.match(source, /formatDealCurrency/);
    assert.doesNotMatch(source, /new Intl\.NumberFormat/);
  }
  assert.deepEqual(RECOVERY_WEIGHTS, {
    buyingIntent: 0.5,
    reasonRecoverability: 0.3,
    recency: 0.2,
  });
  assert.equal(generateDemoRows(RELEASE_DATE).length, 20);
});
