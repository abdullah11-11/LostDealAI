import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth-screen";
import { redirectAuthenticatedUser } from "@/lib/auth/server";
import { getSafeNextPath } from "@/lib/auth/validation";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  await redirectAuthenticatedUser();
  const { next, reset } = await searchParams;
  return <AuthScreen mode="login" nextPath={getSafeNextPath(next)} resetComplete={reset === "success"} />;
}
