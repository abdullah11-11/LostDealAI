import { NextResponse } from "next/server";
import { z } from "zod";

import { analyzeAuthorizedDeepDeal, isDeepAnalysisSchemaReady } from "@/lib/ai/deep-analysis-service";
import { resolveDeepAnalysisAccess } from "@/lib/billing/analysis-access";
import { getOrganizationUsageSnapshot } from "@/lib/billing/usage";
import { authorizeDealReference } from "@/lib/security/authorization";
import { mutationIssueResponse, validateMutationRequest } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";

const DeepAnalysisRequestSchema = z.object({
  deal_id: z.string().uuid(),
  operation_id: z.string().uuid(),
  rerun: z.boolean().optional().default(false),
}).strict();

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const authorization = await getAuthorizedRouteContext();
  if (authorization.response) return authorization.response;
  const { supabase, identity, organization } = authorization.context;

  const requestIssue = validateMutationRequest(request, "json");
  if (requestIssue) return mutationIssueResponse(requestIssue);
  const parsedBody = DeepAnalysisRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) return noStoreJson({ error: "A valid Deep Analysis request is required." }, 400);

  const authorized = await authorizeDealReference(supabase, organization.id, parsedBody.data.deal_id);
  if (!authorized) return noStoreJson({ error: "Deal unavailable." }, 404);
  const limited = await enforceRateLimitOrRespond(identity.id, "analyze_deep");
  if (limited) return limited;

  const snapshot = await getOrganizationUsageSnapshot(supabase, organization.id);
  if (!snapshot.available || !snapshot.plan) {
    return noStoreJson({ error: "Deep Analysis access could not be verified. Try again later." }, 503);
  }
  const access = resolveDeepAnalysisAccess(
    snapshot.plan.planCode,
    snapshot.subscriptionStatus,
    snapshot.mode,
  );
  if (!access.providerExecutionAllowed) {
    const error = access.state === "LOCKED"
      ? "Deep Recovery Analysis is a Pro feature. Standard Analysis remains available."
      : "Deep Recovery Analysis will be available when verified Pro billing launches.";
    return noStoreJson({ error, code: access.state }, 403);
  }
  if (!await isDeepAnalysisSchemaReady(supabase)) {
    return noStoreJson({
      error: "Deep Recovery Analysis setup is pending. Standard Analysis remains available.",
      code: "MIGRATION_REQUIRED",
    }, 503);
  }

  const result = await analyzeAuthorizedDeepDeal(
    supabase,
    organization.id,
    parsedBody.data.deal_id,
    parsedBody.data.operation_id,
    parsedBody.data.rerun,
  );
  if (result.status === "not_found") return noStoreJson({ error: "Deal unavailable." }, 404);
  if (result.status === "processing") {
    return noStoreJson({ status: "processing", message: "Deep Analysis is already in progress." }, 409);
  }
  if (result.status === "usage_pending") {
    return noStoreJson({
      status: "usage_pending",
      message: "Deep Analysis was saved, but its usage record is still finalizing. Retry this action to reconcile it without another AI call.",
    }, 202);
  }
  if (result.status === "quota_exceeded") {
    return noStoreJson({
      status: "quota_exceeded",
      error: "This workspace has reached its AI Analysis allowance.",
    }, 403);
  }
  if (result.status === "failed") {
    const status = result.code === "SOURCE_TOO_LONG" || result.code === "INSUFFICIENT_SOURCE" ? 422 : 503;
    return noStoreJson({
      status: "failed",
      code: result.code,
      error: "We couldn't complete Deep Recovery Analysis right now. Please try again.",
    }, status);
  }
  return noStoreJson({
    status: "completed",
    fresh: result.fresh,
    ...(result.fresh ? { usage: result.usage } : {}),
  });
}
