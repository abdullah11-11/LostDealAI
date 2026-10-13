import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "node:fs";

export const fixtureSecret = "prompt17-fixture-authority";
export const orgA = "11111111-1111-4111-8111-111111111111";
export const orgB = "22222222-2222-4222-8222-222222222222";
export const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const migration17 = "20261005185926_prompt17a_atomic_operations_and_authorization.sql";

/** Genuine isolated PostgreSQL engine; no live credentials, users or provider calls. */
export async function postgresFixture() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema extensions;" +
    "create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);" +
    "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
  for (const file of readdirSync(new URL("../../supabase/migrations", import.meta.url)).filter(f => f.endsWith(".sql")).sort()) {
    if (file === migration17) {
      await db.exec("create function public.rls_auto_enable() returns event_trigger language plpgsql as $$ begin end $$;");
    }
    await db.exec(readFileSync(new URL("../../supabase/migrations/" + file, import.meta.url), "utf8"));
  }
  // Translate only the test authority after applying the unmodified migrations.
  // Preserve membership checks and every production RPC/transaction body.
  await db.exec("create or replace function private.assert_analysis_runtime_authority(target_authority_secret text,target_organization_id uuid) " +
    "returns void language plpgsql security definer set search_path='' as $$ begin " +
    "if target_authority_secret is distinct from 'prompt17-fixture-authority' then raise exception 'ANALYSIS_AUTHORITY_INVALID' using errcode='42501'; end if;" +
    "if not private.is_org_member(target_organization_id) then raise exception 'ANALYSIS_ORGANIZATION_UNAUTHORIZED' using errcode='42501'; end if; end $$;");
  await db.exec("insert into auth.users(id,email) values('" + userA + "','a@fixture.test'),('" + userB + "','b@fixture.test');" +
    "insert into public.organizations(id,name,created_by) values('" + orgA + "','Fixture A','" + userA + "'),('" + orgB + "','Fixture B','" + userB + "');" +
    "insert into public.organization_members(organization_id,user_id,role) values('" + orgA + "','" + userA + "','owner'),('" + orgB + "','" + userB + "','owner');" +
    "update public.organization_subscriptions set plan_code='PRO',subscription_status='active',current_period_start=date_trunc('month',clock_timestamp()),current_period_end=date_trunc('month',clock_timestamp())+interval '1 month';" +
    "set role authenticated; set request.jwt.claim.sub='" + userA + "';");
  return db;
}
