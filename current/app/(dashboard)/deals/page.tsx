import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  FilterX,
  Search,
  CheckCircle2,
  SlidersHorizontal,
} from "lucide-react";

import { DealPriorityBadge, DealStatusBadge } from "@/components/deal-status";
import { AnalyzePendingDeals } from "@/components/analyze-pending-deals";
import { RecoveryScoreActions } from "@/components/recovery-score-actions";
import { PageHeader } from "@/components/page-heading";
import { EmptyState, Input, Select, Table, buttonStyles } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/server";
import { AI_CONFIG } from "@/lib/ai/config";
import { SCORING_BATCH_LIMIT } from "@/lib/scoring/constants";
import { DEALS_PAGE_SIZE, DEAL_LOST_REASONS } from "@/lib/deals/constants";
import { formatDealCurrency, formatDealDate, humanizeDealEnum } from "@/lib/deals/format";
import {
  buildDealsUrl,
  hasActiveDealView,
  parseDealsQueryState,
  type DealsQueryState,
  type RawSearchParams,
} from "@/lib/deals/query-state";
import { getDealListData, type DealListItem } from "@/lib/deals/server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lost deals" };
export const dynamic = "force-dynamic";

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const rawSearchParams = await searchParams;
  const requestedState = parseDealsQueryState(rawSearchParams);
  const deletedNotice = rawSearchParams.notice === "deleted";
  const context = await requireOrganization(buildDealsUrl(requestedState));
  const supabase = await createClient();
  const result = await getDealListData(supabase, context.organization.id, requestedState);

  const state = result.state;
  const hasViewState = hasActiveDealView(state);
  const currentListUrl = buildDealsUrl(state);
  const activeAdvancedFilters = [
    Boolean(state.reason),
    Boolean(state.service),
    Boolean(state.salesperson),
    state.sort !== "created",
    state.direction !== "desc",
  ].filter(Boolean).length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Pipeline"
        title="Deals"
        description="Your lost opportunities, organized. Find the context and evidence for your next recovery decision."
        action={<Link href="/upload" className={buttonStyles()}>Import Deals <ArrowUpRight aria-hidden="true" className="size-4" /></Link>}
      />

      {deletedNotice && (
        <div role="status" className="mt-6 flex items-center gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-success-content">
          <CheckCircle2 aria-hidden="true" className="size-4" /> Deal deleted.
        </div>
      )}

      <section className="mt-7 rounded-2xl border border-line bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3"><p className="text-sm text-secondary"><strong className="font-semibold text-content">{result.organizationCount.toLocaleString()}</strong> deals · {result.analyzedCount.toLocaleString()} analyzed</p><details className="relative"><summary className="flex min-h-11 list-none items-center gap-2 rounded-lg px-3 text-sm font-semibold text-content hover:bg-panel-hover [&::-webkit-details-marker]:hidden"><SlidersHorizontal aria-hidden="true" className="size-4" />Deal actions</summary><div className="absolute right-0 z-10 mt-2 w-[min(360px,calc(100vw-48px))] space-y-4 rounded-xl border border-line bg-panel p-4 shadow-lg">{result.pendingCount > 0 && <AnalyzePendingDeals pendingCount={result.pendingCount} batchLimit={AI_CONFIG.batchSizeLimit} />}{(result.unscoredCount > 0 || result.analyzedCount > 0) && <RecoveryScoreActions unscoredCount={result.unscoredCount} analyzedCount={result.analyzedCount} batchLimit={SCORING_BATCH_LIMIT} />}{result.pendingCount === 0 && result.analyzedCount === 0 && <p className="text-sm text-secondary">Import deals to make analysis and scoring available.</p>}</div></details></div>
        <form action="/deals" method="get" className="border-b border-line p-4 sm:p-5" aria-label="Search and filter deals">
          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr_0.65fr]">
            <Input
              id="deal-search"
              name="q"
              label="Search"
              type="search"
              placeholder="Search customer or deal ID"
              defaultValue={state.q}
              maxLength={100}
            />
            <Select id="analysis-filter" name="analysis" label="Analysis Status" defaultValue={state.analysis ?? ""}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </Select>
            <Select id="priority-filter" name="priority" label="Priority" defaultValue={state.priority ?? ""}>
              <option value="">All priorities</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </Select>
          </div>

          <details className="group mt-4 rounded-xl border border-line bg-panel-raised" open={activeAdvancedFilters > 0}>
            <summary className="flex min-h-11 list-none items-center justify-between gap-3 rounded-xl px-4 text-sm font-bold text-content transition-colors hover:bg-panel-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35 [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2"><SlidersHorizontal aria-hidden="true" className="size-4 text-brand-strong" />More Filters</span>
              <span className="text-xs font-semibold text-secondary">{activeAdvancedFilters > 0 ? `${activeAdvancedFilters} active` : "Lost reason, team, and sorting"}</span>
            </summary>
            <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2 xl:grid-cols-5">
              <Select id="reason-filter" name="reason" label="Lost Reason" defaultValue={state.reason ?? ""}>
                <option value="">All reasons</option>
                {DEAL_LOST_REASONS.map((reason) => (
                  <option key={reason} value={reason}>{humanizeDealEnum(reason)}</option>
                ))}
              </Select>
              <Select id="service-filter" name="service" label="Service" defaultValue={state.service ?? ""}>
                <option value="">All services</option>
                {result.services.map((service) => <option key={service} value={service}>{service}</option>)}
              </Select>
              <Select id="salesperson-filter" name="salesperson" label="Salesperson" defaultValue={state.salesperson ?? ""}>
                <option value="">All salespeople</option>
                {result.salespeople.map((salesperson) => <option key={salesperson} value={salesperson}>{salesperson}</option>)}
              </Select>
              <Select id="sort-filter" name="sort" label="Sort By" defaultValue={state.sort}>
                <option value="created">Imported date</option>
                <option value="value">Deal value</option>
                <option value="quote_date">Quote date</option>
                <option value="recovery_score">Recovery Score</option>
              </Select>
              <Select id="direction-filter" name="direction" label="Direction" defaultValue={state.direction}>
                <option value="desc">{state.sort === "recovery_score" ? "Highest score first" : "Newest / highest first"}</option>
                <option value="asc">{state.sort === "recovery_score" ? "Lowest score first" : "Oldest / lowest first"}</option>
              </Select>
            </div>
          </details>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-secondary">
              Priority and lost reason use stored analysis only. <Link href={buildDealsUrl(state, { sort: "recovery_score", direction: "desc", page: 1 })} className="font-bold text-brand-content hover:underline">Best Recovery Opportunities</Link>
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {hasViewState && (
                <Link href="/deals" className={buttonStyles("outline")}>
                  <FilterX aria-hidden="true" className="size-4" /> Clear View
                </Link>
              )}
              <button type="submit" className={buttonStyles()}>
                <Search aria-hidden="true" className="size-4" /> Apply View
              </button>
            </div>
          </div>
        </form>

        {result.error ? (
          <div className="p-5 sm:p-6">
            <div role="alert" className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-red-500/35 bg-red-500/10 px-6 py-10 text-center">
              <AlertCircle aria-hidden="true" className="size-8 text-danger-content" />
              <h2 className="mt-4 text-base font-bold text-content">Deals could not be loaded</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-secondary">Your data has not changed. Refresh the page or try again shortly.</p>
              <Link href={currentListUrl} className={buttonStyles("outline", "mt-5")}>Try again</Link>
            </div>
          </div>
        ) : result.organizationCount === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState
              icon={<BriefcaseBusiness aria-hidden="true" className="size-5" />}
              title="No lost deals yet"
              description="Import a CSV to start building your LostDeal AI workspace."
              action={<Link href="/upload" className={buttonStyles()}>Import Deals</Link>}
            />
          </div>
        ) : result.filteredCount === 0 ? (
          <div className="p-5 sm:p-6">
            <EmptyState
              icon={<Search aria-hidden="true" className="size-5" />}
              title="No deals match your filters"
              description="Try a different customer, deal ID, or filter combination."
              action={<Link href="/deals" className={buttonStyles("outline")}>Clear filters</Link>}
            />
          </div>
        ) : (
          <>
            <div className="hidden lg:block"><Table
              className="min-w-[920px]"
              label="Imported lost deals"
              headers={["Customer", "Quoted value", "Lost reason", "Analysis", "Recovery", "Buying intent", "Confidence"]}
            >
              {result.deals.map((deal) => (
                <DealRow key={deal.id} deal={deal} returnTo={currentListUrl} />
              ))}
            </Table></div>
            <div className="grid divide-y divide-line lg:hidden">{result.deals.map(deal => <DealMobileRow key={deal.id} deal={deal} returnTo={currentListUrl} />)}</div>
            <DealsPagination state={state} page={result.page} pageCount={result.pageCount} total={result.filteredCount} />
          </>
        )}
      </section>
    </div>
  );
}

