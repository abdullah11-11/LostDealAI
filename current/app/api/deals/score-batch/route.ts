import { NextResponse } from "next/server";

import { isAnalysisRuntimeSchemaReady } from "@/lib/ai/analysis-persistence";
import { scoreOrganizationAnalyses } from "@/lib/scoring/score-service";
import { mutationIssueResponse, validateMutationRequest } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";
import { ScoreBatchMutationSchema } from "@/lib/security/schemas";

export async function POST(request: Request) {
  try {
    const requestIssue = validateMutationRequest(request, "json");
    if (requestIssue) return mutationIssueResponse(requestIssue);
    const parsedBody = ScoreBatchMutationSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json({ error: "A valid scoring operation is required." }, { status: 400 });
    }
    const authorization = await getAuthorizedRouteContext();
    if (authorization.response) return authorization.response;
    const { supabase, identity, organization } = authorization.context;
    const limited = await enforceRateLimitOrRespond(identity.id, "score_batch");
    if (limited) return limited;
    if (!await isAnalysisRuntimeSchemaReady(supabase)) {
      return NextResponse.json(
        { error: "Recovery Score setup is pending.", code: "MIGRATION_REQUIRED" },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const result = await scoreOrganizationAnalyses(
      supabase,
      organization.id,
      parsedBody.data.mode,
      parsedBody.data.cursor ?? null,
    );
    return NextResponse.json({ success: true, result });
  } catch {
    return NextResponse.json({ error: "Recovery Scores could not be calculated right now." }, { status: 503 });
  }
}
