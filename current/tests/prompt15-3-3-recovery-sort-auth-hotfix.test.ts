import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const root = process.cwd();
const source = (path: string) => readFileSync(`${root}/${path}`, "utf8");
const migrationName = "20260906080228_prompt15_3_3_recovery_sort_rpc_auth_hotfix.sql";
const migration = source(`supabase/migrations/${migrationName}`);
const previousMigration = source("supabase/migrations/20260905070000_prompt15_3_1_runtime_hardening.sql");

function sortFunctionDefinition(sql: string): string {
  const start = sql.search(/create (?:or replace )?function public\.list_deal_ids_by_recovery_score\(/i);
  assert.notEqual(start, -1, "sort function definition start");
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, "sort function definition end");
  return sql.slice(start, end + "\n$$;".length);
}

const functionDefinition = sortFunctionDefinition(migration);
const previousFunctionDefinition = sortFunctionDefinition(previousMigration);

type FixtureRow = {
  id: string;
  customer: string;
  externalId: string;
  analysisStatus: "pending" | "processing" | "completed" | "failed";
  priority: "HIGH" | "MEDIUM" | "LOW" | null;
  reason: "PRICE" | "TIMING" | "NO_RESPONSE" | "OTHER" | null;
  service: string;
  salesperson: string;
  score: number | null;
};

type FixtureFilters = {
  search?: string;
  analysisStatus?: FixtureRow["analysisStatus"];
  priority?: Exclude<FixtureRow["priority"], null>;
  reason?: Exclude<FixtureRow["reason"], null>;
  service?: string;
  salesperson?: string;
  ascending?: boolean;
  offset?: number;
  limit?: number;
};

const rows: FixtureRow[] = [
  { id: "0001", customer: "Orchard Alpha", externalId: "LD-A", analysisStatus: "completed", priority: "HIGH", reason: "PRICE", service: "HVAC", salesperson: "Avery", score: 90 },
  { id: "0002", customer: "Orchard Beta", externalId: "LD-B", analysisStatus: "processing", priority: "HIGH", reason: "TIMING", service: "HVAC", salesperson: "Blake", score: 90 },
  { id: "0003", customer: "Maple House", externalId: "LD-C", analysisStatus: "completed", priority: "MEDIUM", reason: "TIMING", service: "Roofing", salesperson: "Avery", score: 55 },
  { id: "0004", customer: "Cedar Works", externalId: "LD-D", analysisStatus: "failed", priority: "LOW", reason: "NO_RESPONSE", service: "Plumbing", salesperson: "Casey", score: 10 },
  { id: "0005", customer: "Null Solar", externalId: "LD-E", analysisStatus: "pending", priority: null, reason: null, service: "Solar", salesperson: "Dana", score: null },
  { id: "0006", customer: "Null HVAC", externalId: "LD-F", analysisStatus: "completed", priority: null, reason: "OTHER", service: "HVAC", salesperson: "Avery", score: null },
];

