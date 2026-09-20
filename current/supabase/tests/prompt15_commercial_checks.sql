-- Read-only catalog checks for the current Prompt 15 commercial foundation.
-- Run after the Prompt 15, Prompt 15.1, Prompt 15.2, Prompt 15.3, and
-- Prompt 15.3.1, Prompt 15.3.2, and Prompt 15.3.3 migrations.

select to_regclass('public.organization_subscriptions') is not null as subscriptions_present;
select to_regclass('public.organization_usage_events') is not null as usage_events_present;

select relname, relrowsecurity as rls_enabled
from pg_class
where oid in (
  'public.organization_subscriptions'::regclass,
  'public.organization_usage_events'::regclass
)
order by relname;

select policyname, tablename, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('organization_subscriptions', 'organization_usage_events')
order by tablename, policyname;

select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('organization_subscriptions', 'organization_usage_events')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER')
order by table_name, grantee, privilege_type;

select
  has_function_privilege('anon', 'public.reserve_organization_usage(text,uuid,text,integer,text)', 'execute') as anon_can_reserve,
  has_function_privilege('authenticated', 'public.reserve_organization_usage(text,uuid,text,integer,text)', 'execute') as authenticated_can_reserve,
  has_function_privilege('anon', 'public.commit_organization_usage(text,uuid,text,text,uuid,integer)', 'execute') as anon_can_commit,
  has_function_privilege('authenticated', 'public.commit_organization_usage(text,uuid,text,text,uuid,integer)', 'execute') as authenticated_can_commit,
  has_function_privilege('anon', 'public.get_organization_usage(uuid)', 'execute') as anon_can_read_usage,
  has_function_privilege('authenticated', 'public.get_organization_usage(uuid)', 'execute') as authenticated_can_read_usage;

select
  count(*) filter (where subscription.plan_code = 'INTERNAL') as internal_organizations,
  count(*) as subscribed_organizations,
  (select count(*) from public.organizations) as organizations
from public.organization_subscriptions as subscription;

select
  private.plan_usage_limit('TRIAL', 'IMPORTED_DEALS') = 50 as trial_import_limit,
  private.plan_usage_limit('TRIAL', 'AI_ANALYSES') = 10 as trial_analysis_limit,
  private.plan_usage_limit('TRIAL', 'AI_MAPPING_REQUESTS') = 3 as trial_mapping_limit,
  private.plan_usage_limit('TRIAL', 'AUTO_CONVERT_ROWS') = 25 as trial_auto_convert_limit,
  private.plan_usage_limit('STARTER', 'IMPORTED_DEALS') = 250 as starter_import_limit,
  private.plan_usage_limit('STARTER', 'AI_ANALYSES') = 30 as starter_analysis_limit,
  private.plan_usage_limit('STARTER', 'AI_MAPPING_REQUESTS') = 3 as starter_mapping_limit,
  private.plan_usage_limit('STARTER', 'AUTO_CONVERT_ROWS') = 0 as starter_auto_convert_limit,
  private.plan_usage_limit('PRO', 'IMPORTED_DEALS') = 1500 as pro_import_limit,
  private.plan_usage_limit('PRO', 'AI_ANALYSES') = 250 as pro_analysis_limit,
  private.plan_usage_limit('PRO', 'AI_MAPPING_REQUESTS') = 30 as pro_mapping_limit,
  private.plan_usage_limit('PRO', 'AUTO_CONVERT_ROWS') = 1500 as pro_auto_convert_limit,
  private.plan_usage_limit('BUSINESS', 'AI_ANALYSES') = -1 as business_inactive,
  private.plan_usage_limit('BUSINESS', 'AUTO_CONVERT_ROWS') = -1 as business_auto_convert_inactive,
  private.plan_usage_limit('INTERNAL', 'AI_ANALYSES') is null as internal_unlimited,
  private.plan_usage_limit('INTERNAL', 'AUTO_CONVERT_ROWS') is null as internal_auto_convert_unlimited;

select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'deals'
      and column_name = 'requested_analysis_mode' and is_nullable = 'NO'
  ) as requested_analysis_mode_present,
  (
    select count(*) = 4
    from information_schema.columns
    where table_schema = 'public' and table_name = 'deal_analyses'
      and column_name in ('analysis_mode', 'analysis_schema_version', 'deep_analysis', 'deep_analyzed_at')
  ) as deep_analysis_columns_present;

