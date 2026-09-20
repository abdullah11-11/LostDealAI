"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSpreadsheet,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { Badge, Button, Card, Select, Table, buttonStyles } from "@/components/ui";
import type { AutoConvertAccessState } from "@/lib/billing/auto-convert-access";
import type { PlanCode } from "@/lib/billing/plans";
import type { AiMappingSuggestion } from "@/lib/csv/ai-mapping-schema";
import {
  CANONICAL_FIELDS,
  FIELD_DETAILS,
  MAX_CSV_FILE_BYTES,
  MAX_CSV_ROWS,
  MAX_MAPPING_MERGE_COLUMNS,
  type CanonicalField,
} from "@/lib/csv/constants";
import { createCanonicalCsv } from "@/lib/csv/export";
import {
  createMappingPlan,
  ignoredSourceColumns,
  usedSourceColumns,
  validateMappingRecipe,
  type MappingRecipe,
  type MappingState,
  type MappingStates,
} from "@/lib/csv/mapping";
import { profileSourceColumns } from "@/lib/csv/profiling";
import {
  applyMappingRecipe,
  normalizeDealValue,
  normalizeQuoteDateWithFormat,
  parseCsvText,
  validateCsvFileMetadata,
  validateParsedCsvShape,
  type ParsedCsv,
  type SourceDateFormat,
  type StatusResolution,
  type StatusResolutions,
} from "@/lib/csv/validation";
import { formatDealCurrency } from "@/lib/deals/format";

export type RecentImport = {
  id: string;
  filename: string;
  createdAt: string;
  rowsImported: number;
  status: "pending" | "processing" | "completed" | "failed";
};

type IssueRow = {
  rowNumber: number;
  customer: string | null;
  externalDealId: string | null;
  errors: string[];
  issues?: Array<{ category: "mapping" | "value" | "duplicate" | "row"; code: string; message: string }>;
};

type ValidationSummary = {
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
  issueGroups: Record<"mapping" | "value" | "duplicate" | "row", number>;
  invalid: IssueRow[];
  needsReview: IssueRow[];
  issueRowsTruncated: boolean;
  preview: Array<{
    rowNumber: number;
    customer_name: string | null;
    deal_value: string;
    quote_date: string | null;
    service_type: string | null;
    salesperson: string | null;
    original_deal_value: string;
    original_quote_date: string;
    context: string;
  }>;
};

type ImportResult = {
  uploadId: string;
  filename: string;
  organizationName: string;
  insertedCount: number;
  invalidRows: number;
  createdAt: string;
};

type AutoConvertUiAccess = {
  planCode: PlanCode | null;
  state: AutoConvertAccessState;
  entitled: boolean;
  providerExecutionAllowed: boolean;
  trialPreviewEligible: boolean;
};

type AutoConvertRow = {
  rowNumber: number;
  values: Record<CanonicalField, string>;
};

type AutoConvertDetail = {
  rowNumber: number | null;
  level: "REVIEW_RECOMMENDED" | "NEEDS_REVIEW";
  target: CanonicalField | null;
  message: string;
};

type AutoConvertProvenance = {
  rowNumber: number;
  target: CanonicalField;
  value: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  sourceColumn: string;
  evidence: string;
};

type AutoConvertMapping = {
  sourceColumn: string;
  target: CanonicalField | "IGNORE";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  applied: boolean;
  reviewRecommended: boolean;
  reason: string;
};

type AutoConvertSummary = {
  totalRows: number;
  ready: number;
  reviewRecommended: number;
  needsReview: number;
  invalid: number;
  extractedFields: number;
  normalizedValues: number;
};

type AutoConvertResult = {
  partial: boolean;
  sourceFilename: string;
  canonicalFilename: string;
  rows: AutoConvertRow[];
  sourceRecipe: MappingRecipe;
  summary: AutoConvertSummary;
  provenance: AutoConvertProvenance[];
  issues: AutoConvertDetail[];
  mappings: AutoConvertMapping[];
  detailsTruncated: boolean;
  retryableRowNumbers: number[];
};

type Stage = "select" | "mapping" | "review" | "import" | "success";

const STEP_LABELS: Array<{ key: Exclude<Stage, "success">; label: string }> = [
  { key: "select", label: "Select CSV" },
  { key: "mapping", label: "Map & Normalize" },
  { key: "review", label: "Review" },
  { key: "import", label: "Import" },
];

const MERGE_FIELDS = new Set<CanonicalField>(["customer_name", "sales_notes", "transcript"]);

