export type DeletableDeal = {
  id: string;
  organizationId: string;
  uploadId: string | null;
};

export type DealDeletionStore = {
  fetch(organizationId: string, dealId: string): Promise<DeletableDeal | null>;
  delete(organizationId: string, dealId: string): Promise<boolean>;
};

export type DealDeletionResult =
  | { status: "deleted"; uploadId: string | null }
  | { status: "not_found" }
  | { status: "failed" };

/** Tenant ownership is checked before the narrowly scoped delete is attempted. */
export async function deleteDealWithStore(
  store: DealDeletionStore,
  organizationId: string,
  dealId: string,
): Promise<DealDeletionResult> {
  let deal: DeletableDeal | null;
  try {
    deal = await store.fetch(organizationId, dealId);
  } catch {
    return { status: "failed" };
  }
  if (!deal) return { status: "not_found" };

  try {
    return await store.delete(organizationId, dealId)
      ? { status: "deleted", uploadId: deal.uploadId }
      : { status: "not_found" };
  } catch {
    return { status: "failed" };
  }
}
