import "server-only";

import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export class AuthorizationLookupError extends Error {
  constructor() {
    super("AUTHORIZATION_LOOKUP_FAILED");
    this.name = "AuthorizationLookupError";
  }
}

/** Resolves only a tenant-scoped existence bit and never exposes resource data. */
export async function authorizeDealReference(
  supabase: ServerSupabaseClient,
  organizationId: string,
  dealId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("deals")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", dealId)
    .maybeSingle();
  if (error) throw new AuthorizationLookupError();
  return Boolean(data);
}
