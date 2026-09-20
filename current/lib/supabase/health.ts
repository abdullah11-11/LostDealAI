import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type SupabaseHealthStatus =
  | "connected"
  | "configuration_error"
  | "connection_error";

export type SupabaseHealthResult = {
  status: SupabaseHealthStatus;
  anonymousAccess: "blocked" | "no_rows" | "unexpected_rows" | "not_testable";
};

/**
 * Performs one harmless, anonymous read without returning rows or raw errors.
 * PostgreSQL 42501 confirms that the API and table were reached while the
 * anonymous role was correctly denied by database grants.
 */
export async function checkSupabaseConnection(
  client: SupabaseClient,
): Promise<SupabaseHealthResult> {
  try {
    const { data, error } = await client
      .from("profiles")
      .select("id")
      .limit(1);

    if (!error) {
      return {
        status: "connected",
        anonymousAccess: data.length === 0 ? "no_rows" : "unexpected_rows",
      };
    }

    if (error.code === "42501") {
      return { status: "connected", anonymousAccess: "blocked" };
    }

    return { status: "connection_error", anonymousAccess: "not_testable" };
  } catch {
    return { status: "connection_error", anonymousAccess: "not_testable" };
  }
}