function DealRow({ deal, returnTo }: { deal: DealListItem; returnTo: string }) {
  const href = `/deals/${deal.id}?from=${encodeURIComponent(returnTo)}`;
  return <tr className="transition-colors hover:bg-panel-raised">
    <td className="max-w-64 px-4 py-2.5"><Link href={href} className="block rounded-sm"><span title={deal.customer_name || "Unnamed customer"} className="block truncate text-sm font-semibold text-content hover:text-brand-content">{deal.customer_name || "Unnamed customer"}</span><span className="mt-1 block truncate text-xs text-secondary">{deal.service_type || "No service recorded"}{deal.salesperson ? ` · ${deal.salesperson}` : ""}</span>{deal.external_deal_id && <span title={deal.external_deal_id} className="mt-1 block truncate font-mono text-xs text-muted">{deal.external_deal_id}</span>}</Link></td>
    <td className="whitespace-nowrap px-4 py-2.5"><p className="font-medium tabular-nums text-content">{formatDealCurrency(deal.deal_value)}</p><p className="mt-1 text-xs text-secondary">{formatDealDate(deal.quote_date)}</p></td>
    <td className="px-4 py-2.5 text-secondary">{humanizeDealEnum(deal.analysis?.lost_reason ?? null)}</td>
    <td className="px-4 py-2.5"><DealStatusBadge status={deal.analysis_status} /></td>
    <td className="px-4 py-2.5"><p className="mb-1 font-semibold tabular-nums text-content">{deal.analysis?.recovery_score === null || deal.analysis?.recovery_score === undefined ? "—" : `${deal.analysis.recovery_score}/100`}</p><DealPriorityBadge priority={deal.analysis?.recovery_priority ?? null} /></td>
    <td className="px-4 py-2.5 tabular-nums text-secondary">{deal.analysis?.buying_intent_score === null || deal.analysis?.buying_intent_score === undefined ? "—" : `${deal.analysis.buying_intent_score}/100`}</td>
    <td className="px-4 py-2.5 tabular-nums text-secondary">{deal.analysis ? `${deal.analysis.confidence_score}/100` : "—"}</td>
  </tr>;
}
function DealMobileRow({ deal, returnTo }: { deal: DealListItem; returnTo: string }) {
  return <Link href={`/deals/${deal.id}?from=${encodeURIComponent(returnTo)}`} className="block p-5 hover:bg-panel-raised"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words text-base font-semibold">{deal.customer_name || "Unnamed customer"}</h3><p className="mt-1 text-sm text-secondary">{deal.service_type || "No service recorded"}</p></div><DealStatusBadge status={deal.analysis_status} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-secondary">Quoted value</dt><dd className="mt-1 font-medium">{formatDealCurrency(deal.deal_value)}</dd></div><div><dt className="text-xs text-secondary">Lost reason</dt><dd className="mt-1">{humanizeDealEnum(deal.analysis?.lost_reason ?? null)}</dd></div><div><dt className="text-xs text-secondary">Recovery Score</dt><dd className="mt-1 flex flex-wrap items-center gap-2">{deal.analysis?.recovery_score ?? "—"}<DealPriorityBadge priority={deal.analysis?.recovery_priority ?? null} /></dd></div><div><dt className="text-xs text-secondary">Intent / confidence</dt><dd className="mt-1">{deal.analysis ? `${deal.analysis.buying_intent_score ?? "—"} / ${deal.analysis.confidence_score}` : "—"}</dd></div></dl></Link>;
}

