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
        title="Lost Deals"
        description="Review imported lost opportunities, analyze loss signals, and rank completed analyses by Recovery Score."
        action={<div className="flex flex-col items-stretch gap-2 sm:items-end">
          {result.pendingCount > 0 && <AnalyzePendingDeals pendingCount={result.pendingCount} batchLimit={AI_CONFIG.batchSizeLimit} />}
          {(result.unscoredCount > 0 || result.analyzedCount > 0) && <RecoveryScoreActions unscoredCount={result.unscoredCount} analyzedCount={result.analyzedCount} batchLimit={SCORING_BATCH_LIMIT} />}
          <Link href="/upload" className={buttonStyles()}>
            Import Deals <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </div>}
      />

      {deletedNotice && (
        <div role="status" className="mt-6 flex items-center gap-3 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-success-content">
          <CheckCircle2 aria-hidden="true" className="size-4" /> Deal deleted.
        </div>
      )}

      <section className="mt-7 overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
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
            <Table
              className="min-w-[1280px]"
              label="Imported lost deals"
              headers={["Customer", "Deal Value", "Quote Date", "Service", "Salesperson", "Lost Reason", "Analysis Status", "Recovery Score", "Priority"]}
            >
              {result.deals.map((deal) => (
                <DealRow key={deal.id} deal={deal} returnTo={currentListUrl} />
              ))}
            </Table>
            <DealsPagination state={state} page={result.page} pageCount={result.pageCount} total={result.filteredCount} />
          </>
        )}
      </section>
    </div>
  );
}

function DealRow({ deal, returnTo }: { deal: DealListItem; returnTo: string }) {
  const href = `/deals/${deal.id}?from=${encodeURIComponent(returnTo)}`;
  const linkClass = "block rounded-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/25";
  return (
    <tr className="transition-colors hover:bg-panel-raised">
      <td className="max-w-64 px-4 py-2.5">
        <Link href={href} className={linkClass}>
          <span title={deal.customer_name || "Unnamed customer"} className="block truncate font-bold text-content hover:text-brand">{deal.customer_name || "Unnamed customer"}</span>
          {deal.external_deal_id && <span title={deal.external_deal_id} className="mt-0.5 block truncate text-[11px] text-secondary">{deal.external_deal_id}</span>}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm font-semibold text-secondary"><Link href={href} className={linkClass}>{formatDealCurrency(deal.deal_value)}</Link></td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm text-secondary"><Link href={href} className={linkClass}>{formatDealDate(deal.quote_date)}</Link></td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm text-secondary"><Link href={href} className={linkClass}>{deal.service_type || "—"}</Link></td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm text-secondary"><Link href={href} className={linkClass}>{deal.salesperson || "—"}</Link></td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm text-secondary"><Link href={href} className={linkClass}>{humanizeDealEnum(deal.analysis?.lost_reason ?? null)}</Link></td>
      <td className="whitespace-nowrap px-4 py-2.5"><Link href={href} className={linkClass}><DealStatusBadge status={deal.analysis_status} /></Link></td>
      <td className="whitespace-nowrap px-4 py-2.5 text-sm font-extrabold text-content"><Link href={href} className={linkClass}>{deal.analysis?.recovery_score === null || deal.analysis?.recovery_score === undefined ? "—" : `${deal.analysis.recovery_score}/100`}</Link></td>
      <td className="px-4 py-2.5"><Link href={href} className={linkClass}><DealPriorityBadge priority={deal.analysis?.recovery_priority ?? null} /></Link></td>
    </tr>
  );
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
