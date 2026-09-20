import { LOST_REASONS } from "@/types/database";

export const DEALS_PAGE_SIZE = 25;
export const DEAL_SEARCH_MAX_LENGTH = 100;

export const DEAL_ANALYSIS_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;

export type DealAnalysisStatus = (typeof DEAL_ANALYSIS_STATUSES)[number];

export const DEAL_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type DealPriority = (typeof DEAL_PRIORITIES)[number];

export const DEAL_LOST_REASONS = LOST_REASONS;
export type DealLostReason = (typeof DEAL_LOST_REASONS)[number];

export const DEAL_SORT_KEYS = ["created", "value", "quote_date", "recovery_score"] as const;
export type DealSortKey = (typeof DEAL_SORT_KEYS)[number];

export const DEAL_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type DealSortDirection = (typeof DEAL_SORT_DIRECTIONS)[number];

export const DEAL_SORT_COLUMNS: Record<DealSortKey, string> = {
  created: "created_at",
  value: "deal_value",
  quote_date: "quote_date",
  recovery_score: "recovery_score",
};
