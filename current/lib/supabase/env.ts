export type SupabasePublicEnvironment = {
  url: string;
  publishableKey: string;
};

/**
 * Reads the two client-safe Supabase settings without exposing their values in
 * error messages. Direct property access also allows the browser build to
 * replace NEXT_PUBLIC variables correctly.
 */
export function getSupabasePublicEnvironment(): SupabasePublicEnvironment {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }

  if (!publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured.",
    );
  }

  return { url, publishableKey };
}
