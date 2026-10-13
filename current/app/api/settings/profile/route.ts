import { NextResponse } from "next/server";
import { ProfileUpdateSchema } from "@/lib/settings/profile";
import { getAuthorizedRouteContext } from "@/lib/security/route-auth";
import { validateMutationRequest, mutationIssueResponse } from "@/lib/security/origin";
import { readBoundedRequest, RequestBodyLimitError } from "@/lib/security/request-body";
import { enforceRateLimitOrRespond } from "@/lib/security/rate-limit";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  const issue = validateMutationRequest(request, "json");
  if (issue) return mutationIssueResponse(issue);
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(await readBoundedRequest(request, 1024))); }
  catch (error) { return json({ error: error instanceof RequestBodyLimitError ? "The request is too large." : "Enter a valid display name." }, error instanceof RequestBodyLimitError ? 413 : 400); }
  const parsed = ProfileUpdateSchema.safeParse(input);
  if (!parsed.success) return json({ error: "Use a display name between 1 and 100 characters." }, 400);
  const auth = await getAuthorizedRouteContext();
  if (auth.response) return auth.response;
  const { supabase, identity } = auth.context;
  const limited = await enforceRateLimitOrRespond(identity.id, "profile_update");
  if (limited) return limited;
  try {
    // Identity comes exclusively from fresh authentication; RLS also restricts this row/column.
    const { data, error } = await supabase.from("profiles").update({ full_name: parsed.data.fullName })
      .eq("id", identity.id).select("full_name").single();
    if (error || !data) return json({ error: "Your display name could not be saved. Try again shortly." }, 503);
    return json({ fullName: data.full_name });
  } catch { return json({ error: "Your display name could not be saved. Try again shortly." }, 503); }
}