function DealsPagination({
  state,
  page,
  pageCount,
  total,
}: {
  state: DealsQueryState;
  page: number;
  pageCount: number;
  total: number;
}) {
  const first = (page - 1) * DEALS_PAGE_SIZE + 1;
  const last = Math.min(page * DEALS_PAGE_SIZE, total);
  const startPage = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => startPage + index);

  return (
    <nav aria-label="Deals pagination" className="flex flex-col gap-4 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-secondary">Showing {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()} deals</p>
      <div className="flex flex-wrap items-center gap-2">
        {page > 1 ? (
          <Link href={buildDealsUrl(state, { page: page - 1 })} className={buttonStyles("outline", "h-9 px-3")} aria-label="Previous deals page"><ArrowLeft aria-hidden="true" className="size-3.5" />Previous</Link>
        ) : (
          <span aria-disabled="true" className={buttonStyles("outline", "h-9 cursor-not-allowed px-3 opacity-50")}><ArrowLeft aria-hidden="true" className="size-3.5" />Previous</span>
        )}
        {pages.map((pageNumber) => (
          <Link
            key={pageNumber}
            href={buildDealsUrl(state, { page: pageNumber })}
            aria-current={pageNumber === page ? "page" : undefined}
            className={pageNumber === page ? buttonStyles("primary", "size-9 px-0") : buttonStyles("outline", "size-9 px-0")}
          >
            {pageNumber}
          </Link>
        ))}
        {page < pageCount ? (
          <Link href={buildDealsUrl(state, { page: page + 1 })} className={buttonStyles("outline", "h-9 px-3")} aria-label="Next deals page">Next<ArrowRight aria-hidden="true" className="size-3.5" /></Link>
        ) : (
          <span aria-disabled="true" className={buttonStyles("outline", "h-9 cursor-not-allowed px-3 opacity-50")}>Next<ArrowRight aria-hidden="true" className="size-3.5" /></span>
        )}
      </div>
    </nav>
  );
}
