import "server-only";

import { NextResponse } from "next/server";

import {
  getActiveOrganization,
  getVerifiedIdentity,
  type ActiveOrganization,
  type VerifiedIdentity,
} from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type AuthorizedRouteContext = {
  supabase: ServerSupabaseClient;
  identity: VerifiedIdentity;
  organization: ActiveOrganization;
};

export async function getAuthorizedRouteContext(): Promise<
  | { context: AuthorizedRouteContext; response?: never }
  | { context?: never; response: NextResponse }
> {
  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);
  if (!identity) {
    return {
      response: NextResponse.json(
        { error: "Your session has expired. Log in and try again." },
        { status: 401, headers: { "Cache-Control": "private, no-store" } },
      ),
    };
  }
  const organization = await getActiveOrganization(supabase, identity.id);
  if (!organization) {
    return {
      response: NextResponse.json(
        { error: "Complete workspace setup before continuing." },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      ),
    };
  }
  return { context: { supabase, identity, organization } };
}
