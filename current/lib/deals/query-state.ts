import {
  DEAL_ANALYSIS_STATUSES,
  DEAL_LOST_REASONS,
  DEAL_PRIORITIES,
  DEAL_SEARCH_MAX_LENGTH,
  DEAL_SORT_DIRECTIONS,
  DEAL_SORT_KEYS,
  type DealAnalysisStatus,
  type DealLostReason,
  type DealPriority,
  type DealSortDirection,
  type DealSortKey,
} from "@/lib/deals/constants";

export type RawSearchParams = Record<string, string | string[] | undefined>;

export type DealsQueryState = {
  q: string;
  page: number;
  sort: DealSortKey;
  direction: DealSortDirection;
  analysis: DealAnalysisStatus | null;
  priority: DealPriority | null;
  reason: DealLostReason | null;
  service: string | null;
  salesperson: string | null;
};

function firstValue(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : "";
}

function enumValue<T extends string>(value: string, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null;
}

function safeFilterValue(value: string, maxLength = 160): string | null {
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
  return normalized || null;
}

export function normalizeDealSearch(value: string): string {
  return safeFilterValue(value, DEAL_SEARCH_MAX_LENGTH) ?? "";
}

export function parseDealsQueryState(raw: RawSearchParams): DealsQueryState {
  const pageValue = firstValue(raw.page);
  const rawPage = /^[1-9]\d*$/.test(pageValue) ? Number(pageValue) : Number.NaN;
  const sort = enumValue(firstValue(raw.sort), DEAL_SORT_KEYS) ?? "created";
  const direction = enumValue(firstValue(raw.direction), DEAL_SORT_DIRECTIONS) ?? "desc";

  return {
    q: normalizeDealSearch(firstValue(raw.q)),
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
    sort,
    direction,
    analysis: enumValue(firstValue(raw.analysis), DEAL_ANALYSIS_STATUSES),
    priority: enumValue(firstValue(raw.priority).toUpperCase(), DEAL_PRIORITIES),
    reason: enumValue(firstValue(raw.reason).toUpperCase(), DEAL_LOST_REASONS),
    service: safeFilterValue(firstValue(raw.service)),
    salesperson: safeFilterValue(firstValue(raw.salesperson)),
  };
}

function escapePostgrestQuotedValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/"/g, '\\"');
}

/**
 * Creates a fixed-shape PostgREST OR expression. User input is always inside
 * a quoted, escaped ILIKE value and can never add another filter operation.
 */
export function buildSafeDealSearchFilter(search: string): string | null {
  const normalized = normalizeDealSearch(search);
  if (!normalized) return null;
  const escaped = escapePostgrestQuotedValue(normalized);
  return `customer_name.ilike."%${escaped}%",external_deal_id.ilike."%${escaped}%"`;
}

export function validateDynamicDealFilters(
  state: DealsQueryState,
  services: readonly string[],
  salespeople: readonly string[],
): DealsQueryState {
  return {
    ...state,
    service: state.service && services.includes(state.service) ? state.service : null,
    salesperson:
      state.salesperson && salespeople.includes(state.salesperson) ? state.salesperson : null,
  };
}

export function hasActiveDealView(state: DealsQueryState): boolean {
  return Boolean(
    state.q ||
      state.analysis ||
      state.priority ||
      state.reason ||
      state.service ||
      state.salesperson ||
      state.page > 1 ||
      state.sort !== "created" ||
      state.direction !== "desc",
  );
}

export function buildDealsUrl(
  state: DealsQueryState,
  overrides: Partial<DealsQueryState> = {},
): string {
  const next = { ...state, ...overrides };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.sort !== "created") params.set("sort", next.sort);
  if (next.direction !== "desc") params.set("direction", next.direction);
  if (next.analysis) params.set("analysis", next.analysis);
  if (next.priority) params.set("priority", next.priority);
  if (next.reason) params.set("reason", next.reason);
  if (next.service) params.set("service", next.service);
  if (next.salesperson) params.set("salesperson", next.salesperson);
  const query = params.toString();
  return query ? `/deals?${query}` : "/deals";
}
