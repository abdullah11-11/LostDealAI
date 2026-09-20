import {
  AUTO_CONVERT_EXTRACTION_TARGETS,
  AutoConvertExtractionOutputSchema,
  type AutoConvertConfidence,
  type AutoConvertExtractionRequest,
  type AutoConvertExtractionTarget,
} from "@/lib/csv/auto-convert-schema";
import type { AutoConvertExtractionRunner } from "@/lib/csv/auto-convert-runner";
import type { AiMappingRunner } from "@/lib/csv/ai-mapping";
import { suggestCsvMapping } from "@/lib/csv/ai-mapping";
import type { AiMappingRequest, AiMappingSuggestion } from "@/lib/csv/ai-mapping-schema";
import {
  CANONICAL_FIELDS,
  FIELD_MAX_LENGTHS,
  MAX_MAPPING_MERGE_COLUMNS,
  type CanonicalField,
} from "@/lib/csv/constants";
import {
  createMappingPlan,
  ignoredSourceColumns,
  usedSourceColumns,
  type MappingRecipe,
  type MappingStates,
} from "@/lib/csv/mapping";
import { profileSourceColumns, type AiMappingColumnProfile } from "@/lib/csv/profiling";
import {
  applyMappingRecipe,
  normalizeDealValue,
  normalizeLostStatusWithResolutions,
  normalizeQuoteDateWithFormat,
  sanitizeCsvText,
  type ParsedCsv,
  type ParsedCsvRow,
} from "@/lib/csv/validation";

export const AUTO_CONVERT_MAX_ROWS_PER_BATCH = 25;
export const AUTO_CONVERT_MAX_BATCH_CHARACTERS = 24_000;
export const AUTO_CONVERT_MAX_ROW_SOURCE_CHARACTERS = 8_000;
export const AUTO_CONVERT_MAX_SOURCE_VALUE_CHARACTERS = 6_000;
export const AUTO_CONVERT_MAX_SOURCE_COLUMNS = 8;
export const AUTO_CONVERT_BATCH_CONCURRENCY = 4;

const CRITICAL_FIELDS = new Set<AutoConvertExtractionTarget>([
  "deal_value",
  "quote_date",
  "status",
]);
const MERGEABLE_MAPPING_FIELDS = new Set<CanonicalField>([
  "customer_name",
  "sales_notes",
  "transcript",
]);
function sourceIndicatesWon(value: string): boolean {
  const withoutLostPhrases = value.replace(/\b(?:not\s+sold|not\s+won|did\s+not\s+close)\b/gi, " ");
  const normalized = evidenceText(withoutLostPhrases);
  if (["won", "closed won", "sold", "completed"].includes(normalized)) return true;
  return /\bclosed\s+won\b|\b(?:customer|client|prospect)\s+(?:has\s+)?(?:accepted\s+the\s+(?:quote|proposal)|paid\s+(?:a\s+)?deposit|won\s+the\s+bid)\b|\b(?:deal|opportunity|quote|proposal|job|project)\s+(?:was\s+|is\s+)?(?:won|sold|completed)\b/i.test(withoutLostPhrases);
}

function sourceIndicatesLost(value: string): boolean {
  return !sourceIndicatesWon(value)
    && /\b(?:closed\s+lost|declined|lost|not\s+sold|not\s+won|did\s+not\s+close|unsuccessful)\b/i.test(value);
}

export type AutoConvertCanonicalRow = Readonly<{
  rowNumber: number;
  values: Readonly<Record<CanonicalField, string>>;
}>;

export type AutoConvertProvenance = Readonly<{
  rowNumber: number;
  target: AutoConvertExtractionTarget;
  value: string;
  confidence: AutoConvertConfidence;
  sourceColumn: string;
  evidence: string;
}>;

export type AutoConvertReviewIssue = Readonly<{
  rowNumber: number | null;
  level: "REVIEW_RECOMMENDED" | "NEEDS_REVIEW";
  target: CanonicalField | null;
  message: string;
}>;

export type AutoConvertMappingDecision = Readonly<{
  sourceColumn: string;
  target: CanonicalField | "IGNORE";
  confidence: AutoConvertConfidence;
  applied: boolean;
  reviewRecommended: boolean;
  reason: string;
}>;

