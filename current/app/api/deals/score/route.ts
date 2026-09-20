import { NextResponse } from "next/server";

import { isAnalysisRuntimeSchemaReady } from "@/lib/ai/analysis-persistence";
import { scoreAuthorizedDeal } from "@/lib/scoring/score-service";
import { authorizeDealReference } from "@/lib/security/authorization";
import { mutationIssueResponse, validateMutationRequest } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";
import { DealMutationSchema } from "@/lib/security/schemas";

export async function POST(request: Request) {
  try {
    const requestIssue = validateMutationRequest(request, "json");
    if (requestIssue) return mutationIssueResponse(requestIssue);
    const parsedBody = DealMutationSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json({ error: "A valid deal is required." }, { status: 400 });
    }
    const authorization = await getAuthorizedRouteContext();
    if (authorization.response) return authorization.response;
    const { supabase, identity, organization } = authorization.context;
    const authorized = await authorizeDealReference(supabase, organization.id, parsedBody.data.deal_id);
    if (!authorized) return NextResponse.json({ error: "Deal unavailable." }, { status: 404 });
    const limited = await enforceRateLimitOrRespond(identity.id, "score_single");
    if (limited) return limited;
    if (!await isAnalysisRuntimeSchemaReady(supabase)) {
      return NextResponse.json(
        { error: "Recovery Score setup is pending.", code: "MIGRATION_REQUIRED" },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const result = await scoreAuthorizedDeal(supabase, organization.id, parsedBody.data.deal_id);
    if (result.status === "not_found") return NextResponse.json({ error: "Deal unavailable." }, { status: 404 });
    if (result.status === "not_scorable") {
      return NextResponse.json({ error: "Only completed analyses can be scored." }, { status: 422 });
    }
    if (result.status === "failed") {
      return NextResponse.json({ error: "We couldn't calculate the Recovery Score right now." }, { status: 503 });
    }
    return NextResponse.json({ success: true, score: result.score, priority: result.priority });
  } catch {
    return NextResponse.json({ error: "We couldn't calculate the Recovery Score right now." }, { status: 500 });
  }
}
