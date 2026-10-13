import { buildDealsUrl, parseDealsQueryState, type DealsQueryState, type RawSearchParams } from "@/lib/deals/query-state";

/** The queue uses stored priorities. It never infers a due date from free-form AI timing. */
export function parseRecoveryQuery(raw: RawSearchParams): DealsQueryState {
  const state = parseDealsQueryState(raw);
  return { ...state, priority: state.priority ?? "HIGH", analysis: "completed", sort: "recovery_score", direction: "desc" };
}
export function buildRecoveryUrl(state: DealsQueryState, overrides: Partial<DealsQueryState> = {}) {
  return buildDealsUrl(parseRecoveryQuery({}), { ...state, ...overrides, analysis: "completed", sort: "recovery_score", direction: "desc" }).replace(/^\/deals/, "/recovery");
}