export type AutoConvertPlan = Readonly<{
  parsed: ParsedCsv;
  recipe: MappingRecipe;
  states: MappingStates;
  profiles: readonly AiMappingColumnProfile[];
  schemaRequest: AiMappingRequest | null;
  selectedRowNumbers: ReadonlySet<number>;
  reservationUnits: number;
}>;

export type AutoConvertExecution = Readonly<{
  recipe: MappingRecipe;
  states: MappingStates;
  rows: readonly AutoConvertCanonicalRow[];
  provenance: readonly AutoConvertProvenance[];
  issues: readonly AutoConvertReviewIssue[];
  mappingDecisions: readonly AutoConvertMappingDecision[];
  retryableRowNumbers: readonly number[];
  providerCalls: number;
  providerRowsCompleted: number;
  usageUnits: number;
  partial: boolean;
  schemaUsed: boolean;
  extractedFieldCount: number;
  normalizedValueCount: number;
}>;

export class AutoConvertProviderError extends Error {
  constructor(public readonly stage: "schema" | "extraction") {
    super("AUTO_CONVERT_PROVIDER_UNAVAILABLE");
    this.name = "AutoConvertProviderError";
  }
}

function cloneRecipe(recipe: MappingRecipe): MappingRecipe {
  return Object.fromEntries(CANONICAL_FIELDS.map((field) => [
    field,
    recipe[field]
      ? { sources: [...(recipe[field]?.sources ?? [])], strategy: recipe[field]?.strategy ?? "direct" }
      : null,
  ])) as MappingRecipe;
}

function selectedRows(parsed: ParsedCsv, requested?: readonly number[]): ReadonlySet<number> {
  const available = new Set(parsed.rows.map((row) => row.rowNumber));
  if (!requested?.length) return available;
  return new Set(requested.filter((rowNumber) => available.has(rowNumber)));
}

function currentMappings(recipe: MappingRecipe): AiMappingRequest["current_mappings"] {
  return CANONICAL_FIELDS.flatMap((field) => recipe[field]
    ? [{ target: field, source_count: recipe[field]?.sources.length ?? 1 }]
    : []);
}

function likelyProviderRows(
  parsed: ParsedCsv,
  recipe: MappingRecipe,
  profiles: readonly AiMappingColumnProfile[],
  selected: ReadonlySet<number>,
): number[] {
  const relevant = relevantSourceIndexes(parsed, recipe, profiles);
  return parsed.rows
    .filter((row) => selected.has(row.rowNumber))
    .filter((row) => unresolvedTargets(normalizedMappedValues(row, parsed.headers, recipe), recipe).length > 0)
    .filter((row) => relevant.some((index) => Boolean(sanitizeCsvText(row.values[index] ?? ""))))
    .map((row) => row.rowNumber);
}

export function buildAutoConvertPlan(
  parsed: ParsedCsv,
  options: { rowNumbers?: readonly number[]; recipe?: MappingRecipe } = {},
): AutoConvertPlan {
  const deterministic = options.recipe
    ? { recipe: cloneRecipe(options.recipe), states: createMappingPlan(parsed.headers).states }
    : createMappingPlan(parsed.headers);
  const selected = selectedRows(parsed, options.rowNumbers);
  const profiles = profileSourceColumns(parsed);
  const ignored = ignoredSourceColumns(parsed.headers, deterministic.recipe);
  const schemaColumns = profileSourceColumns(parsed, ignored)
    .filter((column) => column.profile !== "mostly_empty");
  const hasUnmappedTarget = CANONICAL_FIELDS.some((field) => !deterministic.recipe[field]);
  const schemaRequest = !options.recipe && hasUnmappedTarget && schemaColumns.length
    ? { columns: schemaColumns, current_mappings: currentMappings(deterministic.recipe) }
    : null;
  const rowCandidates = likelyProviderRows(
    parsed,
    deterministic.recipe,
    profiles,
    selected,
  );
  const providerIntent = Boolean(schemaRequest) || rowCandidates.length > 0;
  return {
    parsed,
    recipe: deterministic.recipe,
    states: deterministic.states,
    profiles,
    schemaRequest,
    selectedRowNumbers: selected,
    reservationUnits: providerIntent ? Math.max(1, rowCandidates.length) : 0,
  };
}