function referenceSort(filters: FixtureFilters = {}): FixtureRow[] {
  const search = filters.search?.toLowerCase();
  return rows
    .filter((row) => !search || row.customer.toLowerCase().includes(search) || row.externalId.toLowerCase().includes(search))
    .filter((row) => !filters.analysisStatus || row.analysisStatus === filters.analysisStatus)
    .filter((row) => !filters.priority || row.priority === filters.priority)
    .filter((row) => !filters.reason || row.reason === filters.reason)
    .filter((row) => !filters.service || row.service === filters.service)
    .filter((row) => !filters.salesperson || row.salesperson === filters.salesperson)
    .sort((left, right) => {
      if (left.score === null && right.score !== null) return 1;
      if (left.score !== null && right.score === null) return -1;
      if (left.score !== right.score) {
        const direction = filters.ascending ? 1 : -1;
        return ((left.score ?? 0) - (right.score ?? 0)) * direction;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 100));
}

const ids = (result: FixtureRow[]) => result.map((row) => row.id);

test("Prompt 15.3.3 adds exactly one forward migration and preserves all prior migrations byte-for-byte", () => {
  const hashes: Record<string, string> = {
    "20260810000000_initial_lostdeal_schema.sql": "6b2f0cefa368d51338f314fe24d6afd9fa600a500f508cc8d7ad171805c80ecb",
    "20260830000000_prompt12_deal_delete.sql": "75e580cc49736f0880dd305ca901014c556560f46af5f6cfc05798021866a095",
    "20260901000000_prompt15_commercial_foundation.sql": "1ddbc82204a0340588a8bf9925962c2b7ce3cf6ccf46e875304cf88bc1a8efd8",
    "20260902000000_prompt15_1_plan_limits.sql": "ab6252fa9ec2b20793e8969829397b1bac2e1320af6f7fddf41a9100dd7fd12d",
    "20260902010000_prompt15_2_auto_convert_limit.sql": "014c25c127d32b04c31e9c6980681c2857ba9c318ffcf874ca333c0f821c71ad",
    "20260902020000_prompt15_3_deep_analysis.sql": "afb27ade8242ef6a0be23c33f210c65e95c7377cac1f031a7b90772dfe27dc0e",
    "20260905070000_prompt15_3_1_runtime_hardening.sql": "0b4568fd9156bb90b2719eedce8fadf425f55faa2542c58ceaadc9376a802387",
    "20260905083511_prompt15_3_2_usage_reservation_runtime_hotfix.sql": "7a07c0c262c5b1c61ff9ee6e89b74df26e50575b2694303a46741768e5260ba5",
  };
  for (const [file, expected] of Object.entries(hashes)) {
    assert.equal(createHash("sha256").update(source(`supabase/migrations/${file}`)).digest("hex"), expected, file);
  }
  const migrations = readdirSync(`${root}/supabase/migrations`).filter((file) => file.endsWith(".sql")).sort();
  assert.deepEqual(migrations, [
    ...Object.keys(hashes),
    migrationName,
    "20260908055554_prompt15_3_5_deep_semantic_diagnostic_hardening.sql",
    "20260916095842_prompt16_paddle_billing_foundation.sql", "20260917144440_prompt16_authority_dual_verifier.sql", "20260921064300_prompt16_paddle_simulator_event_id_compat.sql", "20260921073247_prompt16_authority_rotation_finalize.sql", "20260922083319_prompt16_billing_operation_rejection_recovery.sql", "20261005185926_prompt17a_atomic_operations_and_authorization.sql",
  ]);
});

test("the sort RPC keeps one exact PostgREST signature and return shape", () => {
  assert.equal((migration.match(/create or replace function public\.list_deal_ids_by_recovery_score\(/gi) ?? []).length, 1);
  assert.doesNotMatch(migration, /drop function/i);
  assert.match(functionDefinition, /target_organization_id uuid,\s*target_search text,\s*target_analysis_status text,\s*target_priority text,\s*target_reason text,\s*target_service text,\s*target_salesperson text,\s*target_ascending boolean,\s*target_offset integer,\s*target_limit integer/i);
  assert.match(functionDefinition, /returns table \(deal_id uuid\)/i);
});

test("the forward replacement changes only CREATE OR REPLACE and SECURITY DEFINER", () => {
  const expected = previousFunctionDefinition
    .replace(/^create function/i, "create or replace function")
    .replace(/security invoker/i, "security definer");
  assert.equal(functionDefinition, expected);
});

test("SECURITY DEFINER uses an empty search_path and authorizes membership before data access", () => {
  assert.match(functionDefinition, /language plpgsql\s+stable\s+security definer\s+set search_path = ''/i);
  const membership = functionDefinition.indexOf("private.is_org_member(target_organization_id)");
  const query = functionDefinition.indexOf("return query");
  assert.ok(membership >= 0 && query > membership);
  assert.match(functionDefinition, /DEAL_LIST_ORGANIZATION_UNAUTHORIZED[\s\S]*errcode = '42501'/);
});

test("least-privilege grants deny anonymous execution without exposing the private schema", () => {
  const signature = /public\.list_deal_ids_by_recovery_score\(uuid, text, text, text, text, text, text, boolean, integer, integer\)/;
  assert.match(migration, new RegExp(`revoke all on function ${signature.source}[\\s\\S]*from public, anon, authenticated;`, "i"));
  assert.match(migration, new RegExp(`grant execute on function ${signature.source}[\\s\\S]*to authenticated;`, "i"));
  assert.doesNotMatch(migration, /grant usage on schema private|grant .* on (?:all functions in schema )?private/i);
});

test("the definer body is fully qualified and contains no dynamic SQL or service-role path", () => {
  assert.match(functionDefinition, /private\.is_org_member/);
  assert.match(functionDefinition, /from public\.deals as deal/);
  assert.match(functionDefinition, /left join public\.deal_analyses as analysis/);
  assert.doesNotMatch(functionDefinition, /\bexecute\b|format\s*\(|service_role/i);
});

test("Recovery Score High to Low is global and deterministic", () => {
  assert.deepEqual(ids(referenceSort()), ["0001", "0002", "0003", "0004", "0005", "0006"]);
  assert.match(functionDefinition, /case when not target_ascending then filtered\.recovery_score end desc nulls last/);
});

test("Recovery Score Low to High is global and deterministic", () => {
  assert.deepEqual(ids(referenceSort({ ascending: true })), ["0004", "0003", "0001", "0002", "0005", "0006"]);
  assert.match(functionDefinition, /case when target_ascending then filtered\.recovery_score end asc nulls last/);
});

test("null Recovery Scores remain last in both directions", () => {
  assert.deepEqual(ids(referenceSort()).slice(-2), ["0005", "0006"]);
  assert.deepEqual(ids(referenceSort({ ascending: true })).slice(-2), ["0005", "0006"]);
});

test("equal Recovery Scores use ascending deal ID as the stable tie break", () => {
  assert.deepEqual(ids(referenceSort()).slice(0, 2), ["0001", "0002"]);
  assert.match(functionDefinition, /filtered\.id asc\s+offset target_offset\s+limit target_limit/);
});

test("search remains compatible with Recovery Score ordering", () => {
  assert.deepEqual(ids(referenceSort({ search: "orchard" })), ["0001", "0002"]);
  assert.match(functionDefinition, /position\(lower\(target_search\) in lower\(coalesce\(deal\.customer_name, ''\)\)\)/);
  assert.match(functionDefinition, /position\(lower\(target_search\) in lower\(coalesce\(deal\.external_deal_id, ''\)\)\)/);
});

test("analysis status remains compatible with Recovery Score ordering", () => {
  assert.deepEqual(ids(referenceSort({ analysisStatus: "completed" })), ["0001", "0003", "0006"]);
  assert.match(functionDefinition, /target_analysis_status is null or deal\.analysis_status = target_analysis_status/);
});

test("priority remains compatible with Recovery Score ordering", () => {
  assert.deepEqual(ids(referenceSort({ priority: "HIGH" })), ["0001", "0002"]);
  assert.match(functionDefinition, /target_priority is null or analysis\.recovery_priority = target_priority/);
});

test("lost reason remains compatible with Recovery Score ordering", () => {
  assert.deepEqual(ids(referenceSort({ reason: "TIMING" })), ["0002", "0003"]);
  assert.match(functionDefinition, /target_reason is null or analysis\.lost_reason = target_reason/);
});

test("service remains compatible with Recovery Score ordering", () => {
  assert.deepEqual(ids(referenceSort({ service: "HVAC" })), ["0001", "0002", "0006"]);
  assert.match(functionDefinition, /target_service is null or deal\.service_type = target_service/);
});

test("salesperson remains compatible with Recovery Score ordering", () => {
  assert.deepEqual(ids(referenceSort({ salesperson: "Avery" })), ["0001", "0003", "0006"]);
  assert.match(functionDefinition, /target_salesperson is null or deal\.salesperson = target_salesperson/);
});

test("pagination is applied after database-global Recovery Score ordering", () => {
  const first = ids(referenceSort({ offset: 0, limit: 2 }));
  const second = ids(referenceSort({ offset: 2, limit: 2 }));
  assert.deepEqual([...first, ...second], ["0001", "0002", "0003", "0004"]);
  assert.ok(functionDefinition.indexOf("order by") < functionDefinition.indexOf("offset target_offset"));
});

test("the post-migration SQL probe executes same-org sort and rejects cross-org access", () => {
  const probe = source("supabase/tests/prompt15_3_3_recovery_sort_auth_checks.sql");
  assert.match(probe, /set local role authenticated/);
  assert.match(probe, /HIGH_TO_LOW_ORDER_INVALID/);
  assert.match(probe, /LOW_TO_HIGH_ORDER_INVALID/);
  assert.match(probe, /GLOBAL_PAGINATION_INVALID/);
  assert.match(probe, /CROSS_ORGANIZATION_ACCESS_ALLOWED/);
  assert.match(probe, /DEAL_LIST_ORGANIZATION_UNAUTHORIZED/);
  assert.match(probe, /has_function_privilege\('anon'/);
  assert.match(probe, /has_schema_privilege\('authenticated', 'private', 'usage'\)/);
  assert.match(probe, /rollback;/);
});

test("PGRST118 relationship ordering stays absent from the Deals query path", () => {
  const server = source("lib/deals/server.ts");
  assert.match(server, /rpc\(\s*["']list_deal_ids_by_recovery_score["']/);
  assert.doesNotMatch(server, /\.order\(`?deal_analyses\(/);
  assert.doesNotMatch(migration, /deal_analyses\(recovery_score\)/);
});

test("sorting cannot call OpenAI, recalculate scores, or change the Prompt 8 formula", () => {
  const scoring = source("lib/scoring/recovery-score.ts");
  const constants = source("lib/scoring/constants.ts");
  assert.match(constants, /RECOVERY_SCORING_VERSION = "1\.0"/);
  assert.doesNotMatch(scoring, /openai/i);
  assert.doesNotMatch(migration, /openai|gpt-5|insert into|update public|delete from|recovery_score\s*=/i);
  assert.doesNotMatch(functionDefinition, /persist|scoreAuthorized|runOpenAI/i);
});

test("working Standard, Deep, usage, and model configuration remain outside the hotfix", () => {
  const config = source("lib/ai/config.ts");
  const standard = source("lib/ai/deal-analysis-service.ts");
  const deep = source("lib/ai/deep-analysis-service.ts");
  const autoConvert = source("lib/csv/auto-convert-runner.ts");
  assert.match(config, /TESTED_COST_SAFE_ANALYSIS_FALLBACK = "gpt-5\.6-terra"/);
  assert.match(standard, /"AI_ANALYSES",\s*1/);
  assert.match(deep, /"AI_ANALYSES",\s*1/);
  assert.match(autoConvert, /OPENAI_AUTO_CONVERT_MODEL/);
  assert.doesNotMatch(migration, /AI_ANALYSES|reserve_organization_usage|finalize_analysis_usage|analysis_mode/i);
});
