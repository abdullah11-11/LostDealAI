import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

/** Refreshes auth cookies and forwards the original app path to Server Components. */
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(
    "x-lostdeal-request-path",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const { url, publishableKey } = getSupabasePublicEnvironment();
  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // getClaims verifies the JWT and refreshes it when necessary. Never replace
  // this with getSession for server-side authorization.
  await supabase.auth.getClaims();
  return response;
}
