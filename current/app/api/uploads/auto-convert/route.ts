import { NextResponse } from "next/server";

import { getBillingEnforcementMode } from "@/lib/billing/config";
import { resolveAutoConvertAccess } from "@/lib/billing/auto-convert-access";
import {
  getOrganizationUsageSnapshot,
  reserveOrganizationUsage,
  releaseUnusedUsage,
  type UsageReservation,
} from "@/lib/billing/usage";
import { fingerprint, readOperation, saveOperation } from "@/lib/csv/operation-service";
import {
  AutoConvertProviderError,
  buildAutoConvertPlan,
  executeAutoConvertPlan,
} from "@/lib/csv/auto-convert";
import { runOpenAiAutoConvertExtraction, getAutoConvertModel } from "@/lib/csv/auto-convert-runner";
import { createOpenAiMappingRunner } from "@/lib/csv/ai-mapping-runner";
import { CANONICAL_FIELDS, MAX_CSV_ROWS } from "@/lib/csv/constants";
import { createCanonicalCsv, normalizedCsvFilename } from "@/lib/csv/export";
import { createMappingPlan, parseMappingRecipe } from "@/lib/csv/mapping";
import { parseCsvText, validateSmartCsvRows } from "@/lib/csv/validation";
import {
  CsvImportError,
  parseCsvUploadFile,
  toCsvValidationResponse,
  validateCsvFormData,
} from "@/lib/csv/server";
import { mutationIssueResponse, validateMutationRequest } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";

const OPERATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_FORM_KEYS = new Set(["file", "operation_id", "row_numbers", "mapping_recipe"]);
const MAX_DETAILS_RETURNED = 200;

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function assertFormShape(formData: FormData): void {
  for (const key of formData.keys()) {
    if (!ALLOWED_FORM_KEYS.has(key)) throw new CsvImportError("The Auto Convert request contains unsupported fields.");
  }
  for (const key of ALLOWED_FORM_KEYS) {
    if (formData.getAll(key).length > 1) throw new CsvImportError("The Auto Convert request contains duplicate fields.");
  }
}

function parseRowNumbers(
  value: FormDataEntryValue | null,
  availableRows: ReadonlySet<number>,
): number[] | undefined {
  if (value === null) return undefined;
  if (typeof value !== "string") throw new CsvImportError("Retry row references are invalid.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CsvImportError("Retry row references are invalid.");
  }
  if (
    !Array.isArray(parsed)
    || parsed.length < 1
    || parsed.length > MAX_CSV_ROWS
    || !parsed.every((row) => Number.isSafeInteger(row) && availableRows.has(row))
    || new Set(parsed).size !== parsed.length
  ) throw new CsvImportError("Retry row references are invalid.");
  return parsed as number[];
}

function parseRecipe(value: FormDataEntryValue | null, headerCount: number) {
  if (value === null) return undefined;
  if (typeof value !== "string") throw new CsvImportError("The Auto Convert mapping recipe is invalid.");
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new CsvImportError("The Auto Convert mapping recipe is invalid.");
  }
  const recipe = parseMappingRecipe(raw, headerCount);
  if (!recipe) throw new CsvImportError("The Auto Convert mapping recipe is invalid.");
  return recipe;
}