select
  count(*) filter (where conname = 'deals_requested_analysis_mode_valid') = 1 as requested_mode_constraint_present,
  count(*) filter (where conname = 'deal_analyses_analysis_mode_valid') = 1 as analysis_mode_constraint_present,
  count(*) filter (where conname = 'deal_analyses_schema_version_bounded') = 1 as schema_version_constraint_present,
  count(*) filter (where conname = 'deal_analyses_deep_analysis_object') = 1 as deep_object_constraint_present,
  count(*) filter (where conname = 'deal_analyses_deep_timestamp_consistent') = 1 as deep_timestamp_constraint_present,
  count(*) filter (where conname = 'deal_analyses_deep_mode_complete') = 1 as deep_mode_constraint_present
from pg_constraint
where conrelid in ('public.deals'::regclass, 'public.deal_analyses'::regclass);

select
  not has_column_privilege('authenticated', 'public.deals', 'requested_analysis_mode', 'update') as authenticated_cannot_update_requested_mode,
  not has_column_privilege('authenticated', 'public.deals', 'analysis_status', 'insert,update') as authenticated_cannot_write_analysis_status,
  not has_column_privilege('authenticated', 'public.deals', 'analysis_error', 'insert,update') as authenticated_cannot_write_analysis_error,
  not has_table_privilege('authenticated', 'public.deal_analyses', 'insert') as authenticated_cannot_insert_analysis,
  not has_table_privilege('authenticated', 'public.deal_analyses', 'update') as authenticated_cannot_update_analysis,
  has_table_privilege('authenticated', 'public.deal_analyses', 'select') as authenticated_can_read_analysis;

select
  position('target_metric = ''AI_ANALYSES''' in pg_get_functiondef(
    'public.reserve_organization_usage(text,uuid,text,integer,text)'::regprocedure
  )) > 0 as deep_uses_ai_analyses,
  position('idempotency_key like ''deep-analysis:%''' in pg_get_functiondef(
    'public.reserve_organization_usage(text,uuid,text,integer,text)'::regprocedure
  )) > 0 as deep_prefix_checked,
  position('deep_committed_total + deep_reserved_total + target_units <= 2' in pg_get_functiondef(
    'public.reserve_organization_usage(text,uuid,text,integer,text)'::regprocedure
  )) > 0 as trial_two_deep_limit_present;

select
  count(*) = 1 as reserve_rpc_has_one_overload,
  count(*) filter (
    where pg_get_function_identity_arguments(procedure.oid) = 'target_authority_secret text, target_organization_id uuid, target_metric text, target_units integer, target_idempotency_key text'
  ) = 1 as reserve_rpc_signature_exact
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'reserve_organization_usage';

select
  procedure.prosecdef as reserve_rpc_security_definer,
  procedure.proconfig = array['search_path=""'] as reserve_rpc_empty_search_path,
  position('runtime_now' in lower(pg_get_functiondef(procedure.oid))) > 0 as explicit_runtime_now_present,
  position('date_trunc(''month''::text, runtime_now)' in lower(pg_get_functiondef(procedure.oid))) > 0
    or position('date_trunc(''month'', runtime_now)' in lower(pg_get_functiondef(procedure.oid))) > 0
    as internal_date_trunc_uses_runtime_now,
  position('current_time' in lower(pg_get_functiondef(procedure.oid))) = 0 as ambiguous_current_time_absent
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'reserve_organization_usage';

select
  not has_schema_privilege('anon', 'private', 'usage') as anon_cannot_use_private_schema,
  not has_schema_privilege('authenticated', 'private', 'usage') as authenticated_cannot_use_private_schema;

select
  count(*) = 1 as recovery_sort_rpc_has_one_overload,
  count(*) filter (
    where pg_get_function_identity_arguments(procedure.oid) =
      'target_organization_id uuid, target_search text, target_analysis_status text, target_priority text, target_reason text, target_service text, target_salesperson text, target_ascending boolean, target_offset integer, target_limit integer'
  ) = 1 as recovery_sort_rpc_signature_exact
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'list_deal_ids_by_recovery_score';

select
  procedure.prosecdef as recovery_sort_rpc_security_definer,
  procedure.provolatile = 's' as recovery_sort_rpc_stable,
  procedure.proconfig = array['search_path=""'] as recovery_sort_rpc_empty_search_path,
  position('private.is_org_member(target_organization_id)' in lower(pg_get_functiondef(procedure.oid))) > 0
    as recovery_sort_membership_check_present
