"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

/** Creates the browser client that future interactive components can reuse. */
export function createClient() {
  const { url, publishableKey } = getSupabasePublicEnvironment();

  return createBrowserClient(url, publishableKey);
}
