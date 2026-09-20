import { NextResponse } from "next/server";

import { createNormalizedCsv, normalizedCsvFilename } from "@/lib/csv/export";
import { CsvImportError, validateCsvFormData } from "@/lib/csv/server";
import { mutationIssueResponse, validateMutationRequest } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";

export async function POST(request: Request) {
  try {
    const requestIssue = validateMutationRequest(request, "multipart");
    if (requestIssue) return mutationIssueResponse(requestIssue);
    const authorization = await getAuthorizedRouteContext();
    if (authorization.response) return authorization.response;
    const { supabase, identity, organization } = authorization.context;
    const limited = await enforceRateLimitOrRespond(identity.id, "upload_normalize");
    if (limited) return limited;

    const result = await validateCsvFormData(await request.formData(), supabase, organization.id);
    if (!result.validation.readyRows.length) {
      throw new CsvImportError("No Ready rows are available to export.", 422);
    }
    const skipped = result.validation.needsReviewRows.length + result.validation.invalidRows.length;
    return new NextResponse(createNormalizedCsv(result.validation.readyRows), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${normalizedCsvFilename(result.filename)}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-LostDeal-Exported-Rows": String(result.validation.readyRows.length),
        "X-LostDeal-Skipped-Rows": String(skipped),
      },
    });
  } catch (error) {
    if (error instanceof CsvImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "LostDeal AI could not create the normalized CSV. You can still continue with the import." },
      { status: 500 },
    );
  }
}
