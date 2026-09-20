import { type NextRequest, NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";
import { applySecurityHeaders } from "@/lib/security/headers";
import { hasOversizedQueryString } from "@/lib/security/origin";

export async function proxy(request: NextRequest) {
  if (hasOversizedQueryString(request.nextUrl)) {
    return applySecurityHeaders(
      NextResponse.json({ error: "The request URL is too long." }, { status: 414 }),
      request.nextUrl.pathname,
      request.nextUrl.protocol,
    );
  }
  const response = await updateSession(request);
  return applySecurityHeaders(response, request.nextUrl.pathname, request.nextUrl.protocol);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|lostdeal-favicon-v2.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
