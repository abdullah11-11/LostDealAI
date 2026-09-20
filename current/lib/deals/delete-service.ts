import "server-only";

import {
  deleteDealWithStore,
  type DealDeletionResult,
  type DealDeletionStore,
} from "@/lib/deals/delete-workflow";
import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export function createSupabaseDealDeletionStore(
  supabase: ServerSupabaseClient,
): DealDeletionStore {
  return {
    async fetch(organizationId, dealId) {
      const { data, error } = await supabase
        .from("deals")
        .select("id,organization_id,upload_id")
        .eq("organization_id", organizationId)
        .eq("id", dealId)
        .maybeSingle();
      if (error) throw new Error("DEAL_DELETE_LOOKUP_FAILED");
      if (!data) return null;
      return {
        id: data.id,
        organizationId: data.organization_id,
        uploadId: data.upload_id,
      };
    },

    async delete(organizationId, dealId) {
      const { data, error } = await supabase
        .from("deals")
        .delete()
        .eq("organization_id", organizationId)
        .eq("id", dealId)
        .select("id")
        .maybeSingle();
      if (error) throw new Error("DEAL_DELETE_FAILED");
      return Boolean(data);
    },
  };
}

export async function deleteAuthorizedDeal(
  supabase: ServerSupabaseClient,
  organizationId: string,
  dealId: string,
): Promise<DealDeletionResult> {
  return deleteDealWithStore(createSupabaseDealDeletionStore(supabase), organizationId, dealId);
}
