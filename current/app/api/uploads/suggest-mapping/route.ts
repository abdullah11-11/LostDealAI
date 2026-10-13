import { NextResponse } from "next/server";

import { suggestCsvMapping } from "@/lib/csv/ai-mapping";
import { runOpenAiMapping } from "@/lib/csv/ai-mapping-runner";
import { AiMappingRequestSchema } from "@/lib/csv/ai-mapping-schema";
import { releaseUnusedUsage, reserveOrganizationUsage, type UsageReservation } from "@/lib/billing/usage";
import { fingerprint, readOperation, saveOperation } from "@/lib/csv/operation-service";
import { CsvImportError } from "@/lib/csv/server";
import { mutationIssueResponse, validateMutationRequest } from "@/lib/security/origin";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";

export async function POST(request: Request) {
  const requestIssue = validateMutationRequest(request, "json");
  if (requestIssue) return mutationIssueResponse(requestIssue);
  const authorization = await getAuthorizedRouteContext();
  if (authorization.response) return authorization.response;
  const { supabase, identity, organization } = authorization.context;
  const limited = await enforceRateLimitOrRespond(identity.id, "upload_ai_mapping");
  if (limited) return limited;

  let reservation: UsageReservation | null = null;
  try {
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return NextResponse.json(
        { error: "A valid mapping operation is required." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const parsed = AiMappingRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "The AI mapping request is invalid." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const operationKey = "mapping:" + idempotencyKey;
    const hash = await fingerprint(null, parsed.data);
    const saved = await readOperation(supabase, organization.id, operationKey, hash);
    if (saved) return NextResponse.json(saved, { headers: { "Cache-Control": "private, no-store" } });
    reservation = await reserveOrganizationUsage(
      supabase,
      organization.id,
      "AI_MAPPING_REQUESTS",
      1,
      `mapping:${idempotencyKey}`,
    );
    if (!reservation.allowed) {
      await releaseUnusedUsage(supabase, organization.id, reservation);
      return NextResponse.json(
        { error: "This workspace has reached its AI Smart Mapping allowance." },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (!reservation.isNew) {
      return NextResponse.json(
        { error: "This mapping request is already being processed." },
        { status: 409, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (!reservation.available || !reservation.reservationToken) throw new CsvImportError("Usage metering is temporarily unavailable.", 503);
    const suggestions = await suggestCsvMapping(parsed.data, runOpenAiMapping);
    const result = await saveOperation(supabase, organization.id, operationKey, hash, "AI_MAPPING_REQUESTS", reservation, 1, { suggestions });
    return NextResponse.json(
      result,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (reservation?.isNew) await releaseUnusedUsage(supabase, organization.id, reservation);
    return NextResponse.json(
      { error: error instanceof CsvImportError ? error.message : "AI suggestions are unavailable right now. You can continue mapping manually." },
      { status: error instanceof CsvImportError ? error.status : 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
