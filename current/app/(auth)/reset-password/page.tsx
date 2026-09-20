import type { Metadata } from "next";
import { cookies } from "next/headers";

import { PasswordRecoveryScreen } from "@/components/password-recovery-screen";
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_COOKIE_VALUE,
} from "@/lib/auth/password-recovery";
import { getVerifiedIdentity } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Reset password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ error }, cookieStore, identity] = await Promise.all([
    searchParams,
    cookies(),
    getVerifiedIdentity(),
  ]);
  const recoveryValid = error !== "invalid"
    && cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value === PASSWORD_RECOVERY_COOKIE_VALUE
    && Boolean(identity);
  return <PasswordRecoveryScreen mode="reset" recoveryValid={recoveryValid} />;
}
