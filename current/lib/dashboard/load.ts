import {
  calculateDashboardMetrics,
  selectTopRecoveryOpportunities,
  tenantRecentImports,
} from "@/lib/dashboard/metrics";
import type {
  DashboardData,
  DashboardDealRecord,
  DashboardDiagnostic,
  DashboardDiagnosticStage,
  DashboardMetrics,
  DashboardUploadRecord,
} from "@/lib/dashboard/types";

export type DashboardLoadDependencies = {
  fetchDeals: () => Promise<DashboardDealRecord[]>;
  fetchRecentImports: () => Promise<DashboardUploadRecord[]>;
  calculateMetrics?: (records: readonly DashboardDealRecord[], organizationId: string) => DashboardMetrics;
  selectTopOpportunities?: (
    records: readonly DashboardDealRecord[],
    organizationId: string,
    limit: number,
  ) => DashboardDealRecord[];
  reportDiagnostic?: (diagnostic: DashboardDiagnostic) => void;
};

export class DashboardLoadError extends Error {
  constructor(
    readonly stage: DashboardDiagnosticStage,
    readonly code: string,
  ) {
    super(stage);
    this.name = "DashboardLoadError";
  }
}

function diagnosticFor(error: unknown, fallbackStage: DashboardDiagnosticStage): DashboardDiagnostic {
  if (error instanceof DashboardLoadError) {
    return { stage: error.stage, code: error.code };
  }
  return { stage: fallbackStage, code: "UNKNOWN" };
}

function report(
  reporter: DashboardLoadDependencies["reportDiagnostic"],
  diagnostic: DashboardDiagnostic,
): DashboardDiagnostic {
  reporter?.(diagnostic);
  return diagnostic;
}

export async function loadDashboardData(
  organizationId: string,
  dependencies: DashboardLoadDependencies,
  topOpportunityLimit = 5,
  recentImportLimit = 5,
): Promise<DashboardData> {
  const calculateMetrics = dependencies.calculateMetrics ?? calculateDashboardMetrics;
  const selectTop = dependencies.selectTopOpportunities ?? selectTopRecoveryOpportunities;

  const recentImportsPromise = dependencies.fetchRecentImports()
    .then((records) => ({ records, failed: false }))
    .catch((error: unknown) => {
      report(
        dependencies.reportDiagnostic,
        diagnosticFor(error, "DASHBOARD_IMPORTS_QUERY_FAILED"),
      );
      return { records: [] as DashboardUploadRecord[], failed: true };
    });

  let deals: DashboardDealRecord[];
  try {
    deals = await dependencies.fetchDeals();
  } catch (error) {
    const recentImportsResult = await recentImportsPromise;
    report(
      dependencies.reportDiagnostic,
      diagnosticFor(error, "DASHBOARD_DEALS_QUERY_FAILED"),
    );
    return {
      metrics: calculateDashboardMetrics([], organizationId),
      topOpportunities: [],
      recentImports: tenantRecentImports(recentImportsResult.records, organizationId, recentImportLimit),
      errors: {
        core: true,
        topOpportunities: false,
        recentImports: recentImportsResult.failed,
      },
    };
  }

  let metrics: DashboardMetrics;
  try {
    metrics = calculateMetrics(deals, organizationId);
  } catch (error) {
    const recentImportsResult = await recentImportsPromise;
    report(
      dependencies.reportDiagnostic,
      diagnosticFor(error, "DASHBOARD_METRICS_FAILED"),
    );
    return {
      metrics: calculateDashboardMetrics([], organizationId),
      topOpportunities: [],
      recentImports: tenantRecentImports(recentImportsResult.records, organizationId, recentImportLimit),
      errors: {
        core: true,
        topOpportunities: false,
        recentImports: recentImportsResult.failed,
      },
    };
  }

  let topOpportunities: DashboardDealRecord[] = [];
  let topFailed = false;
  try {
    topOpportunities = selectTop(deals, organizationId, topOpportunityLimit);
  } catch (error) {
    report(
      dependencies.reportDiagnostic,
      diagnosticFor(error, "DASHBOARD_TOP_OPPORTUNITIES_FAILED"),
    );
    topFailed = true;
  }

  const recentImportsResult = await recentImportsPromise;
  return {
    metrics,
    topOpportunities,
    recentImports: tenantRecentImports(recentImportsResult.records, organizationId, recentImportLimit),
    errors: {
      core: false,
      topOpportunities: topFailed,
      recentImports: recentImportsResult.failed,
    },
  };
}
