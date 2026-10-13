import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, BarChart3, FileSearch } from "lucide-react";
import { PageHeader } from "@/components/page-heading";
import { Card, EmptyState, buttonStyles } from "@/components/ui";
import { DealPriorityBadge } from "@/components/deal-status";
import { requireOrganization } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getInsightsData } from "@/lib/dashboard/server";
import { formatDealCurrency, humanizeDealEnum } from "@/lib/deals/format";

export const metadata: Metadata = { title: "Insights", description: "Understand recurring loss reasons, analysis coverage and saved recovery priorities." };
export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const context = await requireOrganization("/insights");
  const supabase = await createClient();
  const data = await getInsightsData(supabase, context.organization.id);
  const metrics = data.metrics;
  const topReason = metrics.lossReasons[0];
  return <div className="mx-auto max-w-6xl">
    <PageHeader eyebrow="Learn from losses" title="Insights" description="See the patterns in your saved analyses. Use them to improve the next conversation and focus your recovery work." action={<Link href="/deals?analysis=completed" className={buttonStyles("outline")}>Review analyzed deals <ArrowUpRight aria-hidden="true" className="size-4" /></Link>} />
    {data.errors.core ? <div role="alert" className="mt-7 rounded-xl border border-line bg-panel p-6"><h2 className="font-semibold">Insights are temporarily unavailable</h2><p className="mt-2 text-secondary">Your data has not changed.</p><Link href="/insights" className={buttonStyles("outline", "mt-4")}>Try again</Link></div> : metrics.analyzedDeals === 0 ? <div className="mt-7"><EmptyState icon={<FileSearch aria-hidden="true" className="size-6" />} title="Your insights start with analysis" description="Import your deals, then explicitly run an analysis to learn why they were lost. Your saved results will appear here." action={<Link href={metrics.totalDeals ? "/deals?analysis=pending" : "/upload"} className={buttonStyles()}>{metrics.totalDeals ? "Review pending deals" : "Import your first deals"}</Link>} /></div> : <div className="mt-7 space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <InsightStat label="Analyzed deals" value={metrics.analyzedDeals.toLocaleString()} detail={`Out of ${metrics.totalDeals.toLocaleString()} imported deals`} />
        <InsightStat label="Analysis coverage" value={`${metrics.analysisCoveragePercentage.toFixed(1)}%`} detail="Completed, valid saved analyses" />
        <InsightStat label="Most common loss reason" value={humanizeDealEnum(topReason?.reason ?? null)} detail={topReason ? `${topReason.count} of ${metrics.lossReasonDenominator} analyzed deals` : "No valid classifications recorded"} />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card title="What is getting in the way?" description="Reasons classified from completed, saved analyses.">
          <div className="space-y-5 p-5 sm:p-6">{metrics.lossReasons.map(reason => <div key={reason.reason}><div className="flex items-center justify-between gap-4 text-sm"><Link href={`/deals?analysis=completed&reason=${reason.reason}`} className="font-medium hover:text-brand-content">{humanizeDealEnum(reason.reason)}</Link><span className="tabular-nums text-secondary">{reason.count} deals · {reason.percentage.toFixed(1)}%</span></div><div role="img" aria-label={`${humanizeDealEnum(reason.reason)}, ${reason.count} deals, ${reason.percentage.toFixed(1)} percent`} className="mt-2 h-2 overflow-hidden rounded-full bg-panel-hover"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, reason.percentage)}%` }} /></div></div>)}<p className="border-t border-line pt-4 text-xs leading-5 text-secondary">Percentages use {metrics.lossReasonDenominator} completed analyses with a valid loss reason. Unanalyzed deals are excluded.</p></div>
        </Card>
        <Card title="Where to focus recovery" description="Quoted value associated with saved recovery priorities.">
          <div className="divide-y divide-line px-5 sm:px-6">{metrics.priorities.map(priority => <div key={priority.priority} className="py-5"><div className="flex items-center justify-between gap-3"><DealPriorityBadge priority={priority.priority} /><strong className="metric-value text-xl font-semibold">{formatDealCurrency(priority.dealValue)}</strong></div><div className="mt-3 flex items-center justify-between gap-3 text-sm text-secondary"><span>{priority.count} deals · {priority.percentage.toFixed(1)}%</span><Link href={`/recovery?priority=${priority.priority}`} className="rounded-md py-2 font-medium text-brand-content hover:underline">Review queue</Link></div></div>)}</div>
        </Card>
      </div>
      <Card title="Use this insight" action={<BarChart3 aria-hidden="true" className="size-5 text-secondary" />}><div className="p-5 sm:p-6"><p className="text-base leading-7 text-content">{topReason ? `${humanizeDealEnum(topReason.reason)} appears most often in this analyzed set. Review the related evidence before changing your process: a loss classification describes the saved record, not the cause of every lost deal.` : "Review saved deal evidence before drawing conclusions about your sales process."}</p><div className="mt-5 flex flex-wrap gap-3"><Link href={topReason ? `/deals?analysis=completed&reason=${topReason.reason}` : "/deals?analysis=completed"} className={buttonStyles("outline")}>Review supporting deals</Link><Link href="/recovery" className={buttonStyles("ghost")}>Open Recovery Queue</Link></div></div></Card>
      <p className="text-sm leading-6 text-secondary">These are descriptive insights from your workspace. Quoted value is not recovered revenue, an expected return or a conversion forecast. No competitor, campaign or win-rate analytics are inferred from data you have not provided.</p>
    </div>}
  </div>;
}

function InsightStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="rounded-xl border border-line bg-panel p-5"><p className="text-sm font-medium text-secondary">{label}</p><p className="metric-value mt-3 break-words text-2xl font-semibold">{value}</p><p className="mt-2 text-xs text-secondary">{detail}</p></article>;
}