function stageIndex(stage: Stage): number {
  if (stage === "success") return 4;
  return STEP_LABELS.findIndex((step) => step.key === stage);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  return `${(bytes / 1024).toFixed(bytes < 1024 * 100 ? 1 : 0)} KB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}

function statusTone(status: RecentImport["status"]): "pending" | "completed" | "failed" {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "pending";
}

function mappingStateLabel(state: MappingState): string {
  return ({
    auto_mapped: "Auto-mapped",
    suggested: "Suggested",
    needs_review: "Needs review",
    manually_confirmed: "Manually confirmed",
  } as const)[state];
}

function mappingStateTone(state: MappingState): "completed" | "pending" | "failed" | "neutral" {
  if (state === "auto_mapped" || state === "manually_confirmed") return "completed";
  if (state === "suggested") return "pending";
  return "neutral";
}

function strategyFor(field: CanonicalField, sourceCount: number) {
  if (sourceCount <= 1) return "direct" as const;
  return field === "customer_name" ? "join_space" as const : "join_newline" as const;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function CsvImportWorkflow({
  organizationName,
  recentImports,
  recentImportsUnavailable,
  autoConvertAccess,
}: {
  organizationName: string;
  recentImports: RecentImport[];
  recentImportsUnavailable?: boolean;
  autoConvertAccess: AutoConvertUiAccess;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const smartMappingRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("select");
  const [file, setFile] = useState<File | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [recipe, setRecipe] = useState<MappingRecipe | null>(null);
  const [mappingStates, setMappingStates] = useState<MappingStates | null>(null);
  const [dateFormat, setDateFormat] = useState<SourceDateFormat>("AUTO");
  const [statusResolutions, setStatusResolutions] = useState<StatusResolutions>({});
  const [validation, setValidation] = useState<ValidationSummary | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AiMappingSuggestion[]>([]);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);
  const [skipConfirmed, setSkipConfirmed] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [autoConvertBusy, setAutoConvertBusy] = useState(false);
  const [autoConvertProgress, setAutoConvertProgress] = useState<string | null>(null);
  const [autoConvertMessage, setAutoConvertMessage] = useState<string | null>(null);
  const [autoConvertResult, setAutoConvertResult] = useState<AutoConvertResult | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [imports, setImports] = useState(recentImports);

  const currentStep = stageIndex(stage);
  const skippedRows = validation ? validation.needsReviewRows + validation.invalidRows : 0;

  function resetImport() {
    setStage("select");
    setFile(null);
    setSourceFile(null);
    setParsed(null);
    setRecipe(null);
    setMappingStates(null);
    setDateFormat("AUTO");
    setStatusResolutions({});
    setValidation(null);
    setAiSuggestions([]);
    setAiMessage(null);
    setAutoConvertProgress(null);
    setAutoConvertMessage(null);
    setAutoConvertResult(null);
    setDownloadMessage(null);
    setSkipConfirmed(false);
    setResult(null);
    setError(null);
    setMappingError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function selectFile(selectedFile: File | null) {
    setError(null);
    setMappingError(null);
    setValidation(null);
    if (!selectedFile) {
      setError("Choose a CSV file to continue.");
      return;
    }
    const metadataError = validateCsvFileMetadata(selectedFile);
    if (metadataError) {
      setError(metadataError);
      return;
    }
    try {
      const csv = parseCsvText(await selectedFile.text());
      const shapeError = validateParsedCsvShape(csv);
      if (shapeError) {
        setError(shapeError);
        return;
      }
      const plan = createMappingPlan(csv.headers);
      setFile(selectedFile);
      setSourceFile(selectedFile);
      setParsed(csv);
      setRecipe(plan.recipe);
      setMappingStates(plan.states);
      setDateFormat("AUTO");
      setStatusResolutions({});
      setAiSuggestions([]);
      setAiMessage(null);
      setAutoConvertProgress(null);
      setAutoConvertMessage(null);
      setAutoConvertResult(null);
      setStage("mapping");
    } catch {
      setError("LostDeal AI could not read this CSV. Confirm it is valid UTF-8 text and try again.");
    }
  }

  function duplicateOwner(field: CanonicalField, source: number): CanonicalField | null {
    if (!recipe) return null;
    return CANONICAL_FIELDS.find(
      (candidate) => candidate !== field && (recipe[candidate]?.sources ?? []).includes(source),
    ) ?? null;
  }

  function setMappedSource(field: CanonicalField, slot: number, rawValue: string) {
    if (!recipe || !parsed || !mappingStates) return;
    const currentSources = [...(recipe[field]?.sources ?? [])];
    if (rawValue === "") currentSources.splice(slot, 1);
    else {
      const source = Number(rawValue);
      const owner = duplicateOwner(field, source);
      if (owner || currentSources.some((value, index) => index !== slot && value === source)) {
        setMappingError(
          `${parsed.headers[source] ?? "That column"} is already mapped${owner ? ` to ${FIELD_DETAILS[owner].label}` : " in this field"}. Choose a different source column.`,
        );
        return;
      }
      currentSources[slot] = source;
    }
    const next = {
      ...recipe,
      [field]: currentSources.length
        ? { sources: currentSources, strategy: strategyFor(field, currentSources.length) }
        : null,
    };
    setRecipe(next);
    setMappingStates({ ...mappingStates, [field]: currentSources.length ? "manually_confirmed" : "needs_review" });
    setMappingError(null);
    setValidation(null);
  }

  function addMappedSource(field: CanonicalField, rawValue: string) {
    if (!recipe || !parsed || !mappingStates || rawValue === "") return;
    const source = Number(rawValue);
    const existing = recipe[field]?.sources ?? [];
    const owner = duplicateOwner(field, source);
    if (owner || existing.includes(source)) {
      setMappingError(`${parsed.headers[source] ?? "That column"} is already mapped. Choose a different source column.`);
      return;
    }
    if (existing.length >= MAX_MAPPING_MERGE_COLUMNS) {
      setMappingError(`A maximum of ${MAX_MAPPING_MERGE_COLUMNS} source columns can be merged into one field.`);
      return;
    }
    const sources = [...existing, source];
    setRecipe({ ...recipe, [field]: { sources, strategy: strategyFor(field, sources.length) } });
    setMappingStates({ ...mappingStates, [field]: "manually_confirmed" });
    setMappingError(null);
    setValidation(null);
  }

  function confirmSuggestion(field: CanonicalField) {
    if (!mappingStates) return;
    setMappingStates({ ...mappingStates, [field]: "manually_confirmed" });
  }

  function confirmAllSuggestions() {
    if (!mappingStates) return;
    setMappingStates(Object.fromEntries(CANONICAL_FIELDS.map((field) => [
      field,
      mappingStates[field] === "suggested" ? "manually_confirmed" : mappingStates[field],
    ])) as MappingStates);
  }

  function formDataForCurrentFile(includeConfirmation = false): FormData | null {
    if (!file || !recipe) return null;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mapping_recipe", JSON.stringify(recipe));
    formData.append("date_format", dateFormat);
    formData.append("status_resolutions", JSON.stringify(statusResolutions));
    if (includeConfirmation) formData.append("confirm_skipped", String(skipConfirmed));
    return formData;
  }

  async function reviewFile(stayOnReview = false) {
    if (!parsed || !recipe || !mappingStates) return;
    const pendingSuggestions = CANONICAL_FIELDS.filter((field) => mappingStates[field] === "suggested");
    if (pendingSuggestions.length) {
      setMappingError("Confirm each Suggested mapping—or use Confirm all suggestions—before server validation.");
      if (stayOnReview) setStage("mapping");
      return;
    }
    const errors = validateMappingRecipe(recipe, parsed.headers.length);
    if (errors.length) {
      setMappingError(errors.join(" "));
      if (stayOnReview) setStage("mapping");
      return;
    }
    const formData = formDataForCurrentFile();
    if (!formData) return;
    setBusy(true);
    setError(null);
    setMappingError(null);
    setDownloadMessage(null);
    try {
      const response = await fetch("/api/uploads/validate", { method: "POST", body: formData });
      const body = await responseJson(response);
      if (!response.ok || !body.validation) {
        throw new Error(typeof body.error === "string" ? body.error : "CSV validation failed.");
      }
      setValidation(body.validation as ValidationSummary);
      setSkipConfirmed(false);
      setStage("review");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "CSV validation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function requestAiSuggestions() {
    if (!parsed || !recipe || aiBusy) return;
    const candidates = ignoredSourceColumns(parsed.headers, recipe);
    if (!candidates.length) {
      setAiMessage("All source columns are already mapped or intentionally used. Manual edits remain available.");
      return;
    }
    setAiBusy(true);
    setAiMessage(null);
    setAiSuggestions([]);
    try {
      const response = await fetch("/api/uploads/suggest-mapping", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          columns: profileSourceColumns(parsed, candidates),
          current_mappings: CANONICAL_FIELDS.flatMap((field) => recipe[field]
            ? [{ target: field, source_count: recipe[field]?.sources.length ?? 1 }]
            : []),
        }),
      });
      const body = await responseJson(response);
      if (!response.ok || !Array.isArray(body.suggestions)) {
        throw new Error(typeof body.error === "string" ? body.error : "AI suggestions are unavailable right now. You can continue mapping manually.");
      }
      setAiSuggestions(body.suggestions as AiMappingSuggestion[]);
      setAiMessage("Suggestions are ready. Apply only the mappings that match your source data.");
    } catch (requestError) {
      setAiMessage(requestError instanceof Error ? requestError.message : "AI suggestions are unavailable right now. You can continue mapping manually.");
    } finally {
      setAiBusy(false);
    }
  }

  function applyAiSuggestion(suggestion: AiMappingSuggestion) {
    if (!parsed || !recipe || !mappingStates) return;
    setAiSuggestions((current) => current.filter((item) => item.source_column !== suggestion.source_column));
    if (suggestion.target === "IGNORE") return;
    const source = parsed.headers.indexOf(suggestion.source_column);
    if (source < 0 || usedSourceColumns(recipe).has(source)) {
      setMappingError(`${suggestion.source_column} is already mapped or is no longer available.`);
      return;
    }
    const field = suggestion.target;
    const existing = recipe[field]?.sources ?? [];
    if (existing.length && !MERGE_FIELDS.has(field)) {
      setMappingError(`${FIELD_DETAILS[field].label} already has a source. Review it manually before applying this AI suggestion.`);
      return;
    }
    if (existing.length >= MAX_MAPPING_MERGE_COLUMNS) {
      setMappingError(`${FIELD_DETAILS[field].label} already uses the maximum number of source columns.`);
      return;
    }
    const sources = [...existing, source];
    setRecipe({ ...recipe, [field]: { sources, strategy: strategyFor(field, sources.length) } });
    setMappingStates({ ...mappingStates, [field]: "suggested" });
    setMappingError(null);
    setValidation(null);
  }

  async function validateCanonicalFile(
    canonicalFile: File,
    canonicalRecipe: MappingRecipe,
  ): Promise<ValidationSummary> {
    const formData = new FormData();
    formData.append("file", canonicalFile);
    formData.append("mapping_recipe", JSON.stringify(canonicalRecipe));
    formData.append("date_format", "AUTO");
    formData.append("status_resolutions", "{}");
    const response = await fetch("/api/uploads/validate", { method: "POST", body: formData });
    const body = await responseJson(response);
    if (!response.ok || !body.validation) {
      throw new Error(typeof body.error === "string" ? body.error : "Converted data validation failed.");
    }
    return body.validation as ValidationSummary;
  }

  async function autoConvert(retryRows?: readonly number[]) {
    if (
      !sourceFile
      || !parsed
      || autoConvertBusy
      || !autoConvertAccess.providerExecutionAllowed
    ) return;
    setAutoConvertBusy(true);
    setAutoConvertMessage(null);
    setError(null);
    setAutoConvertProgress(retryRows?.length
      ? `Preparing ${retryRows.length.toLocaleString()} unresolved ${retryRows.length === 1 ? "row" : "rows"}`
      : "Understanding file and preparing rows");
    try {
      const formData = new FormData();
      formData.append("file", sourceFile);
      formData.append("operation_id", crypto.randomUUID());
      if (retryRows?.length && autoConvertResult) {
        formData.append("row_numbers", JSON.stringify(retryRows));
        formData.append("mapping_recipe", JSON.stringify(autoConvertResult.sourceRecipe));
      }
      const response = await fetch("/api/uploads/auto-convert", { method: "POST", body: formData });
      const body = await responseJson(response);
      if (!response.ok || body.success !== true || !Array.isArray(body.rows) || !body.validation) {
        throw new Error(typeof body.error === "string"
          ? body.error
          : "Auto Convert couldn't complete this file. Your source file was not changed. You can retry or continue with Smart Mapping.");
      }
      setAutoConvertProgress("Validating results");
      const responseRows = body.rows as AutoConvertRow[];
      const retrySet = new Set(retryRows ?? []);
      const mergedRows = retryRows?.length && autoConvertResult
        ? [...autoConvertResult.rows.filter((row) => !retrySet.has(row.rowNumber)), ...responseRows]
            .sort((a, b) => a.rowNumber - b.rowNumber)
        : responseRows;
      const csv = createCanonicalCsv(mergedRows.map((row) => row.values));
      const canonicalFilename = typeof body.canonicalFilename === "string"
        ? body.canonicalFilename
        : "lostdeal-auto-converted.csv";
      const canonicalFile = new File([csv], canonicalFilename, { type: "text/csv" });
      const canonicalParsed = parseCsvText(csv);
      const canonicalPlan = createMappingPlan(canonicalParsed.headers);
      const nextValidation = retryRows?.length
        ? await validateCanonicalFile(canonicalFile, canonicalPlan.recipe)
        : body.validation as ValidationSummary;

      const responseProvenance = Array.isArray(body.provenance)
        ? body.provenance as AutoConvertProvenance[]
        : [];
      const responseIssues = Array.isArray(body.issues)
        ? body.issues as AutoConvertDetail[]
        : [];
      const responseMappings = Array.isArray(body.mappings)
        ? body.mappings as AutoConvertMapping[]
        : [];
      const mergedProvenance = retryRows?.length && autoConvertResult
        ? [...autoConvertResult.provenance.filter((item) => !retrySet.has(item.rowNumber)), ...responseProvenance]
        : responseProvenance;
      const mergedIssues = retryRows?.length && autoConvertResult
        ? [...autoConvertResult.issues.filter((item) => item.rowNumber === null || !retrySet.has(item.rowNumber)), ...responseIssues]
        : responseIssues;
      const recommendedRows = new Set(mergedIssues
        .filter((item) => item.level === "REVIEW_RECOMMENDED" && item.rowNumber !== null)
        .map((item) => item.rowNumber as number));
      const reviewRecommended = Math.min(recommendedRows.size, nextValidation.readyRows);
      const serverSummary = body.summary as AutoConvertSummary;
      const nextResult: AutoConvertResult = {
        partial: Boolean(body.partial),
        sourceFilename: typeof body.sourceFilename === "string" ? body.sourceFilename : sourceFile.name,
        canonicalFilename,
        rows: mergedRows,
        sourceRecipe: body.recipe as MappingRecipe,
        summary: {
          totalRows: nextValidation.totalRows,
          ready: Math.max(0, nextValidation.readyRows - reviewRecommended),
          reviewRecommended,
          needsReview: nextValidation.needsReviewRows,
          invalid: nextValidation.invalidRows,
          extractedFields: mergedProvenance.length,
          normalizedValues: retryRows?.length && autoConvertResult
            ? Math.max(autoConvertResult.summary.normalizedValues, Number(serverSummary?.normalizedValues ?? 0))
            : Number(serverSummary?.normalizedValues ?? 0),
        },
        provenance: mergedProvenance,
        issues: mergedIssues,
        mappings: retryRows?.length && autoConvertResult
          ? [...autoConvertResult.mappings, ...responseMappings]
          : responseMappings,
        detailsTruncated: Boolean(body.detailsTruncated) || Boolean(autoConvertResult?.detailsTruncated),
        retryableRowNumbers: Array.isArray(body.retryableRowNumbers)
          ? body.retryableRowNumbers as number[]
          : [],
      };
      setFile(canonicalFile);
      setParsed(canonicalParsed);
      setRecipe(canonicalPlan.recipe);
      setMappingStates(canonicalPlan.states);
      setValidation(nextValidation);
      setAutoConvertResult(nextResult);
      setSkipConfirmed(false);
      setStage("review");
      setAutoConvertMessage(nextResult.partial
        ? "Auto Convert prepared the completed batches. Unresolved rows are preserved for retry or review."
        : "Auto Convert prepared the file. Review only the uncertainty shown below before importing.");
    } catch (requestError) {
      setAutoConvertMessage(requestError instanceof Error
        ? requestError.message
        : "Auto Convert couldn't complete this file. Your source file was not changed. You can retry or continue with Smart Mapping.");
    } finally {
      setAutoConvertProgress(null);
      setAutoConvertBusy(false);
    }
  }

  async function downloadNormalizedCsv() {
    const formData = formDataForCurrentFile();
    if (!formData || !validation?.readyRows || downloadBusy) return;
    setDownloadBusy(true);
    setDownloadMessage(null);
    try {
      const response = await fetch("/api/uploads/normalize", { method: "POST", body: formData });
      if (!response.ok) {
        const body = await responseJson(response);
        throw new Error(typeof body.error === "string" ? body.error : "Normalized CSV download failed.");
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "lostdeal-normalized.csv";
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDownloadMessage(`Downloaded ${validation.readyRows.toLocaleString()} Ready rows. ${skippedRows.toLocaleString()} review or invalid rows were excluded; nothing was imported.`);
    } catch (requestError) {
      setDownloadMessage(requestError instanceof Error ? requestError.message : "Normalized CSV download failed. You can still continue with the import.");
    } finally {
      setDownloadBusy(false);
    }
  }

  async function importDeals() {
    if (!validation?.readyRows || busy || (skippedRows > 0 && !skipConfirmed)) return;
    const formData = formDataForCurrentFile(true);
    if (!formData) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/uploads/import", { method: "POST", body: formData });
      const body = await responseJson(response);
      if (!response.ok || !body.success) {
        throw new Error(typeof body.error === "string" ? body.error : "The import could not be completed.");
      }
      const nextResult = body as unknown as ImportResult;
      setResult(nextResult);
      setImports((current) => [{
        id: nextResult.uploadId,
        filename: nextResult.filename,
        createdAt: nextResult.createdAt,
        rowsImported: nextResult.insertedCount,
        status: "completed" as const,
      }, ...current].slice(0, 6));
      setStage("success");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The import could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const mappingPreview = parsed && recipe && parsed.rows[0]
    ? applyMappingRecipe(parsed.rows[0], parsed.headers, recipe)
    : null;
  const previewValue = mappingPreview ? normalizeDealValue(mappingPreview.deal_value) : null;
  const previewDate = mappingPreview ? normalizeQuoteDateWithFormat(mappingPreview.quote_date, dateFormat) : null;
  const ignored = parsed && recipe ? ignoredSourceColumns(parsed.headers, recipe) : [];
  const hasSuggestedMappings = mappingStates
    ? CANONICAL_FIELDS.some((field) => mappingStates[field] === "suggested")
    : false;
  const isMessyFile = parsed
    ? parsed.headers.length !== CANONICAL_FIELDS.length
      || CANONICAL_FIELDS.some((field, index) => parsed.headers[index] !== field)
    : false;

  function focusSmartMapping() {
    smartMappingRef.current?.focus({ preventScroll: true });
    smartMappingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div>
      <ol aria-label="CSV import progress" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {STEP_LABELS.map((step, index) => {
          const complete = currentStep > index;
          const active = currentStep === index;
          return (
            <li key={step.key} aria-current={active ? "step" : undefined} className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-bold ${active ? "border-brand/45 bg-brand/10 text-content" : complete ? "border-emerald-500/35 bg-emerald-500/10 text-success-content" : "border-line bg-panel text-secondary"}`}>
              <span className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs ${active ? "bg-brand text-on-brand" : complete ? "bg-emerald-600 text-white" : "bg-panel-hover text-secondary"}`}>
                {complete ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
              </span>
              {step.label}
            </li>
          );
        })}
      </ol>

      <div aria-live="polite" className="mt-5 min-h-0">
        {error && <div role="alert" className="flex gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm leading-6 text-danger-content"><AlertCircle aria-hidden="true" className="mt-1 size-4 shrink-0" /><span>{error}</span></div>}
      </div>

      {stage === "select" && (
        <section className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <Card>
            <div className="p-5 sm:p-6">
              <div onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); void selectFile(event.dataTransfer.files.item(0)); }} className={`flex min-h-[18rem] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${dragging ? "border-brand bg-brand/15" : "border-brand/30 bg-brand/5"}`}>
                <span className="flex size-14 items-center justify-center rounded-2xl bg-panel text-brand-strong shadow-sm"><UploadCloud aria-hidden="true" className="size-7" /></span>
                <h2 className="mt-4 text-xl font-bold text-content">Upload your existing CSV</h2>
                <p className="mt-2 max-w-lg text-sm leading-6 text-secondary">Smart Mapping matches common CRM and spreadsheet columns, while keeping every mapping reviewable.</p>
                <p className="mt-3 max-w-lg text-xs leading-5 text-secondary">Import only information your organization is authorized to process. Avoid unnecessary sensitive personal data.</p>
                <input ref={inputRef} id="csv-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void selectFile(event.target.files?.item(0) ?? null)} />
                <label htmlFor="csv-file" className={buttonStyles("primary", "mt-5")}>Choose CSV</label>
                <div className="mt-4 flex flex-wrap justify-center gap-2"><Badge tone="neutral">CSV only</Badge><Badge tone="neutral">Maximum {MAX_CSV_FILE_BYTES / 1024 / 1024} MB</Badge><Badge tone="neutral">Maximum {MAX_CSV_ROWS.toLocaleString()} deals</Badge></div>
              </div>
            </div>
          </Card>
          <aside className="space-y-5">
            <Card title="What Smart Import needs" description="No fixed CRM template is required.">
              <ul className="space-y-3 p-5">
                {["One lost opportunity per row", "A valid deal value", "Sales notes or a transcript", "Customer name is optional"].map((item) => <li key={item} className="flex gap-3 text-sm leading-6 text-secondary"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success-content" />{item}</li>)}
              </ul>
            </Card>
            <Card>
              <div className="p-5">
                <div className="flex items-start gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-panel-hover text-secondary"><FileSpreadsheet aria-hidden="true" className="size-5" /></span><div><h2 className="text-sm font-bold text-content">Synthetic examples</h2><p className="mt-1 text-xs leading-5 text-secondary">Try canonical, demo, or messy CRM-style data.</p></div></div>
                <div className="mt-4 divide-y divide-line rounded-xl border border-line bg-panel-raised">
                  {[
                    ["Sample CSV", "10 canonical rows", "/sample-lost-deals.csv", "Sample"],
                    ["Demo HVAC", "20 walkthrough rows", "/lostdeal-demo-hvac.csv", "Demo"],
                    ["Messy CRM Example", "Smart Mapping example", "/examples/smart-import-crm-example.csv", "Messy"],
                  ].map(([title, detail, href, label]) => <div key={href} className="flex items-center justify-between gap-3 p-3"><div><h3 className="text-sm font-bold text-content">{title}</h3><p className="mt-0.5 text-xs text-secondary">{detail}</p></div><a href={href} download aria-label={`Download ${title}`} className={buttonStyles("outline", "min-h-9 shrink-0 px-3")}><Download aria-hidden="true" className="size-4" />{label}</a></div>)}
                </div>
                <p className="mt-4 border-t border-line pt-4 text-[11px] leading-5 text-secondary">Synthetic data only. Uploaded values stay plain text; formulas are never executed.</p>
              </div>
            </Card>
          </aside>
        </section>
      )}

      {stage === "mapping" && file && parsed && recipe && mappingStates && (
        <section className="mt-5 space-y-5">
          {autoConvertAccess.providerExecutionAllowed && (
            <Card className="border-brand/35 bg-brand/5">
              <div className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center sm:p-6">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-brand text-on-brand"><Sparkles aria-hidden="true" className="size-5" /></span>
                    <div><p className="text-xs font-extrabold uppercase tracking-[0.1em] text-brand-strong">{autoConvertAccess.planCode === "INTERNAL" ? "Internal access" : "Pro"}</p><h2 className="mt-1 text-xl font-bold text-content">Auto Convert with AI</h2></div>
                  </div>
                  <p className="mt-4 text-sm font-semibold leading-6 text-content">Automatically map, normalize and prepare the usable information in this file.</p>
                  <p className="mt-2 max-w-3xl text-xs leading-5 text-secondary"><strong className="text-content">Provider notice:</strong> Auto Convert sends selected column names and bounded row content to the configured AI provider. Review uncertain results before importing.</p>
                  <p className="mt-2 text-xs leading-5 text-secondary">It never starts Deal Analysis or Recovery Score calculation, and your selected local file is not changed.</p>
                </div>
                <div className="flex min-w-52 flex-col gap-3">
                  <Button type="button" loading={autoConvertBusy} onClick={() => void autoConvert()}><Sparkles aria-hidden="true" className="size-4" />{autoConvertBusy ? "Auto Converting…" : "Auto Convert"}</Button>
                  <Button type="button" variant="outline" disabled={autoConvertBusy} onClick={focusSmartMapping}>Use Smart Mapping instead</Button>
                </div>
              </div>
              {(autoConvertProgress || autoConvertMessage) && <div aria-live="polite" role="status" className="border-t border-line px-5 py-4 text-sm leading-6 text-secondary sm:px-6">{autoConvertProgress || autoConvertMessage}</div>}
            </Card>
          )}

          {isMessyFile && autoConvertAccess.state === "LOCKED" && (
            <Card className="border-brand/25 bg-brand/5">
              <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
                <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-content">Auto Convert with AI</h2><Badge tone="demo">Pro feature</Badge></div><p className="mt-2 text-sm leading-6 text-secondary">Let LostDeal AI automatically map, clean and prepare this file.</p><p className="mt-2 text-xs text-secondary">Available with Pro. Upgrade available when billing launches.</p></div>
                <Button type="button" variant="secondary" onClick={focusSmartMapping}>Continue with Smart Mapping</Button>
              </div>
            </Card>
          )}

          {isMessyFile && autoConvertAccess.state === "BILLING_PENDING" && (
            <Card className="border-brand/25 bg-brand/5">
              <div className="grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
                <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-content">Auto Convert with AI</h2><Badge tone="pending">Coming with verified billing</Badge></div><p className="mt-2 text-sm leading-6 text-secondary">Your plan is eligible for Auto Convert, but provider-backed commercial use stays inactive until Pro billing launches.</p></div>
                <Button type="button" variant="secondary" onClick={focusSmartMapping}>Continue with Smart Mapping</Button>
              </div>
            </Card>
          )}

          <div ref={smartMappingRef} id="smart-mapping-controls" tabIndex={-1} className="scroll-mt-6 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">
          <Card title="Smart Mapping" description="LostDeal AI matches common columns deterministically. Review and edit every mapping before import." action={<Badge tone="completed">{parsed.rows.length.toLocaleString()} rows detected</Badge>}>
            <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="min-w-0"><p className="truncate text-sm font-bold text-content">{file.name}</p><p className="mt-1 text-xs text-secondary">{formatBytes(file.size)} · {parsed.headers.length} columns · {parsed.blankRows} blank rows ignored</p></div><Button type="button" variant="ghost" onClick={resetImport}><X aria-hidden="true" className="size-4" />Choose another file</Button></div>
            <div className="divide-y divide-line">
              {CANONICAL_FIELDS.map((field) => {
                const entry = recipe[field];
                const canMerge = MERGE_FIELDS.has(field) && Boolean(entry) && (entry?.sources.length ?? 0) < MAX_MAPPING_MERGE_COLUMNS;
                return (
                  <article key={field} className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(12rem,0.8fr)_minmax(18rem,1.4fr)_auto] md:items-start sm:px-6">
                    <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold text-content">{FIELD_DETAILS[field].label}</h3>{FIELD_DETAILS[field].required ? <Badge tone="pending">Required</Badge> : <Badge tone="neutral">Optional</Badge>}</div><p className="mt-1 text-xs leading-5 text-secondary">{FIELD_DETAILS[field].description}</p>{(field === "sales_notes" || field === "transcript") && <p className="mt-1 text-[11px] font-semibold text-brand-strong">Sales Notes OR Transcript is required for analysis.</p>}</div>
                    <div className="space-y-3">
                      {(entry?.sources ?? [null]).map((source, slot) => (
                        <div key={`${field}-${slot}`} className="flex items-end gap-2">
                          <div className="min-w-0 flex-1"><Select id={`mapping-${field}-${slot}`} label={slot ? `Merged source ${slot + 1}` : "Source column"} value={source ?? ""} onChange={(event) => setMappedSource(field, slot, event.target.value)}><option value="">Not mapped</option>{parsed.headers.map((header, index) => <option key={`${header}-${index}`} value={index}>{header || `Column ${index + 1}`}</option>)}</Select></div>
                          {entry && entry.sources.length > 1 && <Button type="button" variant="ghost" aria-label={`Remove source ${slot + 1} from ${FIELD_DETAILS[field].label}`} onClick={() => setMappedSource(field, slot, "")}><Trash2 aria-hidden="true" className="size-4" /></Button>}
                        </div>
                      ))}
                      {canMerge && <div><label htmlFor={`add-source-${field}`} className="sr-only">Add another source column to {FIELD_DETAILS[field].label}</label><select id={`add-source-${field}`} value="" onChange={(event) => addMappedSource(field, event.target.value)} className="h-10 w-full rounded-lg border border-dashed border-line-strong bg-panel px-3 text-sm font-semibold text-secondary outline-none hover:border-brand/45 focus:border-brand focus:ring-2 focus:ring-brand/20"><option value="">+ Add another source column</option>{parsed.headers.map((header, index) => <option key={`${header}-add-${index}`} value={index}>{header || `Column ${index + 1}`}</option>)}</select></div>}
                      {entry && entry.sources.length > 1 && <p className="text-[11px] leading-5 text-secondary">{field === "customer_name" ? "Names join with one space; blank parts stay blank." : "Text joins on new lines with source-column labels preserved."}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 md:justify-end"><Badge tone={mappingStateTone(mappingStates[field])}>{mappingStateLabel(mappingStates[field])}</Badge>{mappingStates[field] === "suggested" && <Button type="button" variant="outline" className="min-h-9 px-3" onClick={() => confirmSuggestion(field)}><Check aria-hidden="true" className="size-4" />Confirm</Button>}</div>
                  </article>
                );
              })}
            </div>
            {mappingError && <div role="alert" className="mx-5 mb-5 flex gap-3 rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm leading-6 text-danger-content sm:mx-6"><AlertCircle aria-hidden="true" className="mt-1 size-4 shrink-0" />{mappingError}</div>}
            <div className="flex flex-col-reverse gap-3 border-t border-line px-5 py-5 sm:flex-row sm:justify-between sm:px-6"><Button type="button" variant="outline" onClick={resetImport}><ArrowLeft aria-hidden="true" className="size-4" />Back</Button><div className="flex flex-col gap-3 sm:flex-row">{hasSuggestedMappings && <Button type="button" variant="secondary" onClick={confirmAllSuggestions}><Check aria-hidden="true" className="size-4" />Confirm all suggestions</Button>}<Button type="button" loading={busy} onClick={() => void reviewFile()}>{busy ? "Validating on server…" : "Review normalized data"}<ArrowRight aria-hidden="true" className="size-4" /></Button></div></div>
          </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Ignored columns" description="Extra source columns are not stored unless you map them.">
              <div className="p-5 sm:p-6">{ignored.length ? <div className="flex flex-wrap gap-2">{ignored.map((index) => <Badge key={index} tone="neutral">{parsed.headers[index]}</Badge>)}</div> : <p className="text-sm text-secondary">Every source column is currently used.</p>}</div>
            </Card>
            <Card title="Mapping preview" description="Browser preview only. The server reparses and validates the original file.">
              <dl className="grid gap-3 p-5 text-sm sm:grid-cols-2 sm:p-6"><div><dt className="text-xs font-bold text-secondary">Customer</dt><dd className="mt-1 break-words text-content">{mappingPreview?.customer_name || "Customer not provided"}</dd></div><div><dt className="text-xs font-bold text-secondary">Deal value</dt><dd className="mt-1 text-content">{previewValue?.value ? formatDealCurrency(previewValue.value) : previewValue?.error || "Not mapped"}</dd></div><div><dt className="text-xs font-bold text-secondary">Quote date</dt><dd className="mt-1 text-content">{previewDate?.value || previewDate?.error || "Not provided"}</dd></div><div><dt className="text-xs font-bold text-secondary">Context</dt><dd className="mt-1 line-clamp-3 whitespace-pre-line text-content">{mappingPreview?.sales_notes || mappingPreview?.transcript || "No notes or transcript mapped"}</dd></div></dl>
            </Card>
          </div>

          <Card title="Optional AI mapping help" description="Deterministic and manual mapping work without AI.">
            <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-start sm:p-6"><div><p className="text-sm leading-6 text-secondary"><strong className="text-content">Provider notice:</strong> AI mapping may send column names and a small number of representative values to the configured AI provider. It never sends the full CSV, and every suggestion requires your review.</p><p className="mt-2 text-xs leading-5 text-secondary">At most 60 unmapped columns, three samples per column, and 120 characters per sample are included. No rows are imported by this action.</p></div><Button type="button" variant="secondary" loading={aiBusy} disabled={!ignored.length} onClick={() => void requestAiSuggestions()}><Sparkles aria-hidden="true" className="size-4" />Suggest Mapping with AI</Button></div>
            {(aiMessage || aiSuggestions.length > 0) && <div aria-live="polite" className="border-t border-line p-5 sm:p-6">{aiMessage && <p className="text-sm text-secondary">{aiMessage}</p>}{aiSuggestions.length > 0 && <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">{aiSuggestions.map((suggestion) => <div key={suggestion.source_column} className="flex flex-col gap-3 rounded-xl border border-line bg-panel-raised p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-sm font-bold text-content">{suggestion.source_column} <span className="text-secondary">→</span> {suggestion.target === "IGNORE" ? "Ignore" : FIELD_DETAILS[suggestion.target].label}</p><p className="mt-1 text-xs leading-5 text-secondary">{suggestion.reason}</p><Badge tone={suggestion.confidence === "HIGH" ? "completed" : suggestion.confidence === "MEDIUM" ? "pending" : "neutral"} className="mt-2">AI suggestion · {suggestion.confidence}</Badge></div><Button type="button" variant="outline" className="shrink-0" onClick={() => applyAiSuggestion(suggestion)}>{suggestion.target === "IGNORE" ? "Keep ignored" : "Apply suggestion"}</Button></div>)}</div>}</div>}
          </Card>
        </section>
      )}

      {stage === "review" && validation && (
        <section className="mt-5 space-y-5">
          {autoConvertResult && (
            <Card className="border-brand/30" title={autoConvertResult.partial ? "Auto Convert partially complete" : "Auto Convert Complete"} description={`${autoConvertResult.summary.totalRows.toLocaleString()} rows detected. Only meaningful uncertainty needs attention.`} action={<Badge tone={autoConvertResult.partial ? "pending" : "completed"}>{autoConvertResult.partial ? "Partial" : "Prepared"}</Badge>}>
              <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 sm:p-6">
                {[
                  ["Ready", autoConvertResult.summary.ready, "text-success-content"],
                  ["Review recommended", autoConvertResult.summary.reviewRecommended, "text-warning-content"],
                  ["Needs review", autoConvertResult.summary.needsReview, "text-warning-content"],
                  ["Invalid", autoConvertResult.summary.invalid, "text-danger-content"],
                  ["Extracted fields", autoConvertResult.summary.extractedFields, "text-content"],
                  ["Normalized values", autoConvertResult.summary.normalizedValues, "text-content"],
                  ["Unresolved batches", autoConvertResult.retryableRowNumbers.length, "text-content"],
                ].map(([label, value, color]) => <div key={String(label)} className="rounded-xl border border-line bg-panel-raised p-3"><p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-secondary">{label}</p><p className={`mt-2 text-xl font-semibold ${color}`}>{Number(value).toLocaleString()}</p></div>)}
              </div>
              <div className="border-t border-line px-5 py-4 sm:px-6">
                <p aria-live="polite" className="text-sm leading-6 text-secondary">{autoConvertMessage}</p>
                {autoConvertResult.retryableRowNumbers.length > 0 && <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs leading-5 text-secondary">Completed results remain in this browser session. Retry only the unresolved rows, or continue with the Ready rows.</p><Button type="button" variant="secondary" loading={autoConvertBusy} onClick={() => void autoConvert(autoConvertResult.retryableRowNumbers)}><RefreshCw aria-hidden="true" className="size-4" />Retry {autoConvertResult.retryableRowNumbers.length.toLocaleString()} unresolved</Button></div>}
              </div>
              {(autoConvertResult.mappings.length > 0 || autoConvertResult.provenance.length > 0 || autoConvertResult.issues.length > 0) && <details className="border-t border-line"><summary className="min-h-12 cursor-pointer list-none px-5 py-4 text-sm font-bold text-content hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 sm:px-6 [&::-webkit-details-marker]:hidden">View conversion details</summary><div className="max-h-[32rem] space-y-5 overflow-y-auto border-t border-line p-5 sm:p-6">
                {autoConvertResult.issues.length > 0 && <section><h3 className="text-sm font-bold text-content">Uncertainty to verify</h3><div className="mt-3 space-y-2">{autoConvertResult.issues.map((item, index) => <div key={`${item.rowNumber ?? "mapping"}-${item.target ?? "general"}-${index}`} className="rounded-xl border border-line bg-panel-raised p-3"><div className="flex flex-wrap items-center gap-2"><Badge tone={item.level === "NEEDS_REVIEW" ? "pending" : "neutral"}>{item.level === "NEEDS_REVIEW" ? "Needs review" : "Review recommended"}</Badge>{item.rowNumber !== null && <span className="text-xs font-bold text-secondary">Source row {item.rowNumber}</span>}</div><p className="mt-2 text-xs leading-5 text-secondary">{item.message}</p></div>)}</div></section>}
                {autoConvertResult.provenance.length > 0 && <section><h3 className="text-sm font-bold text-content">Supported extractions</h3><div className="mt-3 space-y-2">{autoConvertResult.provenance.map((item, index) => <div key={`${item.rowNumber}-${item.target}-${index}`} className="rounded-xl border border-line bg-panel-raised p-3"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold text-content">{FIELD_DETAILS[item.target].label}: {item.value}</p><Badge tone={item.confidence === "HIGH" ? "completed" : "pending"}>{item.confidence}</Badge></div><p className="mt-1 text-xs font-semibold text-secondary">Source row {item.rowNumber} · {item.sourceColumn}</p><p className="mt-2 break-words rounded-lg border border-line bg-panel px-3 py-2 text-xs leading-5 text-secondary">“{item.evidence}”</p></div>)}</div></section>}
                {autoConvertResult.mappings.length > 0 && <section><h3 className="text-sm font-bold text-content">Column decisions</h3><div className="mt-3 divide-y divide-line rounded-xl border border-line bg-panel-raised">{autoConvertResult.mappings.map((item, index) => <div key={`${item.sourceColumn}-${index}`} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto]"><div><p className="text-sm font-bold text-content">{item.sourceColumn} → {item.target === "IGNORE" ? "Ignored" : FIELD_DETAILS[item.target].label}</p><p className="mt-1 text-xs leading-5 text-secondary">{item.reason}</p></div><Badge tone={item.applied ? item.reviewRecommended ? "pending" : "completed" : "neutral"}>{item.applied ? item.reviewRecommended ? "Applied · review" : "Applied" : "Not applied"}</Badge></div>)}</div></section>}
                {autoConvertResult.detailsTruncated && <p className="text-xs leading-5 text-secondary">Conversion details are bounded for performance. The summary counts cover the complete result.</p>}
              </div></details>}
            </Card>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
            ["Rows detected", validation.totalRows, "text-content"],
            ["Ready", validation.readyRows, "text-success-content"],
            ["Needs Review", validation.needsReviewRows, "text-warning-content"],
            ["Invalid", validation.invalidRows, "text-danger-content"],
          ].map(([label, value, color]) => <Card key={String(label)}><div className="p-4"><p className="text-xs font-bold uppercase tracking-[0.12em] text-secondary">{label}</p><p className={`mt-2 text-2xl font-semibold tracking-tight ${color}`}>{Number(value).toLocaleString()}</p></div></Card>)}</div>

          <Card title="Data quality summary" description="Actionable checks—not a made-up quality score.">
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4 sm:p-6">{[
              ["Mapped fields", `${validation.mappedFields} of ${CANONICAL_FIELDS.length}`],
              ["Missing optional", String(validation.missingOptionalFields.length)],
              ["Ambiguous dates", String(validation.ambiguousDates.length)],
              ["Unknown statuses", String(validation.unknownStatuses.length)],
              ["Ignored columns", String(validation.ignoredColumns.length)],
              ["Mapping issues", String(validation.issueGroups.mapping)],
              ["Duplicate issues", String(validation.issueGroups.duplicate)],
              ["Row/value issues", String(validation.issueGroups.row + validation.issueGroups.value)],
            ].map(([label, value]) => <div key={label} className="rounded-xl border border-line bg-panel-raised p-3"><p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">{label}</p><p className="mt-2 text-lg font-bold text-content">{value}</p></div>)}</div>
          </Card>

          {(validation.ambiguousDates.length > 0 || validation.unknownStatuses.length > 0) && <Card title="Resolve review items" description="Apply fixes to the selected file without uploading it again.">
            <div className="grid gap-5 p-5 lg:grid-cols-2 sm:p-6">
              {validation.ambiguousDates.length > 0 && <Select id="source-date-format" label="Source date format" description={`Examples needing review: ${validation.ambiguousDates.slice(0, 3).join(", ")}`} value={dateFormat} onChange={(event) => setDateFormat(event.target.value as SourceDateFormat)}><option value="AUTO">Choose a format</option><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></Select>}
              {validation.unknownStatuses.map((status, statusIndex) => <Select key={status} id={`unknown-status-${statusIndex}`} label={`Status: ${status}`} description="Confirm whether this source status means Lost or should be excluded." value={statusResolutions[status] ?? ""} onChange={(event) => setStatusResolutions({ ...statusResolutions, [status]: event.target.value as StatusResolution })}><option value="">Needs review</option><option value="lost">Lost</option><option value="exclude">Exclude</option></Select>)}
            </div><div className="flex justify-end border-t border-line p-5 sm:px-6"><Button type="button" loading={busy} onClick={() => void reviewFile(true)}><RefreshCw aria-hidden="true" className="size-4" />Revalidate selected file</Button></div>
          </Card>}

          {(validation.needsReview.length > 0 || validation.invalid.length > 0) && <Card title="Rows requiring attention" description="Needs Review rows may be resolved above. Invalid rows cannot import in their current form.">
            <div className="max-h-80 divide-y divide-line overflow-y-auto">{[
              ...validation.needsReview.map((row) => ({ ...row, state: "Needs Review" as const })),
              ...validation.invalid.map((row) => ({ ...row, state: "Invalid" as const })),
            ].map((row) => <div key={`${row.state}-${row.rowNumber}`} className="grid gap-2 px-5 py-4 sm:grid-cols-[7rem_1fr_2fr] sm:px-6"><div><p className="text-sm font-bold text-content">Row {row.rowNumber}</p><Badge tone={row.state === "Invalid" ? "failed" : "pending"} className="mt-1">{row.state}</Badge></div><p className="text-sm text-secondary">{row.customer || row.externalDealId || "Customer not provided"}</p><ul className={`space-y-1 text-sm ${row.state === "Invalid" ? "text-danger-content" : "text-warning-content"}`}>{row.errors.map((rowError) => <li key={rowError}>{rowError}</li>)}</ul></div>)}</div>{validation.issueRowsTruncated && <p className="border-t border-line px-5 py-3 text-xs text-secondary sm:px-6">The issue list is bounded for performance. Counts above include the complete file.</p>}
          </Card>}

          <Card title="Transformation preview" description={`First ${validation.preview.length} Ready ${validation.preview.length === 1 ? "row" : "rows"}. Original values remain unchanged in your uploaded file.`}>
            {validation.preview.length ? <Table label="Source to normalized deal preview" headers={["Customer", "Deal value: source → normalized", "Quote date: source → normalized", "Service", "Notes / transcript"]}>{validation.preview.map((row) => <tr key={row.rowNumber} className="text-sm text-secondary"><td className="px-5 py-4 font-bold text-content">{row.customer_name || "Customer not provided"}</td><td className="px-5 py-4"><span className="break-all">{row.original_deal_value || "—"}</span><span aria-hidden="true" className="mx-2">→</span><strong className="text-content">{formatDealCurrency(row.deal_value)}</strong></td><td className="px-5 py-4"><span>{row.original_quote_date || "—"}</span><span aria-hidden="true" className="mx-2">→</span><strong className="text-content">{row.quote_date || "—"}</strong></td><td className="px-5 py-4">{row.service_type || "—"}</td><td className="max-w-xs whitespace-pre-line px-5 py-4 text-xs leading-5">{row.context}</td></tr>)}</Table> : <div className="p-6 text-sm text-secondary">No Ready rows are available to preview.</div>}
          </Card>

          <Card title="Ready for your decision" description="Download a canonical CSV or continue to the explicit import confirmation.">
            <div className="flex flex-col gap-4 p-5 sm:p-6"><p className="text-sm leading-6 text-secondary">Exports <strong className="text-content">{validation.readyRows.toLocaleString()} Ready rows</strong>. {skippedRows.toLocaleString()} review or invalid rows are not included. Downloading never imports data.</p><div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><Button type="button" variant="outline" onClick={() => { if (autoConvertResult && sourceFile) void selectFile(sourceFile); else { setStage("mapping"); setError(null); } }}><ArrowLeft aria-hidden="true" className="size-4" />{autoConvertResult ? "Use Smart Mapping instead" : "Back to Mapping"}</Button><div className="flex flex-col gap-3 sm:flex-row"><Button type="button" variant="secondary" loading={downloadBusy} disabled={!validation.readyRows} onClick={() => void downloadNormalizedCsv()}><Download aria-hidden="true" className="size-4" />Download LostDeal-formatted CSV</Button><Button type="button" disabled={!validation.readyRows} onClick={() => { setStage("import"); setSkipConfirmed(false); setError(null); }}>Continue to Import <ArrowRight aria-hidden="true" className="size-4" /></Button></div></div>{downloadMessage && <p aria-live="polite" className="rounded-xl border border-line bg-panel-raised p-3 text-xs leading-5 text-secondary">{downloadMessage}</p>}</div>
          </Card>
        </section>
      )}

      {stage === "import" && file && validation && (
        <section className="mt-5"><Card title="Confirm Import" description={`Review the final write into ${organizationName}.`} action={<Badge tone="pending">No AI analysis starts</Badge>}>
          <div className="p-5 sm:p-6"><dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl border border-line bg-panel-raised p-4 sm:col-span-2"><dt className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">Filename</dt><dd className="mt-2 break-all text-sm font-bold text-content">{file.name}</dd></div><div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4"><dt className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-success-content">Rows importing</dt><dd className="mt-2 text-2xl font-semibold text-content">{validation.readyRows.toLocaleString()}</dd></div><div className="rounded-xl border border-line bg-panel-raised p-4"><dt className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-secondary">Rows skipped</dt><dd className="mt-2 text-2xl font-semibold text-content">{skippedRows.toLocaleString()}</dd></div></dl>
            <div className="mt-5 rounded-xl border border-brand/25 bg-brand/5 p-4"><p className="text-sm font-bold text-content">{validation.mappedFields} of {CANONICAL_FIELDS.length} canonical fields mapped</p><p className="mt-1 text-xs leading-5 text-secondary">The server reparses and revalidates the original file. Existing external IDs remain protected, and analysis/scoring remain separate explicit actions.</p></div>
            {skippedRows > 0 && <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-sm leading-6 text-content"><input type="checkbox" checked={skipConfirmed} onChange={(event) => setSkipConfirmed(event.target.checked)} className="mt-1 size-4 accent-[var(--color-brand)]" /><span><strong>I understand {skippedRows.toLocaleString()} {skippedRows === 1 ? "row is" : "rows are"} excluded.</strong><span className="mt-1 block text-xs text-secondary">Only Ready rows will be imported.</span></span></label>}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between"><Button type="button" variant="outline" disabled={busy} onClick={() => { setStage("review"); setError(null); }}><ArrowLeft aria-hidden="true" className="size-4" />Back to Review</Button><Button type="button" loading={busy} disabled={!validation.readyRows || (skippedRows > 0 && !skipConfirmed)} onClick={() => void importDeals()}><UploadCloud aria-hidden="true" className="size-4" />{busy ? "Importing…" : `Import ${validation.readyRows.toLocaleString()} ${validation.readyRows === 1 ? "Deal" : "Deals"}`}</Button></div>
          </div>
        </Card></section>
      )}

      {stage === "success" && result && <section className="mt-5"><Card><div className="flex min-h-[20rem] flex-col items-center justify-center p-6 text-center sm:p-8"><span className="flex size-20 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><FileCheck2 aria-hidden="true" className="size-9" /></span><Badge tone="completed" className="mt-6">Import completed</Badge><h2 className="mt-4 text-2xl font-bold tracking-tight text-content">Deals imported successfully</h2><p className="mt-3 max-w-xl text-sm leading-6 text-secondary">{result.insertedCount.toLocaleString()} lost {result.insertedCount === 1 ? "deal is" : "deals are"} ready for analysis in {result.organizationName}. No AI analysis or Recovery Score calculation started.</p>{result.invalidRows > 0 && <p className="mt-2 text-sm text-secondary">{result.invalidRows.toLocaleString()} review or invalid {result.invalidRows === 1 ? "row was" : "rows were"} skipped as confirmed.</p>}<div className="mt-7 flex flex-col gap-3 sm:flex-row"><Link href="/deals" className={buttonStyles("secondary")}>View Deals <ArrowRight aria-hidden="true" className="size-4" /></Link><Button type="button" variant="outline" onClick={resetImport}><RefreshCw aria-hidden="true" className="size-4" />Import Another File</Button></div></div></Card></section>}

      <section className="mt-6"><details className="rounded-2xl border border-line bg-panel shadow-sm"><summary className="flex min-h-14 list-none items-center justify-between gap-3 rounded-2xl px-5 text-sm font-bold text-content transition-colors hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 [&::-webkit-details-marker]:hidden"><span>Recent imports</span><span className="text-xs font-semibold text-secondary">Latest activity for {organizationName}</span></summary><div className="border-t border-line">{imports.length ? <div className="divide-y divide-line">{imports.slice(0, 4).map((item) => <div key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="min-w-0"><p className="truncate text-sm font-bold text-content">{item.filename}</p><p className="mt-1 text-xs text-secondary">{formatDate(item.createdAt)} · {item.rowsImported.toLocaleString()} rows imported</p></div><Badge tone={statusTone(item.status)}>{item.status}</Badge></div>)}</div> : recentImportsUnavailable ? <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center"><AlertCircle aria-hidden="true" className="size-7 text-amber-500" /><p className="mt-3 text-sm font-bold text-content">Recent imports are temporarily unavailable</p><p className="mt-1 text-xs leading-5 text-secondary">Your import workflow still works. Refresh to try loading history again.</p></div> : <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center"><FileSpreadsheet aria-hidden="true" className="size-7 text-secondary" /><p className="mt-3 text-sm font-bold text-content">No imports yet</p><p className="mt-1 text-xs leading-5 text-secondary">Completed and failed CSV imports will appear here.</p></div>}</div></details></section>
    </div>
  );
}