export async function POST(request: Request) {
  const authorization = await getAuthorizedRouteContext();
  if (authorization.response) return authorization.response;
  const { supabase, identity, organization } = authorization.context;

  const snapshot = await getOrganizationUsageSnapshot(supabase, organization.id);
  if (!snapshot.available || !snapshot.plan) {
    return noStoreJson({ error: "Auto Convert access could not be verified. Try again later." }, 503);
  }
  const access = resolveAutoConvertAccess(
    snapshot.plan.planCode,
    snapshot.subscriptionStatus,
    snapshot.mode,
  );
  if (!access.providerExecutionAllowed) {
    const error = access.state === "LOCKED"
      ? "Auto Convert with AI is a Pro feature. Continue with Smart Mapping."
      : "Auto Convert will be available when verified Pro billing launches. Continue with Smart Mapping.";
    return noStoreJson({ error, code: access.state }, 403);
  }

  const requestIssue = validateMutationRequest(request, "multipart");
  if (requestIssue) return mutationIssueResponse(requestIssue);
  const limited = await enforceRateLimitOrRespond(identity.id, "upload_auto_convert");
  if (limited) return limited;

  let reservation: UsageReservation | null = null;
  try {
    const formData = await request.formData();
    assertFormShape(formData);
    const operationValue = formData.get("operation_id");
    if (typeof operationValue !== "string" || !OPERATION_ID_PATTERN.test(operationValue)) {
      throw new CsvImportError("A valid Auto Convert operation is required.");
    }
    const fileValue = formData.get("file");
    if (!(fileValue instanceof File)) throw new CsvImportError("Choose a CSV file to continue.");
    const { filename, parsed } = await parseCsvUploadFile(fileValue);
    const rowNumbers = parseRowNumbers(
      formData.get("row_numbers"),
      new Set(parsed.rows.map((row) => row.rowNumber)),
    );
    const recipe = parseRecipe(formData.get("mapping_recipe"), parsed.headers.length);
    const operationKey = "auto-convert:" + operationValue;
    const hash = await fingerprint(fileValue, { rowNumbers, recipe });
    const saved = await readOperation(supabase, organization.id, operationKey, hash);
    if (saved) return noStoreJson(saved);
    // Database reservation tokens fence paid execution; the durable result handles
    // response-loss replay. A fixed D1 operation lock would outlive known failures.
    const plan = buildAutoConvertPlan(parsed, { rowNumbers, recipe });

    reservation = plan.reservationUnits > 0
      ? await reserveOrganizationUsage(
          supabase,
          organization.id,
          "AUTO_CONVERT_ROWS",
          plan.reservationUnits,
          `auto-convert:${operationValue}`,
        )
      : null;
    if (reservation && !reservation.allowed) {
      await releaseUnusedUsage(supabase, organization.id, reservation);
      return noStoreJson({ error: "This workspace does not have enough remaining AI Auto Convert rows." }, 403);
    }
    if (reservation && !reservation.isNew) {
      return noStoreJson({ error: "This Auto Convert operation is already being processed." }, 409);
    }
    const internalShadowMigrationFallback = snapshot.plan.planCode === "INTERNAL"
      && getBillingEnforcementMode() === "SHADOW";
    if (reservation && !reservation.available && !internalShadowMigrationFallback) {
      return noStoreJson({ error: "AI Auto Convert usage metering is not ready. Continue with Smart Mapping." }, 503);
    }
    if (reservation && (!reservation.available || !reservation.reservationToken)) {
      return noStoreJson({ error: "AI Auto Convert usage metering is not ready. Continue with Smart Mapping." }, 503);
    }

    const execution = await executeAutoConvertPlan(
      plan,
      createOpenAiMappingRunner(getAutoConvertModel()),
      runOpenAiAutoConvertExtraction,
    );

    const responseRows = rowNumbers
      ? execution.rows.filter((row) => plan.selectedRowNumbers.has(row.rowNumber))
      : execution.rows;
    const canonicalCsv = createCanonicalCsv(execution.rows.map((row) => row.values));
    const canonicalFile = new File(
      [canonicalCsv],
      normalizedCsvFilename(filename),
      { type: "text/csv" },
    );
    const canonicalRecipe = createMappingPlan([...CANONICAL_FIELDS]).recipe;
    const validationForm = new FormData();
    validationForm.append("file", canonicalFile);
    validationForm.append("mapping_recipe", JSON.stringify(canonicalRecipe));
    validationForm.append("date_format", "AUTO");
    validationForm.append("status_resolutions", "{}");
    let validation;
    let validationWarning: string | null = null;
    try {
      validation = toCsvValidationResponse(await validateCsvFormData(validationForm, supabase, organization.id));
    } catch (error) {
      if (!(error instanceof CsvImportError) || error.status !== 503) throw error;
      // Preserve paid conversion output when the optional duplicate lookup fails.
      // Import always repeats authoritative validation and has a unique-ID constraint.
      const canonicalParsed = parseCsvText(canonicalCsv);
      validation = toCsvValidationResponse({ filename: canonicalFile.name, parsed: canonicalParsed,
        recipe: canonicalRecipe, dateFormat: "AUTO", statusResolutions: {}, skipConfirmed: false,
        validation: validateSmartCsvRows(canonicalParsed, canonicalRecipe) });
      validationWarning = "Existing deal IDs could not be checked. Import will verify them again.";
    }
    const recommendedRows = new Set(execution.issues
      .filter((issue) => issue.level === "REVIEW_RECOMMENDED" && issue.rowNumber !== null)
      .map((issue) => issue.rowNumber as number));
    const reviewRecommended = Math.min(recommendedRows.size, validation.readyRows);

    const result = {
      success: true,
      partial: execution.partial,
      sourceFilename: filename,
      canonicalFilename: canonicalFile.name,
      rows: responseRows,
      recipe: execution.recipe,
      validation,
      validationWarning,
      summary: {
        totalRows: validation.totalRows,
        ready: Math.max(0, validation.readyRows - reviewRecommended),
        reviewRecommended,
        needsReview: validation.needsReviewRows,
        invalid: validation.invalidRows,
        extractedFields: execution.extractedFieldCount,
        normalizedValues: execution.normalizedValueCount,
      },
      provenance: execution.provenance.slice(0, MAX_DETAILS_RETURNED),
      issues: execution.issues.slice(0, MAX_DETAILS_RETURNED),
      mappings: execution.mappingDecisions.slice(0, MAX_DETAILS_RETURNED),
      detailsTruncated:
        execution.provenance.length > MAX_DETAILS_RETURNED
        || execution.issues.length > MAX_DETAILS_RETURNED
        || execution.mappingDecisions.length > MAX_DETAILS_RETURNED,
      retryableRowNumbers: execution.retryableRowNumbers,
      providerRowsCompleted: execution.providerRowsCompleted,
      usageUnits: execution.usageUnits,
    };
    const persisted = await saveOperation(supabase, organization.id, operationKey, hash, "AUTO_CONVERT_ROWS", reservation, execution.usageUnits, result);
    return noStoreJson(persisted);
  } catch (error) {
    if (reservation?.isNew) await releaseUnusedUsage(supabase, organization.id, reservation);
    if (error instanceof CsvImportError) {
      return noStoreJson({ error: error.message }, error.status);
    }
    if (error instanceof AutoConvertProviderError) {
      return noStoreJson({
        error: "Auto Convert couldn't complete this file. Your source file was not changed. You can retry or continue with Smart Mapping.",
      }, 503);
    }
    return noStoreJson({
      error: "Auto Convert couldn't complete this file. Your source file was not changed. You can retry or continue with Smart Mapping.",
    }, 500);
  }
}
