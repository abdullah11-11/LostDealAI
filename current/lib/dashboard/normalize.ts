import { LOST_REASONS, RECOVERY_PRIORITIES, UPLOAD_STATUSES } from "@/types/database";
import type { LostReason, RecoveryPriority, UploadStatus } from "@/types/database";
import type {
  DashboardAnalysisRecord,
  DashboardDealRecord,
  DashboardUploadRecord,
} from "@/lib/dashboard/types";

const LOST_REASON_SET = new Set<string>(LOST_REASONS);
const PRIORITY_SET = new Set<string>(RECOVERY_PRIORITIES);
const UPLOAD_STATUS_SET = new Set<string>(UPLOAD_STATUSES);

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function scoringCalculatedAt(metadataValue: unknown): string | null {
  const metadata = objectRecord(metadataValue);
  const scoring = objectRecord(metadata?.scoring);
  return nullableString(scoring?.calculated_at);
}

function normalizeAnalysisRow(value: unknown): DashboardAnalysisRecord | null {
  const row = objectRecord(value);
  if (!row || typeof row.id !== "string") return null;

  const rawReason = nullableString(row.lost_reason);
  const rawPriority = nullableString(row.recovery_priority);
  const rawScore = row.recovery_score;

  return {
    id: row.id,
    lostReason: rawReason && LOST_REASON_SET.has(rawReason) ? rawReason as LostReason : null,
    recoveryScore: typeof rawScore === "number" && Number.isInteger(rawScore) && rawScore >= 0 && rawScore <= 100
      ? rawScore
      : null,
    recoveryPriority: rawPriority && PRIORITY_SET.has(rawPriority) ? rawPriority as RecoveryPriority : null,
    recommendedAction: nullableString(row.recommended_action),
    scoringCalculatedAt: nullableString(row.scoring_calculated_at) ?? scoringCalculatedAt(row.model_metadata),
  };
}

function normalizeRelatedAnalysis(value: unknown): DashboardAnalysisRecord | null {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    const analysis = normalizeAnalysisRow(candidate);
    if (analysis) return analysis;
  }
  return null;
}

export function normalizeDashboardDeal(value: unknown): DashboardDealRecord | null {
  const row = objectRecord(value);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.analysis_status !== "string" ||
    typeof row.created_at !== "string"
  ) return null;

  const dealValue = Number(row.deal_value);
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerName: nullableString(row.customer_name),
    dealValue: Number.isFinite(dealValue) ? dealValue : 0,
    quoteDate: nullableString(row.quote_date),
    serviceType: nullableString(row.service_type),
    analysisStatus: row.analysis_status,
    createdAt: row.created_at,
    analysis: normalizeRelatedAnalysis(row.deal_analyses),
  };
}

export function normalizeDashboardUpload(value: unknown): DashboardUploadRecord | null {
  const row = objectRecord(value);
  const status = nullableString(row?.status);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.filename !== "string" ||
    !status ||
    !UPLOAD_STATUS_SET.has(status) ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string"
  ) return null;

  return {
    id: row.id,
    organizationId: row.organization_id,
    filename: row.filename,
    status: status as UploadStatus,
    totalRows: typeof row.total_rows === "number" ? row.total_rows : 0,
    validRows: typeof row.valid_rows === "number" ? row.valid_rows : 0,
    invalidRows: typeof row.invalid_rows === "number" ? row.invalid_rows : 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
