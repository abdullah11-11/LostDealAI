import type { Metadata } from "next";

import { PasswordRecoveryScreen } from "@/components/password-recovery-screen";
import { redirectAuthenticatedUser } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Forgot password" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  await redirectAuthenticatedUser();
  return <PasswordRecoveryScreen mode="forgot" />;
}
