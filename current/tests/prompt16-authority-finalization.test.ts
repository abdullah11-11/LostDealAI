import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const baselineCommit = "4e4d559d874374c797392ff81afe9e5dc1bca0ba";
const migrationName = "20260921073247_prompt16_authority_rotation_finalize.sql";
const laterMigrations = ["20260922083319_prompt16_billing_operation_rejection_recovery.sql", "20261005185926_prompt17a_atomic_operations_and_authorization.sql"];
const oldDigest = "0d092f687fa975007a0c40bbaf91cd60cafe6ba5da8d3b2d780da8297ef953f1";
const newDigest = "ec4a6b6cc5efdfc40ddcf991ecec133ca0e4364e705f29453d023aba6b91747f";
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = source(`supabase/migrations/${migrationName}`);
const sqlChecks = source("supabase/tests/prompt16_authority_finalization_checks.sql");
const functions = [
  "private.assert_analysis_runtime_authority",
  "private.assert_billing_authority",
  "public.commit_organization_usage",
  "public.reserve_organization_usage",
] as const;

test("finalization is restricted to the four proven direct verifier functions", () => {
  for (const name of functions) assert.ok(migration.includes(`'${name}'`), name);
  assert.match(migration, /actual is distinct from expected/);
  assert.match(migration, /AUTHORITY_VERIFIER_SET_CHANGED/);
  assert.match(migration, /OLD_AUTHORITY_DIGEST_STILL_ACTIVE/);
});

test("the old and new digests appear once each as verifier metadata only", () => {
  assert.deepEqual(migration.match(/[a-f0-9]{64}/g), [oldDigest, newDigest]);
  assert.equal(migration.includes("BILLING_USAGE_AUTHORITY_SECRET="), false);
  assert.doesNotMatch(migration, /[a-f0-9]{64}\s*\/\//);
});

test("one exact dual predicate becomes one new-only fail-closed predicate", () => {
  assert.match(migration, /dual_comparison := 'not in \('/);
  assert.match(migration, /final_comparison := 'is distinct from '/);
  assert.match(migration, /length\(original_definition\) - length\(replace\(original_definition, dual_comparison, ''\)\)/);
  assert.match(migration, /replacement_definition := replace\(original_definition, dual_comparison, final_comparison\)/);
});

test("function ownership ACL security mode configuration and surrounding source are invariant", () => {
  for (const invariant of [
    "p.proacl is not distinct from fn.proacl",
    "p.proowner = fn.proowner",
    "p.prosecdef = fn.prosecdef",
    "p.proconfig is not distinct from fn.proconfig",
    "pg_get_functiondef(fn.oid) is distinct from replacement_definition",
  ]) assert.ok(migration.includes(invariant), invariant);
  assert.match(migration, /'search_path=""' = any\(fn\.proconfig\)/);
});

test("migration cannot alter grants RLS tables usage or billing data", () => {
  assert.doesNotMatch(migration, /^\s*(?:commit|grant|revoke|alter table|create table|drop|truncate|insert|update|delete)\b/im);
  assert.doesNotMatch(migration, /organization_usage_events|organization_subscriptions|billing_event_receipts|service_role/i);
});

test("rollback SQL proof covers final catalog state and all invalid authorities", () => {
  assert.match(sqlChecks, /^begin;/m);
  assert.match(sqlChecks, /4_FINAL_VERIFIERS_12_INVALID_AUTHORITIES_AND_5_CLIENT_BOUNDARIES_PASS/);
  for (const value of ["random-authority-fixture", "''", "null::text"]) assert.ok(sqlChecks.includes(value));
  assert.match(sqlChecks, /set local role authenticated/);
  assert.match(sqlChecks, /set local role anon/);
  assert.match(sqlChecks, /rollback;\s*$/);
});

test("simulator compatibility and Paddle HMAC code are untouched", () => {
  const paddle = source("supabase/functions/_shared/paddle.ts");
  assert.match(paddle, /\^\(\?:evt\|ntfsimevt\)_\[a-z0-9\]\{26\}\$/);
  assert.match(source("supabase/config.toml"), /\[functions\.paddle-webhook\]\nverify_jwt = false/);
  assert.doesNotMatch(migration, /Paddle-Signature|event_id|verify_jwt|paddle-webhook/i);
});

test("every release-41 migration remains byte-identical", () => {
  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", baselineCommit, "supabase/migrations"], { encoding: "utf8" }).trim().split("\n");
  assert.equal(paths.length, 13);
  for (const path of paths) {
    assert.deepEqual(readFileSync(new URL(`../${path}`, import.meta.url)), execFileSync("git", ["show", `${baselineCommit}:${path}`]), path);
  }
});

test("the final migration is the sole addition to release 41 history", () => {
  const baseline = execFileSync("git", ["ls-tree", "-r", "--name-only", baselineCommit, "supabase/migrations"], { encoding: "utf8" }).trim().split("\n");
  const current = readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((file) => file.endsWith(".sql")).sort();
  assert.deepEqual(current, [...baseline.map((path) => path.split("/").at(-1)!), migrationName, ...laterMigrations].sort());
});

test("the final digest is a SHA-256 verifier and no raw-secret fixture is embedded", () => {
  assert.equal(newDigest.length, 64);
  assert.equal(createHash("sha256").update("random-authority-fixture").digest("hex") === newDigest, false);
  assert.equal(createHash("sha256").update("").digest("hex") === newDigest, false);
});
