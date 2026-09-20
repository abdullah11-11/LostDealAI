import { DashboardShell } from "@/components/dashboard-shell";
import { currentRequestDestination, requireOrganization } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const destination = await currentRequestDestination();
  const context = await requireOrganization(destination);
  const organization = context.organization;
  const identity = context.identity;

  return (
    <DashboardShell
      organizationName={organization.name}
      userName={context.profileFullName || identity.email}
    >
      {children}
    </DashboardShell>
  );
}
