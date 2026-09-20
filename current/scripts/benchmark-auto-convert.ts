import {
  AUTO_CONVERT_MAX_BATCH_CHARACTERS,
  AUTO_CONVERT_BATCH_CONCURRENCY,
  AUTO_CONVERT_MAX_ROWS_PER_BATCH,
  buildAutoConvertBatches,
  buildAutoConvertPlan,
} from "@/lib/csv/auto-convert";
import type { AutoConvertExtractionRequest } from "@/lib/csv/auto-convert-schema";
import { parseCsvText } from "@/lib/csv/validation";

const SOURCE_CHARACTERS_PER_ROW = 1_800;
const OUTPUT_TOKENS_PER_ROW_RANGE = [60, 180] as const;
const REQUEST_OVERHEAD_TOKENS = 450;
const PRICES_PER_MILLION = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.6-sol": { input: 4, output: 20 },
} as const;

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

for (const rowCount of [25, 100, 500, 1_500]) {
  const note = `Alex handled the quote. ${"Synthetic authorized source context. ".repeat(80)}`
    .slice(0, SOURCE_CHARACTERS_PER_ROW);
  const csv = [
    "Status,Notes",
    ...Array.from({ length: rowCount }, (_, index) => `Lost,"Row ${index + 1}: ${note}"`),
  ].join("\n");
  const parsed = parseCsvText(csv);
  const plan = buildAutoConvertPlan(parsed);
  const rows: AutoConvertExtractionRequest["rows"] = parsed.rows.map((row) => ({
    row_reference: row.rowNumber,
    unresolved_targets: ["deal_value", "customer_name", "quote_date", "salesperson", "service_type", "lead_source"],
    sources: [{ column: "Notes", value: row.values[1] }],
  }));
  const batches = buildAutoConvertBatches(rows);
  const requestCharacters = batches.reduce(
    (sum, batch) => sum + JSON.stringify(batch).length,
    0,
  );
  const estimatedInputTokens = Math.ceil(requestCharacters / 4)
    + batches.length * REQUEST_OVERHEAD_TOKENS;
  const estimatedOutputTokens = OUTPUT_TOKENS_PER_ROW_RANGE.map((tokens) => tokens * rowCount);
  const costs = Object.fromEntries(Object.entries(PRICES_PER_MILLION).map(([model, price]) => [
    model,
    estimatedOutputTokens.map((outputTokens) => (
      estimatedInputTokens * price.input + outputTokens * price.output
    ) / 1_000_000),
  ]));

  process.stdout.write(`${JSON.stringify({
    rowCount,
    reservationUnits: plan.reservationUnits,
    requests: batches.length,
    boundedConcurrency: AUTO_CONVERT_BATCH_CONCURRENCY,
    estimatedRequestWaves: Math.ceil(batches.length / AUTO_CONVERT_BATCH_CONCURRENCY),
    maxRowsPerRequest: Math.max(...batches.map((batch) => batch.rows.length)),
    maxMeasuredRequestCharacters: Math.max(...batches.map((batch) => JSON.stringify(batch).length)),
    configuredCharacterLimit: AUTO_CONVERT_MAX_BATCH_CHARACTERS,
    configuredRowLimit: AUTO_CONVERT_MAX_ROWS_PER_BATCH,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCost: Object.fromEntries(Object.entries(costs).map(([model, range]) => [
      model,
      `${money(range[0])}–${money(range[1])}`,
    ])),
    paidCalls: 0,
  })}\n`);
}
