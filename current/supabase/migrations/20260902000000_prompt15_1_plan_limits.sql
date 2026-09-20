-- Prompt 15.1 updates only the database limit mirror established by the
-- already-applied Prompt 15 migration. No table, grant, policy, or RPC changes.
begin;

create or replace function private.plan_usage_limit(target_plan_code text, target_metric text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when target_plan_code = 'INTERNAL'
      and target_metric in ('IMPORTED_DEALS', 'AI_ANALYSES', 'AI_MAPPING_REQUESTS') then null
    when target_plan_code = 'TRIAL' and target_metric = 'IMPORTED_DEALS' then 50
    when target_plan_code = 'TRIAL' and target_metric = 'AI_ANALYSES' then 10
    when target_plan_code = 'TRIAL' and target_metric = 'AI_MAPPING_REQUESTS' then 3
    when target_plan_code = 'STARTER' and target_metric = 'IMPORTED_DEALS' then 250
    when target_plan_code = 'STARTER' and target_metric = 'AI_ANALYSES' then 30
    when target_plan_code = 'STARTER' and target_metric = 'AI_MAPPING_REQUESTS' then 3
    when target_plan_code = 'PRO' and target_metric = 'IMPORTED_DEALS' then 1500
    when target_plan_code = 'PRO' and target_metric = 'AI_ANALYSES' then 250
    when target_plan_code = 'PRO' and target_metric = 'AI_MAPPING_REQUESTS' then 30
    -- BUSINESS remains a compatibility code only. Returning -1 preserves the
    -- existing fail-closed RPC behavior until the future connected plan exists.
    else -1
  end;
$$;

revoke all on function private.plan_usage_limit(text, text) from public, anon, authenticated;

commit;
