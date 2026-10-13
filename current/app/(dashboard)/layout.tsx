import { DashboardShell } from "@/components/dashboard-shell";
import { currentRequestDestination, requireOrganization } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/plans";
import { isPaddleProvider } from "@/lib/billing/provider";

export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const destination = await currentRequestDestination();
  const context = await requireOrganization(destination);
  const organization = context.organization;
  const identity = context.identity;
  const supabase = await createClient();
  const { data, error } = await supabase.from("organization_subscriptions")
    .select("plan_code,subscription_status,provider").eq("organization_id", organization.id).maybeSingle();
  const plan = !error ? getEntitlements(data?.plan_code) : null;

  return (
    <DashboardShell
      organizationName={organization.name}
      userName={context.profileFullName || identity.email}
      planName={plan?.displayName ?? null}
      subscriptionStatus={!error ? data?.subscription_status ?? null : null}
      providerActionsRestricted={Boolean(error || !plan || (isPaddleProvider(data?.provider) && data.subscription_status !== "active"))}
    >
      {children}
    </DashboardShell>
  );
}
