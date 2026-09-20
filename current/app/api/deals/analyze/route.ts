import { NextResponse } from "next/server";

import { analyzeAuthorizedDeal } from "@/lib/ai/deal-analysis-service";
import { isAnalysisRuntimeSchemaReady } from "@/lib/ai/analysis-persistence";
import { resolveStandardAnalysisAccess } from "@/lib/billing/analysis-access";
import { getOrganizationUsageSnapshot } from "@/lib/billing/usage";
import { authorizeDealReference } from "@/lib/security/authorization";
import { mutationIssueResponse, validateMutationRequest } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";
import { DealMutationSchema } from "@/lib/security/schemas";

export async function POST(request: Request) {
  try {
    const authorization = await getAuthorizedRouteContext();
    if (authorization.response) return authorization.response;
    const { supabase, identity, organization } = authorization.context;
    const requestIssue = validateMutationRequest(request, "json");
    if (requestIssue) return mutationIssueResponse(requestIssue);
    const parsedBody = DealMutationSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json({ error: "A valid deal is required." }, { status: 400 });
    }
    const authorized = await authorizeDealReference(supabase, organization.id, parsedBody.data.deal_id);
    if (!authorized) return NextResponse.json({ error: "Deal unavailable." }, { status: 404 });
    const limited = await enforceRateLimitOrRespond(identity.id, "analyze_single");
    if (limited) return limited;

    const snapshot = await getOrganizationUsageSnapshot(supabase, organization.id);
    if (!snapshot.available || !snapshot.plan || !resolveStandardAnalysisAccess(snapshot.plan.planCode).providerExecutionAllowed) {
      return NextResponse.json(
        { error: "Standard Analysis access could not be verified." },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (!await isAnalysisRuntimeSchemaReady(supabase)) {
      return NextResponse.json(
        { error: "Analysis setup is pending. Try again after the workspace update is applied.", code: "MIGRATION_REQUIRED" },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const result = await analyzeAuthorizedDeal(supabase, organization.id, parsedBody.data.deal_id);
    if (result.status === "not_found") return NextResponse.json({ error: "Deal unavailable." }, { status: 404 });
    if (result.status === "processing") {
      return NextResponse.json({ status: "processing", message: "Analysis is already in progress." }, { status: 409 });
    }
    if (result.status === "usage_pending") {
      return NextResponse.json({
        status: "usage_pending",
        message: "Analysis was saved, but its usage record is still finalizing. Retry this analysis action to reconcile it without another AI call.",
      }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
    }
    if (result.status === "quota_exceeded") {
      return NextResponse.json(
        { status: "quota_exceeded", error: "This workspace has reached its AI Analysis allowance." },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (result.status === "failed") {
      const status = result.code === "SOURCE_TOO_LONG" || result.code === "INSUFFICIENT_SOURCE" ? 422 : 503;
      return NextResponse.json({
        status: "failed",
        code: result.code,
        error: "We couldn't analyze this deal right now. Please try again.",
      }, { status });
    }
    return NextResponse.json({
      status: "completed",
      fresh: result.fresh,
      ...(result.fresh ? { usage: result.usage } : {}),
    });
  } catch {
    return NextResponse.json({ error: "We couldn't analyze this deal right now. Please try again." }, { status: 500 });
  }
}
