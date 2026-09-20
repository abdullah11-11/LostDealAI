import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSafeNextPath } from "@/lib/auth/validation";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type VerifiedIdentity = {
  id: string;
  email: string;
  metadataFullName: string | null;
};

export type ActiveOrganization = {
  id: string;
  name: string;
  industry: string | null;
  role: string;
};

export type AppAuthContext = {
  identity: VerifiedIdentity | null;
  profileFullName: string | null;
  organization: ActiveOrganization | null;
};

function metadataFullName(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("full_name" in value)) return null;
  const fullName = value.full_name;
  return typeof fullName === "string" && fullName.trim() ? fullName.trim() : null;
}

/** Verifies the cookie token signature before returning an identity. */
export async function getVerifiedIdentity(
  supabase?: ServerSupabaseClient,
): Promise<VerifiedIdentity | null> {
  const client = supabase ?? (await createClient());
  const { data, error } = await client.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims || typeof claims.sub !== "string" || !claims.sub) {
    return null;
  }

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    metadataFullName: metadataFullName(claims.user_metadata),
  };
}

export async function getActiveOrganization(
  supabase: ServerSupabaseClient,
  userId: string,
): Promise<ActiveOrganization | null> {
  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("organization_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError) throw new Error("Unable to read workspace membership.");
  if (!membership) return null;

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name, industry")
    .eq("id", membership.organization_id)
    .maybeSingle();

  if (organizationError) throw new Error("Unable to read workspace details.");
  if (!organization) return null;

  return {
    id: organization.id,
    name: organization.name,
    industry: organization.industry,
    role: membership.role,
  };
}

export async function getAppAuthContext(): Promise<AppAuthContext> {
  const supabase = await createClient();
  const identity = await getVerifiedIdentity(supabase);

  if (!identity) {
    return { identity: null, profileFullName: null, organization: null };
  }

  const [{ data: profile, error: profileError }, organization] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", identity.id).maybeSingle(),
    getActiveOrganization(supabase, identity.id),
  ]);

  if (profileError) throw new Error("Unable to read your profile.");

  return {
    identity,
    profileFullName: profile?.full_name?.trim() || identity.metadataFullName,
    organization,
  };
}

export async function requireOrganization(
  nextPath: string,
): Promise<AppAuthContext & { identity: VerifiedIdentity; organization: ActiveOrganization }> {
  const context = await getAppAuthContext();
  const safeNext = getSafeNextPath(nextPath);

  if (!context.identity) {
    redirect(`/login?next=${encodeURIComponent(safeNext)}`);
  }
  if (!context.organization) redirect(`/onboarding?next=${encodeURIComponent(safeNext)}`);

  return {
    ...context,
    identity: context.identity,
    organization: context.organization,
  };
}

export async function redirectAuthenticatedUser(): Promise<void> {
  const context = await getAppAuthContext();
  if (!context.identity) return;

  redirect(context.organization ? "/dashboard" : "/onboarding");
}

export async function currentRequestDestination(fallback = "/dashboard"): Promise<string> {
  const { headers } = await import("next/headers");
  const headerStore = await headers();
  return getSafeNextPath(headerStore.get("x-lostdeal-request-path") ?? fallback);
}
