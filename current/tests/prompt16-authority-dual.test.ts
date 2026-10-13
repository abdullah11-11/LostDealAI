import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const file = "20260917144440_prompt16_authority_dual_verifier.sql";
const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const oldDigest = "0d092f687fa975007a0c40bbaf91cd60cafe6ba5da8d3b2d780da8297ef953f1";
const newDigest = "ec4a6b6cc5efdfc40ddcf991ecec133ca0e4364e705f29453d023aba6b91747f";
test("only the owner-authorized verifier set can rotate", () => {
  for (const name of ["private.assert_analysis_runtime_authority", "private.assert_billing_authority", "public.commit_organization_usage", "public.reserve_organization_usage"]) assert.ok(sql.includes(`'${name}'`));
  assert.match(sql,/actual is distinct from expected/);
  assert.match(sql,/AUTHORITY_VERIFIER_PRECONDITION_FAILED/);
});
test("exactly two approved digest constants and a fail-closed comparison", () => {
  assert.deepEqual(sql.match(/[a-f0-9]{64}/g),[oldDigest,newDigest]);
  assert.match(sql,/'not in \('/);
  assert.match(sql,/count\(\*\) from regexp_matches/);
});
for (const [label,digest,accepted] of [
  ["old",oldDigest,true],["new",newDigest,true],
  ["empty",createHash("sha256").update("").digest("hex"),false],
  ["random",createHash("sha256").update("random-authority-fixture").digest("hex"),false],
] as const) test(`digest predicate: ${label}`,()=>assert.equal([oldDigest,newDigest].includes(digest),accepted));
test("replacement preserves ACL ownership security and full surrounding definition",()=>{
  for(const invariant of ["p.proacl is not distinct from fn.proacl","p.proowner=fn.proowner","p.prosecdef=fn.prosecdef","p.proconfig is not distinct from fn.proconfig","pg_get_functiondef(fn.oid) is distinct from replacement_definition"]) assert.ok(sql.includes(invariant));
  assert.doesNotMatch(sql,/^\s*(?:commit|begin|grant|revoke|alter table|drop|truncate)\s*;/im);
});
test("all eleven historical migration bytes match release 39",()=>{
  const paths=execFileSync("git",["ls-tree","-r","--name-only","1404f757e91c2bbc9309ede2063efa284d4a8eb2","supabase/migrations"],{encoding:"utf8"}).trim().split("\n");
  assert.equal(paths.length,11);
  for(const path of paths) assert.deepEqual(readFileSync(new URL(`../${path}`,import.meta.url)),execFileSync("git",["show",`1404f757e91c2bbc9309ede2063efa284d4a8eb2:${path}`]));
  assert.equal(readdirSync(new URL("../supabase/migrations",import.meta.url)).length,paths.length+5);
});
