-- LostDeal AI V1 — Prompt 12 read-only security checks.
-- Run after 20260830000000_prompt12_deal_delete.sql.

-- Expected: six rows, all rowsecurity = true.
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_catalog.pg_class as c
join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'organizations', 'organization_members',
    'uploads', 'deals', 'deal_analyses'
  )
order by c.relname;

-- Expected: zero rows. Anonymous has no private app-table privileges.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
  and table_name in (
    'profiles', 'organizations', 'organization_members',
    'uploads', 'deals', 'deal_analyses'
  )
order by table_name, privilege_type;

-- Expected: exactly deals_delete_org_member, using private.is_org_member.
select policyname, cmd, roles, qual
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename = 'deals'
  and cmd = 'DELETE';

-- Expected: authenticated has DELETE only on public.deals.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
  and privilege_type = 'DELETE'
order by table_name;

-- Expected: confdeltype = c (CASCADE) for deal analyses -> deals.
select conname, confdeltype
from pg_catalog.pg_constraint
where conname = 'deal_analyses_deal_belongs_to_organization';

-- Expected: no anon/public execute grants for private authorization helpers.
select routine_schema, routine_name, grantee, privilege_type
from information_schema.role_routine_grants
where routine_schema = 'private'
  and grantee in ('PUBLIC', 'anon')
order by routine_name, grantee;