function applySchemaSuggestions(
  parsed: ParsedCsv,
  recipe: MappingRecipe,
  states: MappingStates,
  suggestions: readonly AiMappingSuggestion[],
): {
  decisions: AutoConvertMappingDecision[];
  mediumSources: Set<number>;
  issues: AutoConvertReviewIssue[];
} {
  const decisions: AutoConvertMappingDecision[] = [];
  const mediumSources = new Set<number>();
  const issues: AutoConvertReviewIssue[] = [];

  for (const suggestion of suggestions) {
    const source = parsed.headers.indexOf(suggestion.source_column);
    const target = suggestion.target;
    let applied = false;
    let reviewRecommended = false;
    if (source >= 0 && target !== "IGNORE" && suggestion.confidence !== "LOW") {
      const critical = CRITICAL_FIELDS.has(target as AutoConvertExtractionTarget);
      if (critical && suggestion.confidence !== "HIGH") {
        issues.push({
          rowNumber: null,
          level: "NEEDS_REVIEW",
          target,
          message: `${suggestion.source_column} was not auto-applied to ${target.replaceAll("_", " ")} because a critical field requires high confidence.`,
        });
      } else {
        const existing = recipe[target]?.sources ?? [];
        const sourceUsedElsewhere = usedSourceColumns(recipe).has(source) && !existing.includes(source);
        const mergeable = MERGEABLE_MAPPING_FIELDS.has(target);
        if (
          !sourceUsedElsewhere
          && (!existing.length || mergeable)
          && existing.length < MAX_MAPPING_MERGE_COLUMNS
        ) {
          const sources = existing.includes(source) ? existing : [...existing, source];
          recipe[target] = {
            sources,
            strategy: sources.length === 1
              ? "direct"
              : target === "customer_name" ? "join_space" : "join_newline",
          };
          states[target] = suggestion.confidence === "HIGH" ? "auto_mapped" : "suggested";
          applied = true;
          reviewRecommended = suggestion.confidence === "MEDIUM";
          if (reviewRecommended) mediumSources.add(source);
        }
      }
    }
    decisions.push({
      sourceColumn: suggestion.source_column,
      target,
      confidence: suggestion.confidence,
      applied,
      reviewRecommended,
      reason: suggestion.reason,
    });
  }
  return { decisions, mediumSources, issues };
}

function normalizedMappedValues(
  row: ParsedCsvRow,
  headers: readonly string[],
  recipe: MappingRecipe,
): Record<CanonicalField, string> {
  const values = applyMappingRecipe(row, headers, recipe);
  const dealValue = normalizeDealValue(values.deal_value);
  if (dealValue.value) values.deal_value = dealValue.value;
  const quoteDate = normalizeQuoteDateWithFormat(values.quote_date);
  if (quoteDate.value) values.quote_date = quoteDate.value;
  if (recipe.status && values.status) {
    const status = normalizeLostStatusWithResolutions(values.status);
    if (status.value) values.status = status.value;
  }
  return values;
}

function unresolvedTargets(
  values: Readonly<Record<CanonicalField, string>>,
  recipe: MappingRecipe,
): AutoConvertExtractionTarget[] {
  const targets: AutoConvertExtractionTarget[] = [];
  for (const target of AUTO_CONVERT_EXTRACTION_TARGETS) {
    const raw = values[target];
    if (target === "deal_value") {
      if (!raw) targets.push(target);
      continue;
    }
    if (target === "quote_date") {
      if (!raw) targets.push(target);
      continue;
    }
    if (target === "status") {
      if (!recipe.status || !raw) targets.push(target);
      continue;
    }
    if (!raw) targets.push(target);
  }
  return targets;
}

