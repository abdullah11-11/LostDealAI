import { NextResponse } from "next/server";

import {
  CsvImportError,
  toCsvValidationResponse,
  validateCsvFormData,
} from "@/lib/csv/server";
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
    const limited = await enforceRateLimitOrRespond(identity.id, "upload_validate");
    if (limited) return limited;

    const result = await validateCsvFormData(await request.formData(), supabase, organization.id);
    return NextResponse.json({ validation: toCsvValidationResponse(result) });
  } catch (error) {
    if (error instanceof CsvImportError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: "LostDeal AI could not validate this CSV. Please try again." },
      { status: 500 },
    );
  }
}
