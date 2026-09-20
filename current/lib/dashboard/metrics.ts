import { ANALYSIS_STATUSES, LOST_REASONS, RECOVERY_PRIORITIES } from "@/types/database";
import type { AnalysisStatus, LostReason, RecoveryPriority } from "@/types/database";
import type {
  AnalysisStatusCounts,
  DashboardDealRecord,
  DashboardMetrics,
  DashboardUploadRecord,
  LossReasonMetric,
  PriorityMetric,
} from "@/lib/dashboard/types";

const LOST_REASON_SET = new Set<string>(LOST_REASONS);
const PRIORITY_SET = new Set<string>(RECOVERY_PRIORITIES);
const ANALYSIS_STATUS_SET = new Set<string>(ANALYSIS_STATUSES);

function oneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

export function dashboardPercentage(count: number, denominator: number): number {
  return denominator > 0 ? oneDecimal((count / denominator) * 100) : 0;
}

function isValidScore(value: number | null): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

function isValidAnalysis(deal: DashboardDealRecord): boolean {
  return Boolean(deal.analysis?.id && deal.analysis.lostReason && LOST_REASON_SET.has(deal.analysis.lostReason));
}

function isValidPriority(value: RecoveryPriority | null): value is RecoveryPriority {
  return Boolean(value && PRIORITY_SET.has(value));
}

export function tenantDashboardDeals(
  records: readonly DashboardDealRecord[],
  organizationId: string,
): DashboardDealRecord[] {
  const unique = new Map<string, DashboardDealRecord>();
  for (const record of records) {
    if (record.organizationId !== organizationId || unique.has(record.id)) continue;
    unique.set(record.id, record);
  }
  return [...unique.values()];
}

export function tenantRecentImports(
  records: readonly DashboardUploadRecord[],
  organizationId: string,
  limit = 5,
): DashboardUploadRecord[] {
  const unique = new Map<string, DashboardUploadRecord>();
  for (const record of records) {
    if (record.organizationId !== organizationId || unique.has(record.id)) continue;
    unique.set(record.id, record);
  }
  return [...unique.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt, "en-US") || left.id.localeCompare(right.id, "en-US"))
    .slice(0, Math.max(0, limit));
}

function compareQuoteDatesDescending(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right.localeCompare(left, "en-US");
}

export function compareTopOpportunities(left: DashboardDealRecord, right: DashboardDealRecord): number {
  const scoreDifference = (right.analysis?.recoveryScore ?? -1) - (left.analysis?.recoveryScore ?? -1);
  if (scoreDifference !== 0) return scoreDifference;
  const valueDifference = right.dealValue - left.dealValue;
  if (valueDifference !== 0) return valueDifference;
  const dateDifference = compareQuoteDatesDescending(left.quoteDate, right.quoteDate);
  if (dateDifference !== 0) return dateDifference;
  return left.id.localeCompare(right.id, "en-US");
}

export function selectTopRecoveryOpportunities(
  records: readonly DashboardDealRecord[],
  organizationId: string,
  limit = 5,
): DashboardDealRecord[] {
  return tenantDashboardDeals(records, organizationId)
    .filter((deal) => isValidAnalysis(deal) && isValidScore(deal.analysis?.recoveryScore ?? null))
    .sort(compareTopOpportunities)
    .slice(0, Math.max(0, limit));
}

function scoringTimestamp(value: string | null): { value: string; epoch: number; date: string } | null {
  if (!value) return null;
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return null;
  return { value, epoch, date: new Date(epoch).toISOString().slice(0, 10) };
}

