import type { DealsQueryState } from "@/lib/deals/query-state";

export type RecoveryScoreOrderRequest = {
  target_organization_id: string;
  target_search: string | null;
  target_analysis_status: DealsQueryState["analysis"];
  target_priority: DealsQueryState["priority"];
  target_reason: DealsQueryState["reason"];
  target_service: string | null;
  target_salesperson: string | null;
  target_ascending: boolean;
  target_offset: number;
  target_limit: number;
};

export function buildRecoveryScoreOrderRequest(
  organizationId: string,
  state: DealsQueryState,
  offset: number,
  limit: number,
): RecoveryScoreOrderRequest {
  return {
    target_organization_id: organizationId,
    target_search: state.q || null,
    target_analysis_status: state.analysis,
    target_priority: state.priority,
    target_reason: state.reason,
    target_service: state.service,
    target_salesperson: state.salesperson,
    target_ascending: state.direction === "asc",
    target_offset: offset,
    target_limit: limit,
  };
}

export function reorderRowsById<T extends { id: string }>(
  rows: readonly T[],
  orderedIds: readonly string[],
): T[] | null {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = orderedIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  return ordered.length === orderedIds.length ? ordered : null;
}