function relevantSourceIndexes(
  parsed: ParsedCsv,
  recipe: MappingRecipe,
  profiles: readonly AiMappingColumnProfile[],
): number[] {
  const byHeader = new Map(profiles.map((profile) => [profile.source_column, profile.profile]));
  const supportedProfile = (index: number) => {
    const profile = byHeader.get(parsed.headers[index]);
    return profile === "long_text" || profile === "short_text" || profile === "categorical_like"
      || profile === "currency_like" || profile === "date_like";
  };
  const preferred = new Set<number>([
    ...(recipe.sales_notes?.sources ?? []),
    ...(recipe.transcript?.sources ?? []),
    ...ignoredSourceColumns(parsed.headers, recipe),
    ...profiles.map((_, index) => index),
  ]);
  return [...preferred]
    .filter(supportedProfile)
    .slice(0, AUTO_CONVERT_MAX_SOURCE_COLUMNS);
}

function sourceBundle(
  row: ParsedCsvRow,
  headers: readonly string[],
  indexes: readonly number[],
  issues: AutoConvertReviewIssue[],
): AutoConvertExtractionRequest["rows"][number]["sources"] {
  const sources: AutoConvertExtractionRequest["rows"][number]["sources"] = [];
  let aggregate = 0;
  for (const index of indexes) {
    const value = sanitizeCsvText(row.values[index] ?? "");
    if (!value) continue;
    if (value.length > AUTO_CONVERT_MAX_SOURCE_VALUE_CHARACTERS) {
      issues.push({
        rowNumber: row.rowNumber,
        level: "NEEDS_REVIEW",
        target: null,
        message: `${headers[index]} exceeds the safe Auto Convert source limit and was not silently truncated.`,
      });
      continue;
    }
    if (aggregate + value.length > AUTO_CONVERT_MAX_ROW_SOURCE_CHARACTERS) {
      issues.push({
        rowNumber: row.rowNumber,
        level: "NEEDS_REVIEW",
        target: null,
        message: "This row has more relevant source text than can be safely processed at once.",
      });
      continue;
    }
    sources.push({ column: headers[index], value });
    aggregate += value.length;
  }
  return sources;
}

export function buildAutoConvertBatches(
  rows: readonly AutoConvertExtractionRequest["rows"][number][],
): AutoConvertExtractionRequest[] {
  const batches: AutoConvertExtractionRequest[] = [];
  let current: AutoConvertExtractionRequest["rows"] = [];
  for (const row of rows) {
    const candidate = { rows: [...current, row] };
    if (
      current.length > 0
      && (current.length >= AUTO_CONVERT_MAX_ROWS_PER_BATCH
        || JSON.stringify(candidate).length > AUTO_CONVERT_MAX_BATCH_CHARACTERS)
    ) {
      batches.push({ rows: current });
      current = [];
    }
    current.push(row);
  }
  if (current.length) batches.push({ rows: current });
  return batches;
}

