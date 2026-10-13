import { NextResponse } from "next/server";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { buildTenantDataExport, DATA_EXPORT_FIELDS, DataExportError } from "@/lib/settings/data-export";

export async function GET() {
  const auth = await getAuthorizedRouteContext();
  if (auth.response) return auth.response;
  const { supabase, identity, organization } = auth.context;
  const limited = await enforceRateLimitOrRespond(identity.id, "export_deals");
  if (limited) return limited;
  try {
    const csv = await buildTenantDataExport(organization.id, async (from, to) => {
      const { data, count, error } = await supabase.from("deals").select(DATA_EXPORT_FIELDS, { count: "exact" })
        .eq("organization_id", organization.id).order("id", { ascending: true }).range(from, to);
      return { rows: (data ?? []) as unknown as Record<string, unknown>[], count, error: Boolean(error) };
    });
    return new Response(csv, { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="lostdeal-workspace-deals.csv"',
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    const tooLarge = error instanceof DataExportError && error.reason === "too_large";
    return NextResponse.json({ error: tooLarge ? "This export exceeds the 5,000-deal or 8 MB download limit. A larger workspace export needs operator assistance." : "Your export could not be prepared. Nothing has changed. Try again shortly." }, { status: tooLarge ? 413 : 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