export function calculateDashboardMetrics(
  records: readonly DashboardDealRecord[],
  organizationId: string,
): DashboardMetrics {
  const deals = tenantDashboardDeals(records, organizationId);
  const statusCounts: AnalysisStatusCounts = { pending: 0, processing: 0, completed: 0, failed: 0, unknown: 0 };
  const reasonCounts = new Map<LostReason, number>();
  const priorityCounts = new Map<RecoveryPriority, { count: number; dealValue: number }>();
  const scoringDates: Array<{ value: string; epoch: number; date: string }> = [];

  let totalLostDealValue = 0;
  let analyzedDeals = 0;
  let scoredDeals = 0;
  let completedButUnscored = 0;
  let highPriorityDeals = 0;
  let highPriorityDealValue = 0;
  let recoveryScoreTotal = 0;
  let invalidCompletedAnalysisCount = 0;
  let invalidScoredPriorityCount = 0;

  for (const deal of deals) {
    totalLostDealValue += Number.isFinite(deal.dealValue) ? deal.dealValue : 0;
    if (ANALYSIS_STATUS_SET.has(deal.analysisStatus)) {
      statusCounts[deal.analysisStatus as AnalysisStatus] += 1;
    } else {
      statusCounts.unknown += 1;
    }

    const validAnalysis = isValidAnalysis(deal);
    if (deal.analysisStatus === "completed") {
      if (validAnalysis) analyzedDeals += 1;
      else invalidCompletedAnalysisCount += 1;
    }
    if (deal.analysisStatus === "completed" && validAnalysis && !isValidScore(deal.analysis?.recoveryScore ?? null)) {
      completedButUnscored += 1;
    }
    if (deal.analysisStatus === "completed" && validAnalysis && deal.analysis?.lostReason) {
      reasonCounts.set(deal.analysis.lostReason, (reasonCounts.get(deal.analysis.lostReason) ?? 0) + 1);
    }

    const score = deal.analysis?.recoveryScore ?? null;
    if (!validAnalysis || !isValidScore(score)) continue;
    scoredDeals += 1;
    recoveryScoreTotal += score;
    const timestamp = scoringTimestamp(deal.analysis?.scoringCalculatedAt ?? null);
    if (timestamp) scoringDates.push(timestamp);

    const priority = deal.analysis?.recoveryPriority ?? null;
    if (!isValidPriority(priority)) {
      invalidScoredPriorityCount += 1;
      continue;
    }
    const bucket = priorityCounts.get(priority) ?? { count: 0, dealValue: 0 };
    bucket.count += 1;
    bucket.dealValue += Number.isFinite(deal.dealValue) ? deal.dealValue : 0;
    priorityCounts.set(priority, bucket);
    if (priority === "HIGH") {
      highPriorityDeals += 1;
      highPriorityDealValue += Number.isFinite(deal.dealValue) ? deal.dealValue : 0;
    }
  }

  const lossReasonDenominator = [...reasonCounts.values()].reduce((sum, count) => sum + count, 0);
  const lossReasons: LossReasonMetric[] = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count, percentage: dashboardPercentage(count, lossReasonDenominator) }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason, "en-US"));

  const priorityDenominator = [...priorityCounts.values()].reduce((sum, bucket) => sum + bucket.count, 0);
  const priorities: PriorityMetric[] = RECOVERY_PRIORITIES.map((priority) => {
    const bucket = priorityCounts.get(priority) ?? { count: 0, dealValue: 0 };
    return {
      priority,
      count: bucket.count,
      percentage: dashboardPercentage(bucket.count, priorityDenominator),
      dealValue: bucket.dealValue,
    };
  });

  scoringDates.sort((left, right) => left.epoch - right.epoch);
  const calculationDays = new Set(scoringDates.map((entry) => entry.date));
  const reconciledStatusDeals = ANALYSIS_STATUSES.reduce((sum, status) => sum + statusCounts[status], 0);

  return {
    totalDeals: deals.length,
    totalLostDealValue,
    analyzedDeals,
    analysisCoveragePercentage: dashboardPercentage(analyzedDeals, deals.length),
    scoredDeals,
    completedButUnscored,
    highPriorityDeals,
    highPriorityDealValue,
    averageRecoveryScore: scoredDeals > 0 ? oneDecimal(recoveryScoreTotal / scoredDeals) : null,
    statusCounts,
    reconciledStatusDeals,
    invalidCompletedAnalysisCount,
    invalidScoredPriorityCount,
    lossReasonDenominator,
    lossReasons,
    priorityDenominator,
    priorities,
    freshness: {
      scoredDeals,
      timestampedDeals: scoringDates.length,
      missingTimestampCount: scoredDeals - scoringDates.length,
      earliestCalculatedAt: scoringDates[0]?.value ?? null,
      latestCalculatedAt: scoringDates.at(-1)?.value ?? null,
      multipleCalculationDates: calculationDays.size > 1,
    },
  };
}
