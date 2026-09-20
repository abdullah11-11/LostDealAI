import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { getActiveOrganization, getVerifiedIdentity } from "@/lib/auth/server";
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_COOKIE_VALUE,
  PASSWORD_RECOVERY_MAX_AGE_SECONDS,
} from "@/lib/auth/password-recovery";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const requestedType = request.nextUrl.searchParams.get("type");
  const requestedNext = request.nextUrl.searchParams.get("next");
  const recoveryReturn = requestedType === "recovery" && requestedNext === "/reset-password";

  if (
    (!code && !tokenHash)
    || !requestedType
    || !EMAIL_OTP_TYPES.has(requestedType as EmailOtpType)
    || (code && !recoveryReturn)
  ) {
    return NextResponse.redirect(new URL("/auth/error", request.url));
  }

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
      token_hash: tokenHash as string,
      type: requestedType as EmailOtpType,
    });

  if (error) {
    const destination = requestedType === "recovery"
      ? "/reset-password?error=invalid"
      : "/auth/error";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  const identity = await getVerifiedIdentity(supabase);
  if (!identity) {
    const destination = requestedType === "recovery"
      ? "/reset-password?error=invalid"
      : "/auth/error";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  if (requestedType === "recovery") {
    const response = NextResponse.redirect(new URL("/reset-password", request.url));
    response.cookies.set(PASSWORD_RECOVERY_COOKIE, PASSWORD_RECOVERY_COOKIE_VALUE, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "strict",
      path: "/",
      maxAge: PASSWORD_RECOVERY_MAX_AGE_SECONDS,
    });
    return response;
  }

  try {
    const organization = await getActiveOrganization(supabase, identity.id);
    return NextResponse.redirect(new URL(organization ? "/dashboard" : "/onboarding", request.url));
  } catch {
    return NextResponse.redirect(new URL("/auth/error", request.url));
  }
}
