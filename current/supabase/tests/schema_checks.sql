-- LostDeal AI — Prompt 15.3.7 final omnibus catalog verification.
-- Run after every production migration. This script is transaction-wrapped,
-- performs catalog/privilege assertions only, and always rolls back.

begin;
set local statement_timeout = '60s';

do $$
declare
  failure_detail text;
begin
  -- The public application surface is exactly the current eight-table model.
  select string_agg(expected.table_name, ', ' order by expected.table_name)
  into failure_detail
  from (
    values
      ('profiles'),
      ('organizations'),
      ('organization_members'),
      ('uploads'),
      ('deals'),
      ('deal_analyses'),
      ('organization_subscriptions'),
      ('organization_usage_events')
  ) as expected(table_name)
  where to_regclass(format('public.%I', expected.table_name)) is null;

  if failure_detail is not null then
    raise exception 'Missing public application tables: %', failure_detail;
  end if;

  select string_agg(current_table.table_name, ', ' order by current_table.table_name)
  into failure_detail
  from information_schema.tables as current_table
  where current_table.table_schema = 'public'
    and current_table.table_type = 'BASE TABLE'
    and current_table.table_name not in (
      'profiles',
      'organizations',
      'organization_members',
      'uploads',
      'deals',
      'deal_analyses',
      'organization_subscriptions',
      'organization_usage_events'
    );

  if failure_detail is not null then
    raise exception 'Unexpected public application tables: %', failure_detail;
  end if;

  -- RLS must protect all eight public application tables.
  select string_agg(expected.table_name, ', ' order by expected.table_name)
  into failure_detail
  from (
    values
      ('profiles'),
      ('organizations'),
      ('organization_members'),
      ('uploads'),
      ('deals'),
      ('deal_analyses'),
      ('organization_subscriptions'),
      ('organization_usage_events')
  ) as expected(table_name)
  left join pg_catalog.pg_namespace as namespace
    on namespace.nspname = 'public'
  left join pg_catalog.pg_class as relation
    on relation.relnamespace = namespace.oid
    and relation.relname = expected.table_name
    and relation.relkind = 'r'
  where relation.oid is null or not relation.relrowsecurity;

  if failure_detail is not null then
    raise exception 'RLS is not enabled on: %', failure_detail;
  end if;

  -- Named constraints from the ten immutable migrations remain present.
  select string_agg(
    expected.table_name || '.' || expected.constraint_name,
    ', ' order by expected.table_name, expected.constraint_name
  )
  into failure_detail
  from (
    values
      ('organizations', 'organizations_name_not_empty'),
      ('organization_members', 'organization_members_organization_id_user_id_key'),
      ('organization_members', 'organization_members_role_valid'),
      ('uploads', 'uploads_organization_id_id_key'),
      ('uploads', 'uploads_filename_not_empty'),
      ('uploads', 'uploads_total_rows_nonnegative'),
      ('uploads', 'uploads_valid_rows_nonnegative'),
      ('uploads', 'uploads_invalid_rows_nonnegative'),
      ('uploads', 'uploads_status_valid'),
      ('deals', 'deals_organization_id_id_key'),
      ('deals', 'deals_upload_belongs_to_organization'),
      ('deals', 'deals_deal_value_nonnegative'),
      ('deals', 'deals_status_valid'),
      ('deals', 'deals_analysis_status_valid'),
      ('deals', 'deals_requested_analysis_mode_valid'),
      ('deals', 'deals_analysis_error_detail_valid'),
      ('deal_analyses', 'deal_analyses_deal_id_key'),
      ('deal_analyses', 'deal_analyses_deal_belongs_to_organization'),
      ('deal_analyses', 'deal_analyses_lost_reason_valid'),
      ('deal_analyses', 'deal_analyses_buying_intent_score_range'),
      ('deal_analyses', 'deal_analyses_recovery_score_range'),
      ('deal_analyses', 'deal_analyses_confidence_score_range'),
      ('deal_analyses', 'deal_analyses_recovery_priority_valid'),
      ('deal_analyses', 'deal_analyses_recommended_channel_valid'),
      ('deal_analyses', 'deal_analyses_evidence_is_array'),
      ('deal_analyses', 'deal_analyses_positive_signals_is_array'),
      ('deal_analyses', 'deal_analyses_negative_signals_is_array'),
      ('deal_analyses', 'deal_analyses_analysis_mode_valid'),
      ('deal_analyses', 'deal_analyses_schema_version_bounded'),
      ('deal_analyses', 'deal_analyses_deep_analysis_object'),
      ('deal_analyses', 'deal_analyses_deep_timestamp_consistent'),
      ('deal_analyses', 'deal_analyses_deep_mode_complete'),
      ('deal_analyses', 'deal_analyses_usage_status_valid'),
      ('deal_analyses', 'deal_analyses_usage_key_consistent'),
      ('organization_subscriptions', 'organization_subscriptions_plan_code_valid'),
      ('organization_subscriptions', 'organization_subscriptions_status_valid'),
      ('organization_subscriptions', 'organization_subscriptions_period_valid'),
      ('organization_subscriptions', 'organization_subscriptions_trial_valid'),
      ('organization_subscriptions', 'organization_subscriptions_provider_length'),
      ('organization_subscriptions', 'organization_subscriptions_provider_customer_length'),
      ('organization_subscriptions', 'organization_subscriptions_provider_subscription_length'),
      ('organization_usage_events', 'organization_usage_events_metric_valid'),
      ('organization_usage_events', 'organization_usage_events_status_valid'),
      ('organization_usage_events', 'organization_usage_events_units_positive'),
      ('organization_usage_events', 'organization_usage_events_key_length'),
      ('organization_usage_events', 'organization_usage_events_period_valid'),
      ('organization_usage_events', 'organization_usage_events_commit_valid'),
      ('organization_usage_events', 'organization_usage_events_reservation_expiry_valid'),
      ('organization_usage_events', 'organization_usage_events_idempotency_unique')
  ) as expected(table_name, constraint_name)
  left join pg_catalog.pg_constraint as constraint_catalog
    on constraint_catalog.conrelid = to_regclass('public.' || expected.table_name)
    and constraint_catalog.conname = expected.constraint_name
  where constraint_catalog.oid is null;

  if failure_detail is not null then
    raise exception 'Missing constraints: %', failure_detail;
  end if;

  -- Required lookup/uniqueness indexes remain available.
  select string_agg(expected.index_name, ', ' order by expected.index_name)
  into failure_detail
  from (
    values
      ('organization_members_organization_id_user_id_key'),
      ('organization_members_user_id_idx'),
      ('uploads_organization_id_idx'),
      ('deals_organization_id_idx'),
      ('deals_upload_id_idx'),
      ('deals_quote_date_idx'),
      ('deals_analysis_status_idx'),
      ('deals_organization_external_deal_id_unique_idx'),
      ('deal_analyses_organization_id_idx'),
      ('deal_analyses_deal_id_key'),
      ('deal_analyses_analysis_usage_key_unique'),
      ('organization_subscriptions_provider_customer_unique_idx'),
      ('organization_subscriptions_provider_subscription_unique_idx'),
      ('organization_usage_events_period_lookup_idx'),
      ('organization_usage_events_reservation_expiry_idx'),
      ('organization_usage_events_idempotency_unique')
  ) as expected(index_name)
  left join pg_catalog.pg_indexes as index_catalog
    on index_catalog.schemaname = 'public'
    and index_catalog.indexname = expected.index_name
  where index_catalog.indexname is null;

  if failure_detail is not null then
    raise exception 'Missing indexes: %', failure_detail;
  end if;

  -- The final policy set exposes only tenant-scoped reads/allowed source writes.
  select string_agg(
    expected.table_name || '.' || expected.policy_name,
    ', ' order by expected.table_name, expected.policy_name
  )
  into failure_detail
  from (
    values
      ('profiles', 'profiles_select_own', 'SELECT'),
      ('profiles', 'profiles_update_own', 'UPDATE'),
      ('organizations', 'organizations_insert_own', 'INSERT'),
      ('organizations', 'organizations_select_member_or_bootstrap_creator', 'SELECT'),
      ('organizations', 'organizations_update_owner', 'UPDATE'),
      ('organization_members', 'organization_members_select_org_member', 'SELECT'),
      ('organization_members', 'organization_members_insert_initial_owner', 'INSERT'),
      ('uploads', 'uploads_select_org_member', 'SELECT'),
      ('uploads', 'uploads_insert_org_member', 'INSERT'),
      ('uploads', 'uploads_update_org_member', 'UPDATE'),
      ('deals', 'deals_select_org_member', 'SELECT'),
      ('deals', 'deals_insert_org_member', 'INSERT'),
      ('deals', 'deals_update_org_member', 'UPDATE'),
      ('deals', 'deals_delete_org_member', 'DELETE'),
      ('deal_analyses', 'deal_analyses_select_org_member', 'SELECT'),
      ('organization_subscriptions', 'organization_subscriptions_select_member', 'SELECT'),
      ('organization_usage_events', 'organization_usage_events_select_member', 'SELECT')
  ) as expected(table_name, policy_name, command_name)
  left join pg_catalog.pg_policies as policy_catalog
    on policy_catalog.schemaname = 'public'
    and policy_catalog.tablename = expected.table_name
    and policy_catalog.policyname = expected.policy_name
    and policy_catalog.cmd = expected.command_name
  where policy_catalog.policyname is null;

  if failure_detail is not null then
    raise exception 'Missing or altered RLS policies: %', failure_detail;
  end if;

  select string_agg(
    policy_catalog.tablename || '.' || policy_catalog.policyname,
    ', ' order by policy_catalog.tablename, policy_catalog.policyname
  )
  into failure_detail
  from pg_catalog.pg_policies as policy_catalog
  where policy_catalog.schemaname = 'public'
    and policy_catalog.tablename in (
      'profiles', 'organizations', 'organization_members', 'uploads', 'deals',
      'deal_analyses', 'organization_subscriptions', 'organization_usage_events'
    )
    and not exists (
      select 1
      from (
        values
          ('profiles', 'profiles_select_own'),
          ('profiles', 'profiles_update_own'),
          ('organizations', 'organizations_insert_own'),
          ('organizations', 'organizations_select_member_or_bootstrap_creator'),
          ('organizations', 'organizations_update_owner'),
          ('organization_members', 'organization_members_select_org_member'),
          ('organization_members', 'organization_members_insert_initial_owner'),
          ('uploads', 'uploads_select_org_member'),
          ('uploads', 'uploads_insert_org_member'),
          ('uploads', 'uploads_update_org_member'),
          ('deals', 'deals_select_org_member'),
          ('deals', 'deals_insert_org_member'),
          ('deals', 'deals_update_org_member'),
          ('deals', 'deals_delete_org_member'),
          ('deal_analyses', 'deal_analyses_select_org_member'),
          ('organization_subscriptions', 'organization_subscriptions_select_member'),
          ('organization_usage_events', 'organization_usage_events_select_member')
      ) as expected(table_name, policy_name)
      where expected.table_name = policy_catalog.tablename
        and expected.policy_name = policy_catalog.policyname
    );

  if failure_detail is not null then
    raise exception 'Unexpected RLS policies: %', failure_detail;
  end if;

  -- Automatic profile/subscription and updated_at triggers remain installed.
  select string_agg(
    expected.schema_name || '.' || expected.table_name || '.' || expected.trigger_name,
    ', ' order by expected.schema_name, expected.table_name, expected.trigger_name
  )
  into failure_detail
  from (
    values
      ('auth', 'users', 'on_auth_user_created'),
      ('public', 'profiles', 'profiles_set_updated_at'),
      ('public', 'organizations', 'organizations_set_updated_at'),
      ('public', 'organizations', 'organizations_create_trial_subscription'),
      ('public', 'uploads', 'uploads_set_updated_at'),
      ('public', 'deals', 'deals_set_updated_at'),
      ('public', 'deal_analyses', 'deal_analyses_set_updated_at'),
      ('public', 'organization_subscriptions', 'organization_subscriptions_set_updated_at'),
      ('public', 'organization_usage_events', 'organization_usage_events_set_updated_at')
  ) as expected(schema_name, table_name, trigger_name)
  left join pg_catalog.pg_trigger as trigger_catalog
    on trigger_catalog.tgrelid = to_regclass(
      format('%I.%I', expected.schema_name, expected.table_name)
    )
    and trigger_catalog.tgname = expected.trigger_name
    and not trigger_catalog.tgisinternal
  where trigger_catalog.oid is null;

  if failure_detail is not null then
    raise exception 'Missing triggers: %', failure_detail;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = 'rls_auto_enable'
      and procedure.pronargs = 0
      and procedure.prosecdef
      and coalesce(array_to_string(procedure.proconfig, ','), '') = 'search_path=pg_catalog'
  ) then
    raise exception 'Expected hardened public.rls_auto_enable() helper is missing';
  end if;