from pg_proc as procedure
join pg_namespace as namespace on namespace.oid = procedure.pronamespace
where namespace.nspname = 'public'
  and procedure.proname = 'list_deal_ids_by_recovery_score';

select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'deals'
      and column_name = 'analysis_error_detail' and is_nullable = 'YES'
  ) as safe_analysis_diagnostic_present,
  (
    select count(*) = 2
    from information_schema.columns
    where table_schema = 'public' and table_name = 'deal_analyses'
      and column_name in ('analysis_usage_key', 'analysis_usage_status')
  ) as durable_usage_columns_present;

select
  count(*) filter (where conname = 'deals_analysis_error_detail_valid') = 1 as diagnostic_constraint_present,
  count(*) filter (where conname = 'deal_analyses_usage_status_valid') = 1 as usage_status_constraint_present,
  count(*) filter (where conname = 'deal_analyses_usage_key_consistent') = 1 as usage_key_constraint_present
from pg_constraint
where conrelid in ('public.deals'::regclass, 'public.deal_analyses'::regclass);

select
  not has_function_privilege('anon', 'public.transition_deal_analysis(text,uuid,uuid,text,text,text)', 'execute') as anon_cannot_transition_analysis,
  has_function_privilege('authenticated', 'public.transition_deal_analysis(text,uuid,uuid,text,text,text)', 'execute') as authenticated_can_call_protected_transition,
  not has_function_privilege('anon', 'public.persist_deal_analysis(text,uuid,uuid,jsonb,text,text,jsonb,timestamptz,jsonb,text,boolean)', 'execute') as anon_cannot_persist_analysis,
  has_function_privilege('authenticated', 'public.persist_deal_analysis(text,uuid,uuid,jsonb,text,text,jsonb,timestamptz,jsonb,text,boolean)', 'execute') as authenticated_can_call_protected_persistence,
  not has_function_privilege('anon', 'public.finalize_analysis_usage(text,uuid,text,text,integer)', 'execute') as anon_cannot_finalize_analysis_usage,
  has_function_privilege('authenticated', 'public.finalize_analysis_usage(text,uuid,text,text,integer)', 'execute') as authenticated_can_call_protected_finalizer,
  not has_function_privilege('anon', 'public.persist_deal_recovery_score(text,uuid,uuid,integer,text,text,jsonb)', 'execute') as anon_cannot_persist_recovery_score,
  has_function_privilege('authenticated', 'public.persist_deal_recovery_score(text,uuid,uuid,integer,text,text,jsonb)', 'execute') as authenticated_can_call_protected_scoring,
  not has_function_privilege('anon', 'public.list_deal_ids_by_recovery_score(uuid,text,text,text,text,text,text,boolean,integer,integer)', 'execute') as anon_cannot_sort_recovery_score,
  has_function_privilege('authenticated', 'public.list_deal_ids_by_recovery_score(uuid,text,text,text,text,text,text,boolean,integer,integer)', 'execute') as authenticated_can_sort_recovery_score,
  not has_function_privilege('authenticated', 'private.assert_analysis_runtime_authority(text,uuid)', 'execute') as authenticated_cannot_call_private_authority_helper;

select
  position('analysis_usage_status in (''pending'', ''committed'')' in lower(pg_get_functiondef(
    'public.finalize_analysis_usage(text,uuid,text,text,integer)'::regprocedure
  ))) > 0 as finalizer_requires_persisted_analysis,
  position('selected_status <> ''committed''' in lower(pg_get_functiondef(
    'public.finalize_analysis_usage(text,uuid,text,text,integer)'::regprocedure
  ))) > 0 as finalizer_is_idempotent,
  position('case when target_ascending then filtered.recovery_score end asc nulls last' in lower(pg_get_functiondef(
    'public.list_deal_ids_by_recovery_score(uuid,text,text,text,text,text,text,boolean,integer,integer)'::regprocedure
  ))) > 0 as recovery_score_ascending_present,
  position('case when not target_ascending then filtered.recovery_score end desc nulls last' in lower(pg_get_functiondef(
    'public.list_deal_ids_by_recovery_score(uuid,text,text,text,text,text,text,boolean,integer,integer)'::regprocedure
  ))) > 0 as recovery_score_descending_present;
