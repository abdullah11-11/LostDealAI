import { createClient } from "@supabase/supabase-js";

const EXPECTED_TABLES = [
  "profiles",
  "organizations",
  "organization_members",
  "uploads",
  "deals",
  "deal_analyses",
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

console.log(`NEXT_PUBLIC_SUPABASE_URL: ${url ? "configured" : "missing"}`);
console.log(
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${publishableKey ? "configured" : "missing"}`,
);

if (!url || !publishableKey) {
  process.exitCode = 1;
} else {
  await verifyConnection(url, publishableKey);
}

async function verifyConnection(projectUrl, projectPublishableKey) {
  const supabase = createClient(projectUrl, projectPublishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const results = [];

  for (const table of EXPECTED_TABLES) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select("id")
        .limit(1);

      if (!error) {
        results.push({
          table,
          status:
            data.length === 0
              ? "present_no_rows"
              : "unexpected_accessible_rows",
        });
      } else if (error.code === "42501") {
        results.push({ table, status: "present_access_blocked" });
      } else if (error.code === "42P01" || error.code === "PGRST205") {
        results.push({ table, status: "missing" });
      } else {
        results.push({ table, status: "not_confirmed" });
      }
    } catch {
      results.push({ table, status: "not_confirmed" });
    }
  }

  const reachable = results.some(
    ({ status }) =>
      status === "present_no_rows" ||
      status === "present_access_blocked" ||
      status === "unexpected_accessible_rows",
  );
  const confirmed = results.filter(({ status }) =>
    [
      "present_no_rows",
      "present_access_blocked",
      "unexpected_accessible_rows",
    ].includes(status),
  ).length;
  const anonymousRowsAccessible = results.some(
    ({ status }) => status === "unexpected_accessible_rows",
  );

  console.log(`SUPABASE_PROJECT_REACHABLE: ${reachable ? "yes" : "no"}`);
  results.forEach(({ table, status }) => {
    console.log(`TABLE ${table}: ${status}`);
  });
  console.log(
    `REMOTE_TABLES_CONFIRMED: ${
      confirmed === EXPECTED_TABLES.length
        ? "pass"
        : confirmed > 0
          ? "partially_confirmed"
          : "not_testable"
    }`,
  );
  console.log(
    `REMOTE_RLS_BEHAVIOR: ${
      anonymousRowsAccessible ? "fail" : confirmed > 0 ? "pass" : "not_testable"
    }`,
  );

  if (!reachable || confirmed !== EXPECTED_TABLES.length || anonymousRowsAccessible) {
    process.exitCode = 1;
  }
}
