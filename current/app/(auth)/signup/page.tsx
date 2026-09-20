import { getSafeNextPath } from "@/lib/auth/validation";
import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth-screen";
import { redirectAuthenticatedUser } from "@/lib/auth/server";

export const metadata: Metadata = { title: "Sign up" };
export const dynamic = "force-dynamic";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  await redirectAuthenticatedUser();
  return <AuthScreen mode="signup" nextPath={getSafeNextPath(next)} />;
}
