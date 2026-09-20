import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Calculator,
  ChartNoAxesColumnIncreasing,
  CircleDollarSign,
  FileClock,
  FileUp,
  Gauge,
  ListChecks,
  Target,
} from "lucide-react";

import { DealPriorityBadge } from "@/components/deal-status";
import { LocalTabs } from "@/components/local-tabs";
import { PageHeader } from "@/components/page-heading";
import { RecoveryScoreActions } from "@/components/recovery-score-actions";
import { Badge, Card, EmptyState, Table, buttonStyles } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/server";
import { formatDealCurrency, formatDealTimestamp, humanizeDealEnum } from "@/lib/deals/format";
import { getDashboardData } from "@/lib/dashboard/server";
import type {
  DashboardMetrics,
  DashboardUploadRecord,
  LossReasonMetric,
  PriorityMetric,
  ScoringFreshness,
} from "@/lib/dashboard/types";
import { SCORING_BATCH_LIMIT } from "@/lib/scoring/constants";
import { createClient } from "@/lib/supabase/server";
import type { RecoveryPriority, UploadStatus } from "@/types/database";

export const metadata: Metadata = { title: "Recovery Overview" };
export const dynamic = "force-dynamic";

const HIGH_PRIORITY_URL = "/deals?priority=HIGH&sort=recovery_score&direction=desc";
const SCORED_DEALS_URL = "/deals?sort=recovery_score&direction=desc";

const priorityBarStyles: Record<RecoveryPriority, string> = {
  HIGH: "bg-red-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-priority-low",
};

const uploadTone: Record<UploadStatus, "pending" | "completed" | "failed"> = {
  pending: "pending",
  processing: "pending",
  completed: "completed",
  failed: "failed",
};

export default async function DashboardPage() {
  const context = await requireOrganization("/dashboard");
  const supabase = await createClient();
  const data = await getDashboardData(supabase, context.organization.id);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Overview"
        title="Recovery Overview"
        description="Understand your lost opportunities, identify the strongest recovery candidates, and see what needs attention next."
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/deals" className={buttonStyles("outline")}>View All Deals</Link>
            <Link href="/upload" className={buttonStyles()}>
              Import Deals <ArrowUpRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        }
      />

      {data.errors.core ? (
        <div role="alert" className="mt-8 flex min-h-72 flex-col items-center justify-center rounded-2xl border border-red-500/35 bg-red-500/10 px-6 py-12 text-center shadow-sm">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-panel text-danger-content shadow-sm">
            <AlertCircle aria-hidden="true" className="size-6" />
          </span>
          <h2 className="mt-5 text-lg font-bold text-danger-content">We couldn&apos;t load your recovery overview. Please try again.</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-danger-content">Your data has not been changed. Refresh this page to retry.</p>
        </div>
      ) : data.metrics.totalDeals === 0 ? (
        <Card className="mt-8 p-5 sm:p-8">
          <EmptyState
            icon={<FileUp aria-hidden="true" className="size-6" />}
            title="No lost deals yet"
            description="Import your first CSV to start identifying recovery opportunities. Import lost opportunities, analyze them, then rank the strongest recovery candidates."
            action={<Link href="/upload" className={buttonStyles()}>Import Deals</Link>}
          />
        </Card>
      ) : (
        <DashboardContent data={data} />
      )}
    </div>
  );
}

