import { NextResponse } from "next/server";

import { analyzePendingDeals } from "@/lib/ai/deal-analysis-service";
import { isAnalysisRuntimeSchemaReady } from "@/lib/ai/analysis-persistence";
import { resolveStandardAnalysisAccess } from "@/lib/billing/analysis-access";
import { getOrganizationUsageSnapshot } from "@/lib/billing/usage";
import { mutationIssueResponse, validateMutationRequest } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";
import { EmptyMutationSchema } from "@/lib/security/schemas";

export async function POST(request: Request) {
  try {
    const authorization = await getAuthorizedRouteContext();
    if (authorization.response) return authorization.response;
    const { supabase, identity, organization } = authorization.context;
    const requestIssue = validateMutationRequest(request, "empty-json");
    if (requestIssue) return mutationIssueResponse(requestIssue);
    const parsedBody = EmptyMutationSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) return NextResponse.json({ error: "The request body is invalid." }, { status: 400 });
    const limited = await enforceRateLimitOrRespond(identity.id, "analyze_batch");
    if (limited) return limited;

    const snapshot = await getOrganizationUsageSnapshot(supabase, organization.id);
    if (!snapshot.available || !snapshot.plan || !resolveStandardAnalysisAccess(snapshot.plan.planCode).providerExecutionAllowed) {
      return NextResponse.json({ error: "Standard Analysis access could not be verified." }, { status: 403 });
    }
    if (!await isAnalysisRuntimeSchemaReady(supabase)) {
      return NextResponse.json({ error: "Analysis setup is pending. Try again after the workspace update is applied." }, { status: 503 });
    }

    const result = await analyzePendingDeals(supabase, organization.id);
    return NextResponse.json({ success: true, result });
  } catch {
    return NextResponse.json({ error: "Pending deals could not be analyzed right now. Please try again." }, { status: 503 });
  }
}