function evidenceText(value: string): string {
  return sanitizeCsvText(value).normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function supportedMoneyValues(evidence: string): Set<string> {
  if (/\d{1,3}(?:\.\d{3})+,\d{2}/.test(evidence)) return new Set();
  const values = new Set<string>();
  const expressions = evidence.match(/(?:USD\s*|\$\s*)?-?\d+(?:,\d{3})*(?:\.\d{1,2})?\s*[kK]?/g) ?? [];
  for (const expression of expressions) {
    if (expression.includes("-")) continue;
    const compact = expression.replace(/^USD\s*/i, "").replace(/^\$\s*/, "").replaceAll(",", "").trim();
    const thousands = /k$/i.test(compact);
    const numeric = Number(compact.replace(/k$/i, ""));
    if (!Number.isFinite(numeric) || numeric < 0) continue;
    const expanded = thousands ? numeric * 1_000 : numeric;
    const normalized = normalizeDealValue(String(expanded));
    if (normalized.value) values.add(normalized.value);
  }
  return values;
}

function supportedDateValues(evidence: string): Set<string> {
  const values = new Set<string>();
  const expressions = evidence.match(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/g) ?? [];
  for (const expression of expressions) {
    const normalized = normalizeQuoteDateWithFormat(expression);
    if (normalized.value && !normalized.needsReview) values.add(normalized.value);
  }
  return values;
}

function validatedExtractionValue(
  target: AutoConvertExtractionTarget,
  value: string,
  evidence: string,
  sourceText: string,
): string | null {
  const cleanValue = sanitizeCsvText(value);
  if (!cleanValue || cleanValue.length > FIELD_MAX_LENGTHS[target]) return null;
  if (target === "deal_value") {
    const normalized = normalizeDealValue(cleanValue);
    return normalized.value && supportedMoneyValues(evidence).has(normalized.value)
      ? normalized.value
      : null;
  }
  if (target === "quote_date") {
    const normalized = normalizeQuoteDateWithFormat(cleanValue);
    return normalized.value && !normalized.needsReview && supportedDateValues(evidence).has(normalized.value)
      ? normalized.value
      : null;
  }
  if (target === "status") {
    const normalized = normalizeLostStatusWithResolutions(cleanValue);
    return normalized.value === "lost" && sourceIndicatesLost(evidence)
      ? "lost"
      : null;
  }
  if (target === "salesperson") {
    const escaped = cleanValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const attributed = new RegExp(
      `(?:\\b${escaped}\\b.{0,40}\\b(?:handled|quoted|prepared|sent|presented|owned)\\b|\\b(?:rep|salesperson|closer|owner|quoted by)\\b.{0,40}\\b${escaped}\\b)`,
      "i",
    );
    return evidenceText(evidence).includes(evidenceText(cleanValue)) && attributed.test(sourceText)
      ? cleanValue
      : null;
  }
  if (target === "lead_source") {
    return evidenceText(evidence).includes(evidenceText(cleanValue))
      && /\b(?:lead\s+(?:came|is|was)\s+from|lead\s+source|source(?:d)?\s+from|referred\s+by|via)\b/i.test(sourceText)
      ? cleanValue
      : null;
  }
  if (target === "customer_name") {
    const escaped = cleanValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return evidenceText(evidence).includes(evidenceText(cleanValue))
      && new RegExp(`(?:\\b(?:customer|client|prospect|company|account|name)\\b.{0,30}\\b${escaped}\\b|\\b${escaped}\\b.{0,30}\\b(?:customer|client|prospect|requested|asked|said|wants|declined)\\b)`, "i").test(sourceText)
      ? cleanValue
      : null;
  }
  if (target === "external_deal_id") {
    const escaped = cleanValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return evidenceText(evidence).includes(evidenceText(cleanValue))
      && new RegExp(`\\b(?:deal|quote|estimate|opportunity|job|crm)\\s*(?:id|number|no\\.?|#)\\s*[:#-]?\\s*${escaped}\\b`, "i").test(sourceText)
      ? cleanValue
      : null;
  }
  if (target === "service_type") {
    const escaped = cleanValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return evidenceText(evidence).includes(evidenceText(cleanValue))
      && new RegExp(`(?:\\b(?:for|service|job|product|system|project|quoted?|proposal)\\b.{0,45}\\b${escaped}\\b|\\b${escaped}\\b.{0,45}\\b(?:service|job|product|system|project|quoted?|proposal)\\b)`, "i").test(sourceText)
      ? cleanValue
      : null;
  }
  return evidenceText(evidence).includes(evidenceText(cleanValue)) ? cleanValue : null;
}

function preserveExtractionSource(
  values: Record<CanonicalField, string>,
  sourceColumn: string,
  sourceValue: string,
): boolean {
  const normalizedSource = evidenceText(sourceValue);
  const labelled = `${sanitizeCsvText(sourceColumn)}: ${sanitizeCsvText(sourceValue)}`;
  if (evidenceText(values.transcript).includes(normalizedSource)) return true;
  if (evidenceText(values.sales_notes) === normalizedSource) {
    if (labelled.length > FIELD_MAX_LENGTHS.sales_notes) return false;
    values.sales_notes = labelled;
    return true;
  }
  if (evidenceText(values.sales_notes).includes(normalizedSource)) return true;
  const merged = values.sales_notes ? `${values.sales_notes}\n${labelled}` : labelled;
  if (merged.length > FIELD_MAX_LENGTHS.sales_notes) return false;
  values.sales_notes = merged;
  return true;
}

function applyExtractionOutput(
  request: AutoConvertExtractionRequest,
  rawOutput: unknown,
  rowValues: Map<number, Record<CanonicalField, string>>,
  provenance: AutoConvertProvenance[],
  issues: AutoConvertReviewIssue[],
): Set<number> {
  const output = AutoConvertExtractionOutputSchema.parse(rawOutput);
  const requested = new Map(request.rows.map((row) => [row.row_reference, row]));
  const seenRows = new Set<number>();
  for (const result of output.results) {
    const input = requested.get(result.row_reference);
    const values = rowValues.get(result.row_reference);
    if (!input || !values || seenRows.has(result.row_reference)) {
      throw new Error("AUTO_CONVERT_UNKNOWN_OR_DUPLICATE_ROW");
    }
    seenRows.add(result.row_reference);
    const seenTargets = new Set<AutoConvertExtractionTarget>();
    for (const field of result.fields) {
      if (seenTargets.has(field.target)) throw new Error("AUTO_CONVERT_DUPLICATE_TARGET");
      seenTargets.add(field.target);
      if (!input.unresolved_targets.includes(field.target)) {
        issues.push({ rowNumber: result.row_reference, level: "NEEDS_REVIEW", target: field.target, message: "An unsupported extraction target was rejected." });
        continue;
      }
      const source = input.sources.find((candidate) => candidate.column === field.source_column);
      if (!source || !evidenceText(source.value).includes(evidenceText(field.evidence))) {
        issues.push({ rowNumber: result.row_reference, level: "NEEDS_REVIEW", target: field.target, message: `Unsupported ${field.target.replaceAll("_", " ")} evidence was rejected.` });
        continue;
      }
      if (sourceIndicatesWon(source.value) && field.target === "status") {
        values.status = "Won";
        issues.push({ rowNumber: result.row_reference, level: "NEEDS_REVIEW", target: "status", message: "Won or sold source evidence cannot be converted to Lost." });
        continue;
      }
      const normalized = validatedExtractionValue(field.target, field.value, field.evidence, source.value);
      if (!normalized) {
        issues.push({ rowNumber: result.row_reference, level: "NEEDS_REVIEW", target: field.target, message: `Unsupported ${field.target.replaceAll("_", " ")} evidence was rejected.` });
        continue;
      }
      if (field.confidence === "LOW" || (CRITICAL_FIELDS.has(field.target) && field.confidence !== "HIGH")) {
        issues.push({ rowNumber: result.row_reference, level: "NEEDS_REVIEW", target: field.target, message: `${field.target.replaceAll("_", " ")} was not auto-applied because confidence was insufficient.` });
        continue;
      }
      if (!preserveExtractionSource(values, source.column, source.value)) {
        issues.push({ rowNumber: result.row_reference, level: "NEEDS_REVIEW", target: field.target, message: "Supporting source text could not be preserved within the existing safe storage limit." });
        continue;
      }
      values[field.target] = normalized;
      provenance.push({
        rowNumber: result.row_reference,
        target: field.target,
        value: normalized,
        confidence: field.confidence,
        sourceColumn: source.column,
        evidence: field.evidence,
      });
      if (field.confidence === "MEDIUM") {
        issues.push({ rowNumber: result.row_reference, level: "REVIEW_RECOMMENDED", target: field.target, message: `${field.target.replaceAll("_", " ")} was supported but is worth reviewing.` });
      }
    }
  }
  return seenRows;
}

export async function executeAutoConvertPlan(
  plan: AutoConvertPlan,
  mappingRunner: AiMappingRunner,
  extractionRunner: AutoConvertExtractionRunner,
): Promise<AutoConvertExecution> {
  const recipe = cloneRecipe(plan.recipe);
  const states = { ...plan.states };
  const issues: AutoConvertReviewIssue[] = [];
  const provenance: AutoConvertProvenance[] = [];
  const mappingDecisions: AutoConvertMappingDecision[] = [];
  const mediumMappingSources = new Set<number>();
  let providerCalls = 0;
  let schemaUsed = false;

  if (plan.schemaRequest) {
    try {
      providerCalls += 1;
      const suggestions = await suggestCsvMapping(plan.schemaRequest, mappingRunner);
      schemaUsed = true;
      const applied = applySchemaSuggestions(plan.parsed, recipe, states, suggestions);
      mappingDecisions.push(...applied.decisions);
      applied.mediumSources.forEach((source) => mediumMappingSources.add(source));
      issues.push(...applied.issues);
    } catch {
      throw new AutoConvertProviderError("schema");
    }
  }

  const valuesByRow = new Map<number, Record<CanonicalField, string>>();
  let normalizedValueCount = 0;
  for (const row of plan.parsed.rows) {
    const before = applyMappingRecipe(row, plan.parsed.headers, recipe);
    const values = normalizedMappedValues(row, plan.parsed.headers, recipe);
    normalizedValueCount += ["deal_value", "quote_date", "status"].filter(
      (field) => before[field as CanonicalField] && before[field as CanonicalField] !== values[field as CanonicalField],
    ).length;
    if (sourceIndicatesWon(row.values.join(" "))) values.status = "Won";
    valuesByRow.set(row.rowNumber, values);
    if (mediumMappingSources.size && [...mediumMappingSources].some((source) => Boolean(row.values[source]?.trim()))) {
      issues.push({ rowNumber: row.rowNumber, level: "REVIEW_RECOMMENDED", target: null, message: "A medium-confidence non-critical column mapping was applied." });
    }
  }

  const relevant = relevantSourceIndexes(plan.parsed, recipe, plan.profiles);
  const extractionRows: AutoConvertExtractionRequest["rows"] = [];
  for (const row of plan.parsed.rows) {
    if (!plan.selectedRowNumbers.has(row.rowNumber)) continue;
    const values = valuesByRow.get(row.rowNumber) as Record<CanonicalField, string>;
    const targets = unresolvedTargets(values, recipe);
    if (!targets.length) continue;
    const sources = sourceBundle(row, plan.parsed.headers, relevant, issues);
    if (sources.length) {
      extractionRows.push({ row_reference: row.rowNumber, unresolved_targets: targets, sources });
    }
  }

  const batches = buildAutoConvertBatches(extractionRows);
  const retryable = new Set<number>();
  let providerRowsCompleted = 0;
  let partial = false;
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += AUTO_CONVERT_BATCH_CONCURRENCY) {
    const wave = batches.slice(batchIndex, batchIndex + AUTO_CONVERT_BATCH_CONCURRENCY);
    providerCalls += wave.length;
    const outcomes = await Promise.allSettled(wave.map((batch) => extractionRunner(batch)));
    let waveFailed = false;
    for (let waveIndex = 0; waveIndex < wave.length; waveIndex += 1) {
      const batch = wave[waveIndex];
      const outcome = outcomes[waveIndex];
      if (outcome.status === "rejected") {
        waveFailed = true;
        batch.rows.forEach((row) => retryable.add(row.row_reference));
        continue;
      }
      try {
        const completed = applyExtractionOutput(batch, outcome.value, valuesByRow, provenance, issues);
        providerRowsCompleted += batch.rows.length;
        for (const row of batch.rows) {
          if (!completed.has(row.row_reference)) {
            issues.push({ rowNumber: row.row_reference, level: "NEEDS_REVIEW", target: null, message: "The provider returned no supported result for this row." });
          }
        }
      } catch {
        waveFailed = true;
        batch.rows.forEach((row) => retryable.add(row.row_reference));
      }
    }
    if (waveFailed) {
      partial = true;
      for (const remaining of batches.slice(batchIndex + wave.length)) {
        remaining.rows.forEach((row) => retryable.add(row.row_reference));
      }
      break;
    }
  }

  for (const row of plan.parsed.rows) {
    const values = valuesByRow.get(row.rowNumber) as Record<CanonicalField, string>;
    if (!values.status) {
      values.status = "Needs review";
      issues.push({ rowNumber: row.rowNumber, level: "NEEDS_REVIEW", target: "status", message: "Status was not explicit in the supplied source." });
    }
  }

  const usageUnits = providerRowsCompleted > 0
    ? providerRowsCompleted
    : schemaUsed && !partial ? 1 : 0;
  return {
    recipe,
    states,
    rows: plan.parsed.rows.map((row) => ({
      rowNumber: row.rowNumber,
      values: valuesByRow.get(row.rowNumber) as Record<CanonicalField, string>,
    })),
    provenance,
    issues,
    mappingDecisions,
    retryableRowNumbers: [...retryable].sort((a, b) => a - b),
    providerCalls,
    providerRowsCompleted,
    usageUnits,
    partial,
    schemaUsed,
    extractedFieldCount: provenance.length,
    normalizedValueCount,
  };
}