function DashboardContent({ data }: { data: Awaited<ReturnType<typeof getDashboardData>> }) {
  const { metrics } = data;
  return (
    <>
      <section aria-labelledby="at-a-glance-heading" className="mt-7">
        <h2 id="at-a-glance-heading" className="text-xs font-extrabold uppercase tracking-[0.14em] text-muted">At a Glance</h2>
        <div aria-label="Recovery metrics" className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Lost Deal Value"
          value={formatDealCurrency(metrics.totalLostDealValue)}
          context="Combined quoted value of all imported lost deals."
          href="/deals"
          icon={<CircleDollarSign aria-hidden="true" className="size-5" />}
        />
        <MetricCard
          label="Total Lost Deals"
          value={metrics.totalDeals.toLocaleString("en-US")}
          context="All lost deals in this workspace."
          href="/deals"
          icon={<BriefcaseBusiness aria-hidden="true" className="size-5" />}
        />
        <MetricCard
          label="High Priority Opportunities"
          value={metrics.highPriorityDeals.toLocaleString("en-US")}
          context={`${formatDealCurrency(metrics.highPriorityDealValue)} in High Priority deal value.`}
          href={HIGH_PRIORITY_URL}
          icon={<Target aria-hidden="true" className="size-5" />}
        />
        <MetricCard
          label="Average Recovery Score"
          value={metrics.averageRecoveryScore === null ? "—" : `${metrics.averageRecoveryScore.toFixed(1)} / 100`}
          context="Average across scored opportunities."
          href={SCORED_DEALS_URL}
          icon={<Gauge aria-hidden="true" className="size-5" />}
        />
        </div>
      </section>

      <section aria-labelledby="next-actions-heading" className="mt-6">
        <h2 id="next-actions-heading" className="text-xs font-extrabold uppercase tracking-[0.14em] text-muted">What Should I Do?</h2>
      {metrics.analyzedDeals === 0 && (
        <Callout
          icon={<ListChecks aria-hidden="true" className="size-5" />}
          title="Your deals are ready for analysis"
          description="Analyze your imported deals to identify why they were lost and generate recovery recommendations."
          action={<Link href="/deals?analysis=pending" className={buttonStyles("outline")}>Review Pending Deals</Link>}
        />
      )}

      {metrics.analyzedDeals > 0 && metrics.completedButUnscored > 0 && (
        <Callout
          icon={<Calculator aria-hidden="true" className="size-5" />}
          title="Analyzed deals are ready for scoring"
          description="Recovery scoring is deterministic and uses no AI credits. Scores are calculated only when you choose to run the action."
          action={<a href="#score-actions" className={buttonStyles("outline")}>Calculate Recovery Scores</a>}
        />
      )}

      <div className="mt-4 grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.75fr)]">
        <Card
          title="Top Recovery Opportunities"
          description="The highest-ranked scored deals to review next."
          action={<Link href={SCORED_DEALS_URL} className="text-sm font-bold text-brand-content hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25">View All Deals</Link>}
          className="overflow-hidden"
        >
        {data.errors.topOpportunities ? (
          <div role="alert" className="m-5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-4 text-sm leading-6 text-warning-content sm:m-6">
            Top recovery opportunities couldn&apos;t be loaded. The rest of your overview is still available; refresh to retry this section.
          </div>
        ) : data.topOpportunities.length > 0 ? (
          <Table label="Top Recovery Opportunities" headers={["Customer", "Deal Value", "Lost Reason", "Score", "Priority", "Next Action"]}>
            {data.topOpportunities.map((deal) => (
              <tr key={deal.id} className="transition-colors hover:bg-panel-raised">
                <td className="px-4 py-3">
                  <Link href={`/deals/${deal.id}`} className="font-bold text-content hover:text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25">
                    {deal.customerName ?? "Unnamed customer"}
                  </Link>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-secondary">{formatDealCurrency(deal.dealValue)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-secondary">{humanizeDealEnum(deal.analysis?.lostReason ?? null)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-sm font-extrabold text-content">{deal.analysis?.recoveryScore}/100</td>
                <td className="px-4 py-3"><DealPriorityBadge priority={deal.analysis?.recoveryPriority ?? null} /></td>
                <td className="max-w-60 px-4 py-3 text-sm leading-5 text-secondary">
                  <Link href={`/deals/${deal.id}`} className="line-clamp-2 hover:text-content focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25">
                    {deal.analysis?.recommendedAction ?? "Review deal analysis"}
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <div className="p-5 sm:p-6">
            <EmptyState
              icon={<Gauge aria-hidden="true" className="size-6" />}
              title="No scored opportunities yet"
              description="Completed analyses can be scored with the deterministic Recovery Score when you choose to calculate them."
              action={metrics.completedButUnscored > 0 ? <a href="#score-actions" className={buttonStyles("outline")}>Score Unscored Deals</a> : undefined}
            />
          </div>
        )}
        </Card>
        <NeedsAttention metrics={metrics} />
      </div>
      </section>

      <section aria-labelledby="insights-heading" className="mt-6">
        <h2 id="insights-heading" className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-muted">Insights</h2>
        <LocalTabs
          label="Recovery overview sections"
          defaultTab={metrics.completedButUnscored > 0 ? "coverage" : "insights"}
          tabs={[
            {
              id: "insights",
              label: "Insights",
              content: <div className="grid items-start gap-5 xl:grid-cols-2"><LossReasonDistribution reasons={metrics.lossReasons} denominator={metrics.lossReasonDenominator} /><PriorityDistribution metrics={metrics} /></div>,
            },
            {
              id: "coverage",
              label: "Coverage",
              content: <AnalysisCoverage metrics={metrics} />,
            },
            {
              id: "activity",
              label: "Activity",
              content: <RecentImports imports={data.recentImports} error={data.errors.recentImports} />,
            },
          ]}
        />
      </section>

      <div className="mt-5 rounded-xl border border-line bg-panel px-5 py-4 text-xs leading-5 text-secondary shadow-sm">
        <strong className="text-content">About Recovery Score:</strong> Recovery Score is a prioritization indicator based on deal signals, loss reason, recency and analysis confidence. It is not a prediction or guarantee of conversion.
      </div>
    </>
  );
}

function MetricCard({
  label,
  value,
  context,
  href,
  icon,
}: {
  label: string;
  value: string;
  context: string;
  href: string;
  icon: ReactNode;
}) {
  return (
    <article className="group rounded-2xl border border-line bg-panel shadow-sm transition hover:border-brand/30">
      <Link href={href} className="block h-full rounded-2xl p-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand/10 text-brand-strong">{icon}</span>
          <ArrowUpRight aria-hidden="true" className="size-4 text-secondary transition group-hover:text-brand" />
        </div>
        <p className="mt-4 text-2xl font-semibold tracking-[-0.035em] text-content">{value}</p>
        <h2 className="mt-2 text-sm font-bold text-content">{label}</h2>
        <p className="mt-1 text-xs leading-5 text-secondary">{context}</p>
      </Link>
    </article>
  );
}

function Callout({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action: ReactNode }) {
  return (
    <section className="mt-5 flex flex-col gap-4 rounded-2xl border border-brand/30 bg-brand/10 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-panel text-brand shadow-sm">{icon}</span>
        <div>
          <h2 className="text-base font-bold text-content">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-secondary">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </section>
  );
}

function AnalysisCoverage({ metrics }: { metrics: DashboardMetrics }) {
  const coverage = Math.min(100, Math.max(0, metrics.analysisCoveragePercentage));
  return (
    <Card title="Analysis Coverage" description="Analysis and scoring status across this workspace.">
      <div className="p-5 sm:p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-2xl font-semibold tracking-[-0.03em] text-content">{metrics.analyzedDeals.toLocaleString("en-US")} of {metrics.totalDeals.toLocaleString("en-US")}</p>
            <p className="mt-1 text-xs font-semibold text-secondary">{metrics.analysisCoveragePercentage.toFixed(1)}% analyzed</p>
          </div>
          <Link href="/deals?analysis=completed" className="text-xs font-bold text-brand-content hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25">View analyzed</Link>
        </div>
        <div
          className="mt-4 h-2.5 overflow-hidden rounded-full bg-panel-hover"
          role="progressbar"
          aria-label="Analysis coverage"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={coverage}
          aria-valuetext={`${metrics.analyzedDeals} of ${metrics.totalDeals} deals analyzed, ${metrics.analysisCoveragePercentage.toFixed(1)} percent`}
        >
          <div className="h-full rounded-full bg-brand" style={{ width: `${coverage}%` }} />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusCount label="Completed" value={metrics.statusCounts.completed} href="/deals?analysis=completed" />
          <StatusCount label="Pending" value={metrics.statusCounts.pending} href="/deals?analysis=pending" />
          <StatusCount label="Processing" value={metrics.statusCounts.processing} href="/deals?analysis=processing" />
          <StatusCount label="Failed" value={metrics.statusCounts.failed} href="/deals?analysis=failed" />
        </dl>

        {(metrics.statusCounts.unknown > 0 || metrics.invalidCompletedAnalysisCount > 0) && (
          <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-5 text-warning-content">
            {metrics.statusCounts.unknown > 0 ? `${metrics.statusCounts.unknown} ${metrics.statusCounts.unknown === 1 ? "deal has" : "deals have"} an unrecognized analysis status. ` : ""}
            {metrics.invalidCompletedAnalysisCount > 0 ? `${metrics.invalidCompletedAnalysisCount} completed ${metrics.invalidCompletedAnalysisCount === 1 ? "status does" : "statuses do"} not have a valid related analysis.` : ""}
          </p>
        )}

        <div id="score-actions" className="mt-6 border-t border-line pt-5 scroll-mt-28">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-content">Scoring Coverage</h3>
              <p className="mt-1 text-xs leading-5 text-secondary">
                {metrics.scoredDeals.toLocaleString("en-US")} scored · {metrics.completedButUnscored.toLocaleString("en-US")} completed but unscored
              </p>
              <p className="mt-2 text-xs leading-5 text-secondary">{freshnessText(metrics.freshness)}</p>
            </div>
            <RecoveryScoreActions unscoredCount={metrics.completedButUnscored} analyzedCount={metrics.analyzedDeals} batchLimit={SCORING_BATCH_LIMIT} />
          </div>
          <p className="mt-3 text-[11px] leading-5 text-secondary">Refreshing scores uses deterministic scoring and no AI credits. Scores are never recalculated by opening this dashboard.</p>
        </div>
      </div>
    </Card>
  );
}

function StatusCount({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-raised p-3">
      <dt className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-secondary">{label}</dt>
      <dd className="mt-2">
        <Link href={href} className="text-xl font-semibold text-content hover:text-brand focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25">{value.toLocaleString("en-US")}</Link>
      </dd>
    </div>
  );
}

function freshnessText(freshness: ScoringFreshness): string {
  if (freshness.scoredDeals === 0) return "No persisted Recovery Scores yet.";
  if (!freshness.latestCalculatedAt) return `${freshness.scoredDeals.toLocaleString("en-US")} persisted ${freshness.scoredDeals === 1 ? "score has" : "scores have"} no calculation timestamp.`;
  const latest = formatDealTimestamp(freshness.latestCalculatedAt);
  const missing = freshness.missingTimestampCount > 0
    ? ` ${freshness.missingTimestampCount.toLocaleString("en-US")} ${freshness.missingTimestampCount === 1 ? "score has" : "scores have"} no timestamp.`
    : "";
  if (freshness.multipleCalculationDates) return `Scores include calculations from multiple dates. Latest: ${latest}.${missing}`;
  return `Latest score calculation: ${latest}.${missing}`;
}

function PriorityDistribution({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <Card title="Recovery Priority" description="Persisted priority mix across scored deals with a valid priority.">
      <div className="p-5 sm:p-6">
        {metrics.priorityDenominator > 0 ? (
          <div className="space-y-5">
            {metrics.priorities.map((metric) => <PriorityRow key={metric.priority} metric={metric} />)}
            <p className="text-xs leading-5 text-secondary">Distribution denominator: {metrics.priorityDenominator.toLocaleString("en-US")} scored deals with a valid persisted priority.</p>
            {metrics.invalidScoredPriorityCount > 0 && (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-5 text-warning-content">{metrics.invalidScoredPriorityCount} scored {metrics.invalidScoredPriorityCount === 1 ? "deal is" : "deals are"} excluded because the persisted priority is missing or invalid.</p>
            )}
          </div>
        ) : (
          <EmptyState icon={<BarChart3 aria-hidden="true" className="size-6" />} title="No priority distribution yet" description="Priority distribution appears after analyzed deals receive persisted Recovery Scores and priorities." />
        )}
      </div>
    </Card>
  );
}

function PriorityRow({ metric }: { metric: PriorityMetric }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DealPriorityBadge priority={metric.priority} />
        <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs text-secondary">
          <span><strong className="text-content">{metric.count.toLocaleString("en-US")}</strong> {metric.count === 1 ? "deal" : "deals"}</span>
          <span><strong className="text-content">{metric.percentage.toFixed(1)}%</strong></span>
          <span><strong className="text-content">{formatDealCurrency(metric.dealValue)}</strong></span>
        </div>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-panel-hover" role="img" aria-label={`${humanizeDealEnum(metric.priority)}: ${metric.count} deals, ${metric.percentage.toFixed(1)} percent, ${formatDealCurrency(metric.dealValue)}`}>
        <div className={`h-full rounded-full ${priorityBarStyles[metric.priority]}`} style={{ width: `${Math.min(100, metric.percentage)}%` }} />
      </div>
    </div>
  );
}

function LossReasonDistribution({ reasons, denominator }: { reasons: LossReasonMetric[]; denominator: number }) {
  const top = reasons[0];
  return (
    <Card title="Why Deals Are Being Lost" description="Lost reasons from completed deals with a valid persisted analysis.">
      <div className="p-5 sm:p-6">
        {reasons.length > 0 ? (
          <>
            {top && (
              <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl bg-brand/10 px-4 py-3 text-sm text-secondary">
                <Badge tone="completed">Most common</Badge>
                <span><strong className="text-content">{humanizeDealEnum(top.reason)}</strong> — {top.count.toLocaleString("en-US")} analyzed {top.count === 1 ? "deal" : "deals"}</span>
              </div>
            )}
            <div className="space-y-5">
              {reasons.map((reason) => <LossReasonRow key={reason.reason} reason={reason} />)}
            </div>
            <p className="mt-5 text-xs leading-5 text-secondary">Percentages use {denominator.toLocaleString("en-US")} completed analyzed {denominator === 1 ? "deal" : "deals"} with a valid lost reason.</p>
          </>
        ) : (
          <EmptyState icon={<ChartNoAxesColumnIncreasing aria-hidden="true" className="size-6" />} title="No loss reason data yet" description="Loss-reason analytics appear after deals have completed, valid analyses." />
        )}
      </div>
    </Card>
  );
}

function LossReasonRow({ reason }: { reason: LossReasonMetric }) {
  const label = humanizeDealEnum(reason.reason);
  return (
    <div>
      <div className="flex items-center justify-between gap-4 text-xs">
        <span className="font-semibold text-secondary">{label}</span>
        <span className="text-secondary"><strong className="text-content">{reason.count.toLocaleString("en-US")}</strong> · {reason.percentage.toFixed(1)}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-panel-hover" role="img" aria-label={`${label}: ${reason.count} deals, ${reason.percentage.toFixed(1)} percent`}>
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, reason.percentage)}%` }} />
      </div>
    </div>
  );
}

function NeedsAttention({ metrics }: { metrics: DashboardMetrics }) {
  return (
    <Card title="Needs Attention" description="Operational queues that are ready for review.">
      <div className="divide-y divide-line px-5 sm:px-6">
        <AttentionRow label="Pending Analysis" count={metrics.statusCounts.pending} href="/deals?analysis=pending" action="Review Pending Deals" />
        <AttentionRow label="Failed Analysis" count={metrics.statusCounts.failed} href="/deals?analysis=failed" action="Review Failed Deals" />
        <AttentionRow label="Completed but Unscored" count={metrics.completedButUnscored} href="#score-actions" action="Score Unscored Deals" note="No AI credits used" />
      </div>
    </Card>
  );
}

function AttentionRow({ label, count, href, action, note }: { label: string; count: number; href: string; action: string; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-5">
      <div>
        <p className="text-sm font-bold text-content">{label}</p>
        <p className="mt-1 text-xs text-secondary">{count.toLocaleString("en-US")} {count === 1 ? "deal" : "deals"}{note ? ` · ${note}` : ""}</p>
      </div>
      <Link href={href} className="shrink-0 text-xs font-bold text-brand-content hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25">{action}</Link>
    </div>
  );
}

function RecentImports({ imports, error }: { imports: DashboardUploadRecord[]; error: boolean }) {
  return (
    <Card
      title="Recent Imports"
      description="Latest CSV activity for this workspace."
      action={<Link href="/upload" className="text-sm font-bold text-brand-content hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25">View Imports</Link>}
    >
      {error ? (
        <div role="alert" className="m-5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-4 text-sm leading-6 text-warning-content sm:m-6">
          Recent imports are temporarily unavailable. Your dashboard metrics and recovery opportunities are unaffected.
        </div>
      ) : imports.length > 0 ? (
        <ul className="divide-y divide-line px-5 sm:px-6">
          {imports.map((item) => <RecentImportRow key={item.id} item={item} />)}
        </ul>
      ) : (
        <div className="p-5 sm:p-6">
          <EmptyState icon={<FileClock aria-hidden="true" className="size-6" />} title="No import activity yet" description="New CSV imports will appear here after they are created." action={<Link href="/upload" className={buttonStyles("outline")}>Import Deals</Link>} />
        </div>
      )}
    </Card>
  );
}

function RecentImportRow({ item }: { item: DashboardUploadRecord }) {
  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-content">{item.filename}</p>
        <p className="mt-1 text-xs leading-5 text-secondary">{item.totalRows.toLocaleString("en-US")} rows · {item.validRows.toLocaleString("en-US")} valid · Updated {formatDealTimestamp(item.updatedAt)}</p>
      </div>
      <Badge tone={uploadTone[item.status]}>{humanizeDealEnum(item.status)}</Badge>
    </li>
  );
}