end;
$$;

do $$
declare
  expected record;
  function_oid oid;
  function_is_definer boolean;
  function_config text;
begin
  -- Helper/RPC execution mode and hardened search path are catalog contracts.
  for expected in
    select *
    from (
      values
        ('private.handle_new_user()', true, false),
        ('private.is_org_member(uuid)', true, false),
        ('private.is_org_owner(uuid)', true, false),
        ('private.can_read_organization_during_bootstrap(uuid)', true, false),
        ('private.can_bootstrap_organization_membership(uuid,uuid,text)', true, false),
        ('private.handle_new_organization_subscription()', true, false),
        ('private.plan_usage_limit(text,text)', false, false),
        ('private.assert_analysis_runtime_authority(text,uuid)', true, false),
        ('public.set_updated_at()', false, false),
        ('public.reserve_organization_usage(text,uuid,text,integer,text)', true, true),
        ('public.commit_organization_usage(text,uuid,text,text,uuid,integer)', true, true),
        ('public.get_organization_usage(uuid)', true, true),
        ('public.transition_deal_analysis(text,uuid,uuid,text,text,text)', true, true),
        ('public.persist_deal_analysis(text,uuid,uuid,jsonb,text,text,jsonb,timestamp with time zone,jsonb,text,boolean)', true, true),
        ('public.finalize_analysis_usage(text,uuid,text,text,integer)', true, true),
        ('public.persist_deal_recovery_score(text,uuid,uuid,integer,text,text,jsonb)', true, true),
        ('public.list_deal_ids_by_recovery_score(uuid,text,text,text,text,text,text,boolean,integer,integer)', true, true)
    ) as required(function_signature, security_definer_expected, authenticated_execute_expected)
  loop
    function_oid := to_regprocedure(expected.function_signature);
    if function_oid is null then
      raise exception 'Missing function: %', expected.function_signature;
    end if;

    select procedure.prosecdef, coalesce(array_to_string(procedure.proconfig, ','), '')
    into function_is_definer, function_config
    from pg_catalog.pg_proc as procedure
    where procedure.oid = function_oid;

    if function_is_definer is distinct from expected.security_definer_expected then
      raise exception 'Unexpected SECURITY DEFINER mode for %', expected.function_signature;
    end if;

    if function_config !~ '(^|,)search_path=(""|)(,|$)' then
      raise exception 'Function lacks fixed empty search_path: % (%)',
        expected.function_signature, function_config;
    end if;

    if has_function_privilege('anon', function_oid, 'EXECUTE') then
      raise exception 'Anonymous EXECUTE leaked to %', expected.function_signature;
    end if;

    if expected.authenticated_execute_expected
      and not has_function_privilege('authenticated', function_oid, 'EXECUTE') then
      raise exception 'Authenticated EXECUTE missing from %', expected.function_signature;
    end if;
  end loop;

  if has_schema_privilege('anon', 'private', 'USAGE')
    or has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'Private schema USAGE leaked to a Data API role';
  end if;

  if has_function_privilege(
    'authenticated',
    'private.assert_analysis_runtime_authority(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Analysis authority helper is directly executable';
  end if;
end;
$$;

do $$
declare
  anonymous_privileges integer;
  protected_write_privileges integer;
begin
  -- Anonymous users receive no application table or column privileges.
  select count(*)
  into anonymous_privileges
  from information_schema.table_privileges
  where grantee = 'anon'
    and table_schema = 'public'
    and table_name in (
      'profiles', 'organizations', 'organization_members', 'uploads', 'deals',
      'deal_analyses', 'organization_subscriptions', 'organization_usage_events'
    );

  select anonymous_privileges + count(*)
  into anonymous_privileges
  from information_schema.column_privileges
  where grantee = 'anon'
    and table_schema = 'public'
    and table_name in (
      'profiles', 'organizations', 'organization_members', 'uploads', 'deals',
      'deal_analyses', 'organization_subscriptions', 'organization_usage_events'
    );

  if anonymous_privileges <> 0 then
    raise exception 'Anonymous table/column privileges detected: %', anonymous_privileges;
  end if;

  -- Authenticated tenant reads exist for user-facing tables.
  if not has_table_privilege('authenticated', 'public.profiles', 'SELECT')
    or not has_table_privilege('authenticated', 'public.organizations', 'SELECT')
    or not has_table_privilege('authenticated', 'public.organization_members', 'SELECT')
    or not has_table_privilege('authenticated', 'public.uploads', 'SELECT')
    or not has_table_privilege('authenticated', 'public.deals', 'SELECT')
    or not has_table_privilege('authenticated', 'public.deal_analyses', 'SELECT') then
    raise exception 'Expected authenticated tenant read grant is missing';
  end if;

  if not has_column_privilege(
    'authenticated',
    'public.organization_subscriptions',
    'plan_code',
    'SELECT'
  ) then
    raise exception 'Approved subscription projection is not readable';
  end if;

  if has_column_privilege(
    'authenticated',
    'public.organization_subscriptions',
    'provider_customer_id',
    'SELECT'
  ) or has_column_privilege(
    'authenticated',
    'public.organization_subscriptions',
    'provider_subscription_id',
    'SELECT'
  ) then
    raise exception 'Provider subscription identifiers are directly readable';
  end if;

  if has_table_privilege('authenticated', 'public.organization_usage_events', 'SELECT')
    or has_any_column_privilege('authenticated', 'public.organization_usage_events', 'SELECT') then
    raise exception 'Raw usage ledger is directly readable';
  end if;

  -- authenticated_cannot_write_protected_columns
  select count(*)
  into protected_write_privileges
  from information_schema.column_privileges
  where grantee = 'authenticated'
    and table_schema = 'public'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    and (
      (table_name = 'deals' and column_name in (
        'analysis_status', 'analysis_error', 'analysis_error_detail',
        'requested_analysis_mode'
      ))
      or table_name in (
        'deal_analyses',
        'organization_subscriptions',
        'organization_usage_events'
      )
    );

  if protected_write_privileges <> 0
    or has_table_privilege('authenticated', 'public.deal_analyses', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.organization_subscriptions', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.organization_usage_events', 'INSERT,UPDATE,DELETE') then
    raise exception 'Authenticated protected-write privilege detected';
  end if;

  if not has_table_privilege('authenticated', 'public.deals', 'DELETE') then
    raise exception 'Prompt 12 tenant-scoped deal DELETE grant is missing';
  end if;
end;
$$;

select 'PROMPT15_3_7_SCHEMA_CHECKS_PASS' as result;

rollback;
