import type { AnalysisStatus, LostReason, RecoveryPriority, UploadStatus } from "@/types/database";

export type DashboardAnalysisRecord = {
  id: string;
  lostReason: LostReason | null;
  recoveryScore: number | null;
  recoveryPriority: RecoveryPriority | null;
  recommendedAction: string | null;
  scoringCalculatedAt: string | null;
};

export type DashboardDealRecord = {
  id: string;
  organizationId: string;
  customerName: string | null;
  dealValue: number;
  quoteDate: string | null;
  serviceType: string | null;
  analysisStatus: string;
  createdAt: string;
  analysis: DashboardAnalysisRecord | null;
};

export type DashboardUploadRecord = {
  id: string;
  organizationId: string;
  filename: string;
  status: UploadStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  createdAt: string;
  updatedAt: string;
};

export type AnalysisStatusCounts = Record<AnalysisStatus, number> & {
  unknown: number;
};

export type LossReasonMetric = {
  reason: LostReason;
  count: number;
  percentage: number;
};

export type PriorityMetric = {
  priority: RecoveryPriority;
  count: number;
  percentage: number;
  dealValue: number;
};

export type ScoringFreshness = {
  scoredDeals: number;
  timestampedDeals: number;
  missingTimestampCount: number;
  earliestCalculatedAt: string | null;
  latestCalculatedAt: string | null;
  multipleCalculationDates: boolean;
};

export type DashboardMetrics = {
  totalDeals: number;
  totalLostDealValue: number;
  analyzedDeals: number;
  analysisCoveragePercentage: number;
  scoredDeals: number;
  completedButUnscored: number;
  highPriorityDeals: number;
  highPriorityDealValue: number;
  averageRecoveryScore: number | null;
  statusCounts: AnalysisStatusCounts;
  reconciledStatusDeals: number;
  invalidCompletedAnalysisCount: number;
  invalidScoredPriorityCount: number;
  lossReasonDenominator: number;
  lossReasons: LossReasonMetric[];
  priorityDenominator: number;
  priorities: PriorityMetric[];
  freshness: ScoringFreshness;
};

export type DashboardDiagnosticStage =
  | "DASHBOARD_DEALS_QUERY_FAILED"
  | "DASHBOARD_IMPORTS_QUERY_FAILED"
  | "DASHBOARD_METRICS_FAILED"
  | "DASHBOARD_TOP_OPPORTUNITIES_FAILED"
  | "DASHBOARD_DEAL_NORMALIZATION_SKIPPED"
  | "DASHBOARD_IMPORT_NORMALIZATION_SKIPPED";

export type DashboardDiagnostic = {
  stage: DashboardDiagnosticStage;
  code: string;
  skippedRows?: number;
};

export type DashboardData = {
  metrics: DashboardMetrics;
  topOpportunities: DashboardDealRecord[];
  recentImports: DashboardUploadRecord[];
  errors: {
    core: boolean;
    topOpportunities: boolean;
    recentImports: boolean;
  };
};
