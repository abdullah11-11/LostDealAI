/** Shared V1 database values mirrored by SQL check constraints. */

export const LOST_REASONS = [
  "PRICE",
  "FINANCING",
  "TIMING",
  "COMPETITOR",
  "NO_RESPONSE",
  "DECISION_MAKER",
  "TRUST",
  "PRODUCT_FIT",
  "AVAILABILITY",
  "NO_FOLLOW_UP",
  "BAD_EXPERIENCE",
  "NOT_QUALIFIED",
  "OTHER",
] as const;

export type LostReason = (typeof LOST_REASONS)[number];

export const RECOVERY_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;

export type RecoveryPriority = (typeof RECOVERY_PRIORITIES)[number];

export const RECOMMENDED_CHANNELS = [
  "HUMAN_CALL",
  "SMS",
  "EMAIL",
  "NO_ACTION",
  "OTHER",
] as const;

export type RecommendedChannel = (typeof RECOMMENDED_CHANNELS)[number];

export const ANALYSIS_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;

export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const ANALYSIS_MODES = ["STANDARD", "DEEP"] as const;

export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

export const UPLOAD_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;

export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const ORGANIZATION_ROLES = ["owner", "member"] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
