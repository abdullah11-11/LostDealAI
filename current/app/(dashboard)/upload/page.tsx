import type { Metadata } from "next";

import { CsvImportWorkflow, type RecentImport } from "@/components/csv-import-workflow";
import { PageHeader } from "@/components/page-heading";
import { Badge } from "@/components/ui";
import { requireOrganization } from "@/lib/auth/server";
import { resolveAutoConvertAccess } from "@/lib/billing/auto-convert-access";
import { getOrganizationUsageSnapshot } from "@/lib/billing/usage";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Upload lost deals" };
export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const context = await requireOrganization("/upload");
  const supabase = await createClient();
  const [{ data, error }, usageSnapshot] = await Promise.all([
    supabase
      .from("uploads")
      .select("id, filename, created_at, valid_rows, status")
      .eq("organization_id", context.organization.id)
      .order("created_at", { ascending: false })
      .limit(6),
    getOrganizationUsageSnapshot(supabase, context.organization.id),
  ]);

  const recentImports: RecentImport[] = error
    ? []
    : (data ?? []).map((upload) => ({
        id: upload.id,
        filename: upload.filename,
        createdAt: upload.created_at,
        rowsImported: upload.valid_rows,
        status: upload.status as RecentImport["status"],
      }));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Import"
        title="Imports"
        description="Bring your lost deals into focus. Map your CSV, review the results and confirm the rows you want to import."
        action={<Badge tone="neutral">CSV supported</Badge>}
      />
      <div className="mt-8">
        <CsvImportWorkflow
          organizationName={context.organization.name}
          recentImports={recentImports}
          recentImportsUnavailable={Boolean(error)}
          autoConvertAccess={usageSnapshot.plan ? {
            planCode: usageSnapshot.plan.planCode,
            ...resolveAutoConvertAccess(
              usageSnapshot.plan.planCode,
              usageSnapshot.subscriptionStatus,
              usageSnapshot.mode,
            ),
          } : {
            planCode: null,
            state: "INACTIVE",
            entitled: false,
            providerExecutionAllowed: false,
            trialPreviewEligible: false,
          }}
        />
      </div>
    </div>
  );
}
