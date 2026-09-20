-- Run after 20260906080228_prompt15_3_3_recovery_sort_rpc_auth_hotfix.sql.
-- This privileged, read-only verification transaction impersonates an existing
-- authenticated member, executes both score directions, validates global
-- pagination, proves cross-organization denial, and rolls back session state.
begin;

do $catalog$
declare
  sort_function regprocedure :=
    'public.list_deal_ids_by_recovery_score(uuid,text,text,text,text,text,text,boolean,integer,integer)'::regprocedure;
begin
  if (
    select count(*) <> 1
    from pg_proc as procedure
    join pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'list_deal_ids_by_recovery_score'
  ) then
    raise exception 'PROMPT15_3_3_SORT_RPC_OVERLOAD_COUNT_INVALID';
  end if;

  if not (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig = array['search_path=""']
    from pg_proc as procedure
    where procedure.oid = sort_function
  ) then
    raise exception 'PROMPT15_3_3_SORT_RPC_SECURITY_INVALID';
  end if;

  if not has_function_privilege('authenticated', sort_function, 'execute')
    or has_function_privilege('anon', sort_function, 'execute') then
    raise exception 'PROMPT15_3_3_SORT_RPC_EXECUTE_PRIVILEGES_INVALID';
  end if;

  if has_schema_privilege('authenticated', 'private', 'usage')
    or has_schema_privilege('anon', 'private', 'usage') then
    raise exception 'PROMPT15_3_3_PRIVATE_SCHEMA_EXPOSED';
  end if;
end;
$catalog$;

select set_config(
  'prompt15_3_3.user_id',
  (
    select membership.user_id::text
    from public.organization_members as membership
    order by membership.created_at, membership.id
    limit 1
  ),
  true
);
select set_config(
  'prompt15_3_3.organization_id',
  (
    select membership.organization_id::text
    from public.organization_members as membership
    where membership.user_id::text = current_setting('prompt15_3_3.user_id')
    order by membership.created_at, membership.id
    limit 1
  ),
  true
);
select set_config(
  'prompt15_3_3.other_organization_id',
  extensions.gen_random_uuid()::text,
  true
);

do $fixture$
begin
  if nullif(current_setting('prompt15_3_3.user_id', true), '') is null
    or nullif(current_setting('prompt15_3_3.organization_id', true), '') is null then
    raise exception 'PROMPT15_3_3_AUTHENTICATED_MEMBER_FIXTURE_REQUIRED';
  end if;
end;
$fixture$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('prompt15_3_3.user_id'),
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

do $execution$
declare
  own_organization uuid := current_setting('prompt15_3_3.organization_id')::uuid;
  other_organization uuid := current_setting('prompt15_3_3.other_organization_id')::uuid;
  actual_ids uuid[];
  expected_ids uuid[];
begin
  select coalesce(array_agg(result.deal_id order by result.ordinality), array[]::uuid[])
  into actual_ids
  from public.list_deal_ids_by_recovery_score(
    own_organization, null, null, null, null, null, null, false, 0, 100
  ) with ordinality as result(deal_id, ordinality);

  select coalesce(
    array_agg(expected.id order by expected.recovery_score desc nulls last, expected.id asc),
    array[]::uuid[]
  )
  into expected_ids
  from (
    select deal.id, analysis.recovery_score
    from public.deals as deal
    left join public.deal_analyses as analysis
      on analysis.organization_id = deal.organization_id
      and analysis.deal_id = deal.id
    where deal.organization_id = own_organization
    order by analysis.recovery_score desc nulls last, deal.id asc
    limit 100
  ) as expected;

  if actual_ids is distinct from expected_ids then
    raise exception 'PROMPT15_3_3_HIGH_TO_LOW_ORDER_INVALID';
  end if;

  select coalesce(array_agg(result.deal_id order by result.ordinality), array[]::uuid[])
  into actual_ids
  from public.list_deal_ids_by_recovery_score(
    own_organization, null, null, null, null, null, null, true, 0, 100
  ) with ordinality as result(deal_id, ordinality);

  select coalesce(
    array_agg(expected.id order by expected.recovery_score asc nulls last, expected.id asc),
    array[]::uuid[]
  )
  into expected_ids
  from (
    select deal.id, analysis.recovery_score
    from public.deals as deal
    left join public.deal_analyses as analysis
      on analysis.organization_id = deal.organization_id
      and analysis.deal_id = deal.id
    where deal.organization_id = own_organization
    order by analysis.recovery_score asc nulls last, deal.id asc
    limit 100
  ) as expected;

  if actual_ids is distinct from expected_ids then
    raise exception 'PROMPT15_3_3_LOW_TO_HIGH_ORDER_INVALID';
  end if;

  select coalesce(array_agg(result.deal_id order by result.ordinality), array[]::uuid[])
  into actual_ids
  from public.list_deal_ids_by_recovery_score(
    own_organization, null, null, null, null, null, null, false, 1, 25
  ) with ordinality as result(deal_id, ordinality);

  select coalesce(
    array_agg(expected.id order by expected.recovery_score desc nulls last, expected.id asc),
    array[]::uuid[]
  )
  into expected_ids
  from (
    select deal.id, analysis.recovery_score
    from public.deals as deal
    left join public.deal_analyses as analysis
      on analysis.organization_id = deal.organization_id
      and analysis.deal_id = deal.id
    where deal.organization_id = own_organization
    order by analysis.recovery_score desc nulls last, deal.id asc
    offset 1
    limit 25
  ) as expected;

  if actual_ids is distinct from expected_ids then
    raise exception 'PROMPT15_3_3_GLOBAL_PAGINATION_INVALID';
  end if;

  begin
    perform 1
    from public.list_deal_ids_by_recovery_score(
      other_organization, null, null, null, null, null, null, false, 0, 25
    );
    raise exception 'PROMPT15_3_3_CROSS_ORGANIZATION_ACCESS_ALLOWED';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'DEAL_LIST_ORGANIZATION_UNAUTHORIZED' then
        raise;
      end if;
  end;
end;
$execution$;

reset role;
rollback;
