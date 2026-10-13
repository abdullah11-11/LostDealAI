import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, ListOrdered, Search } from "lucide-react";
import { PageHeader } from "@/components/page-heading";
import { DealPriorityBadge } from "@/components/deal-status";
import { Card, EmptyState, Input, buttonStyles } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getDealListData } from "@/lib/deals/server";
import { parseRecoveryQuery, buildRecoveryUrl } from "@/lib/deals/recovery-view";
import type { RawSearchParams } from "@/lib/deals/query-state";
import { formatDealCurrency, humanizeDealEnum } from "@/lib/deals/format";
import { DEAL_PRIORITIES, DEALS_PAGE_SIZE } from "@/lib/deals/constants";

export const metadata: Metadata = { title: "Recovery Queue", description: "Review saved recovery priorities and evidence before your next move." };
export const dynamic = "force-dynamic";

export default async function RecoveryPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const requested = parseRecoveryQuery(await searchParams);
  const context = await requireOrganization(buildRecoveryUrl(requested));
  const supabase = await createClient();
  const result = await getDealListData(supabase, context.organization.id, requested);
  const state = result.state;
  return <div className="mx-auto max-w-6xl">
    <PageHeader eyebrow="Prioritize" title="Recovery Queue" description="A focused shortlist from your saved analyses. Review the evidence, then decide how to reconnect." action={<Link href="/deals?analysis=completed" className={buttonStyles("outline")}>All analyzed deals</Link>} />
    <section className="mt-7">
      <nav aria-label="Recovery priority" className="mb-5 flex flex-wrap gap-1 rounded-xl border border-line bg-panel p-1.5">
        {DEAL_PRIORITIES.map(priority => <Link key={priority} href={buildRecoveryUrl(state, { priority, page: 1 })} aria-current={state.priority === priority ? "page" : undefined} className={`min-h-11 flex-1 rounded-lg px-4 py-2.5 text-center text-sm font-medium ${state.priority === priority ? "bg-panel-hover text-content" : "text-secondary hover:bg-panel-raised"}`}>{humanizeDealEnum(priority)} priority</Link>)}
      </nav>
      <Card>
        <form action="/recovery" method="get" className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-end"><input type="hidden" name="priority" value={state.priority ?? "HIGH"} /><div className="flex-1"><Input id="recovery-search" name="q" type="search" label="Find an opportunity" placeholder="Customer or deal ID" maxLength={100} defaultValue={state.q} /></div><button type="submit" className={buttonStyles("outline")}><Search aria-hidden="true" className="size-4" />Search</button>{state.q && <Link href={buildRecoveryUrl(state, { q: "", page: 1 })} className={buttonStyles("ghost")}>Clear search</Link>}</form>
        {result.error ? <div role="alert" className="p-6"><h2 className="font-semibold">The queue could not be loaded</h2><p className="mt-2 text-secondary">Your saved data has not changed.</p><Link href={buildRecoveryUrl(state)} className={buttonStyles("outline", "mt-4")}>Try again</Link></div> : result.deals.length === 0 ? <div className="p-6"><EmptyState icon={<ListOrdered aria-hidden="true" className="size-6" />} title={state.q ? "No matching opportunities" : `No ${state.priority?.toLowerCase()} priority opportunities yet`} description="This queue uses completed analyses with saved priorities. Review your analyzed deals or change the priority view." action={<Link href="/deals?analysis=completed" className={buttonStyles("outline")}>Review analyzed deals</Link>} /></div> : <ol className="divide-y divide-line" aria-label="Ranked recovery opportunities">
          {result.deals.map((deal, index) => <li key={deal.id} className="p-5 sm:p-6"><div className="grid gap-4 sm:grid-cols-[28px_minmax(0,1fr)_auto]">
            <span className="hidden pt-1 text-sm tabular-nums text-muted sm:block">{String((result.page - 1) * DEALS_PAGE_SIZE + index + 1).padStart(2, "0")}</span>
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Link href={`/deals/${deal.id}?from=${encodeURIComponent(buildRecoveryUrl(state))}`} className="break-words text-lg font-semibold tracking-tight hover:text-brand-content">{deal.customer_name || "Unnamed customer"}</Link><DealPriorityBadge priority={deal.analysis?.recovery_priority ?? null} /></div><p className="mt-1 text-sm text-secondary">{formatDealCurrency(deal.deal_value)} quoted · {humanizeDealEnum(deal.analysis?.lost_reason ?? null)}{deal.salesperson ? ` · ${deal.salesperson}` : ""}</p><p className="mt-3 text-base leading-7 text-content">{deal.analysis?.recommended_action || "Review the source evidence before making a recovery decision."}</p><dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm"><div><dt className="inline text-secondary">Suggested timing </dt><dd className="inline text-content">{deal.analysis?.recommended_timing || "Not recorded"}</dd></div><div><dt className="inline text-secondary">Channel </dt><dd className="inline text-content">{humanizeDealEnum(deal.analysis?.recommended_channel ?? null)}</dd></div></dl></div>
            <div className="flex items-start justify-between gap-4 sm:flex-col sm:items-end"><div className="text-right"><span className="metric-value text-3xl font-semibold">{deal.analysis?.recovery_score ?? "—"}</span><span className="text-xs text-secondary"> / 100</span><p className="text-xs text-secondary">Recovery Score</p></div><Link href={`/deals/${deal.id}?from=${encodeURIComponent(buildRecoveryUrl(state))}`} className={buttonStyles("outline", "whitespace-nowrap")}>Review deal <ArrowUpRight aria-hidden="true" className="size-4" /></Link></div>
          </div></li>)}
        </ol>}
        {!result.error && result.filteredCount > 0 && <nav aria-label="Recovery queue pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4"><p className="text-sm text-secondary">{result.filteredCount.toLocaleString()} opportunities · Page {result.page} of {result.pageCount}</p><div className="flex gap-2">{result.page > 1 && <Link href={buildRecoveryUrl(state, { page: result.page - 1 })} className={buttonStyles("outline")}><ArrowLeft aria-hidden="true" className="size-4" />Previous</Link>}{result.page < result.pageCount && <Link href={buildRecoveryUrl(state, { page: result.page + 1 })} className={buttonStyles("outline")}>Next<ArrowRight aria-hidden="true" className="size-4" /></Link>}</div></nav>}
      </Card>
    </section>
    <p className="mt-5 text-sm leading-6 text-secondary">Priorities and recommendations are saved analysis results. Suggested timing is an AI interpretation, not a due date. Recovery Score ranks attention; it does not predict conversion. Nothing is sent automatically.</p>
  </div>;
}
