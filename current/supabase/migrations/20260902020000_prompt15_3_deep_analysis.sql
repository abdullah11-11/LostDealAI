-- LostDeal AI Prompt 15.3 — one current Standard/Deep analysis mode, bounded
-- Deep customer-visible JSON, and a two-operation Trial Deep preview inside
-- the existing AI_ANALYSES usage metric. No table, policy, or service role.
begin;

alter table public.deals
  add column requested_analysis_mode text not null default 'STANDARD';

alter table public.deals
  add constraint deals_requested_analysis_mode_valid
  check (requested_analysis_mode in ('STANDARD', 'DEEP'));

alter table public.deal_analyses
  add column analysis_mode text not null default 'STANDARD',
  add column analysis_schema_version text not null default 'standard-1.0',
  add column deep_analysis jsonb,
  add column deep_analyzed_at timestamptz;

alter table public.deal_analyses
  add constraint deal_analyses_analysis_mode_valid
    check (analysis_mode in ('STANDARD', 'DEEP')),
  add constraint deal_analyses_schema_version_bounded
    check (length(analysis_schema_version) between 1 and 40),
  add constraint deal_analyses_deep_analysis_object
    check (deep_analysis is null or jsonb_typeof(deep_analysis) = 'object'),
  add constraint deal_analyses_deep_timestamp_consistent
    check ((deep_analysis is null) = (deep_analyzed_at is null)),
  add constraint deal_analyses_deep_mode_complete
    check (
      analysis_mode <> 'DEEP'
      or (
        deep_analysis is not null
        and deep_analyzed_at is not null
        and analysis_schema_version = 'deep-1.0'
      )
    );

grant update (requested_analysis_mode) on table public.deals to authenticated;
grant insert (analysis_mode, analysis_schema_version, deep_analysis, deep_analyzed_at)
  on table public.deal_analyses to authenticated;
grant update (analysis_mode, analysis_schema_version, deep_analysis, deep_analyzed_at)
  on table public.deal_analyses to authenticated;

-- Keep one customer-facing AI Analyses meter. Deep operations use the
-- deep-analysis: idempotency prefix only to enforce the future Trial preview
-- atomically; Standard and Deep still each reserve and commit exactly one
-- AI_ANALYSES unit.
create or replace function public.reserve_organization_usage(
  target_authority_secret text,
  target_organization_id uuid,
  target_metric text,
  target_units integer,
  target_idempotency_key text
)
returns table (
  reservation_token uuid,
  is_new boolean,
  allowed boolean,
  plan_code text,
  usage_limit integer,
  period_start timestamptz,
  period_end timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_time timestamptz := clock_timestamp();
  selected_plan text;
  selected_status text;
  selected_period_start timestamptz;
  selected_period_end timestamptz;
  selected_trial_end timestamptz;
  selected_limit integer;
  status_allows_usage boolean := false;
  existing_status text;
  new_token uuid := gen_random_uuid();
  committed_total bigint := 0;
  reserved_total bigint := 0;
  deep_committed_total bigint := 0;
  deep_reserved_total bigint := 0;
  is_deep_analysis boolean := false;
  deep_quota_allows_usage boolean := true;
  quota_allows_usage boolean := false;
begin
  if encode(
    extensions.digest(coalesce(target_authority_secret, ''), 'sha256'),
    'hex'
  ) is distinct from '0d092f687fa975007a0c40bbaf91cd60cafe6ba5da8d3b2d780da8297ef953f1' then
    raise exception 'USAGE_AUTHORITY_INVALID' using errcode = '42501';
  end if;

  if not private.is_org_member(target_organization_id) then
    raise exception 'USAGE_ORGANIZATION_UNAUTHORIZED' using errcode = '42501';
  end if;
  if target_metric not in ('IMPORTED_DEALS', 'AI_ANALYSES', 'AI_MAPPING_REQUESTS', 'AUTO_CONVERT_ROWS')
    or target_units is null or target_units < 1 or target_units > 10000
    or target_idempotency_key is null
    or length(target_idempotency_key) not between 1 and 200 then
    raise exception 'USAGE_REQUEST_INVALID' using errcode = '22023';
  end if;

  is_deep_analysis := target_metric = 'AI_ANALYSES'
    and target_idempotency_key like 'deep-analysis:%';

  select
    subscription.plan_code,
    subscription.subscription_status,
    subscription.current_period_start,
    subscription.current_period_end,
    subscription.trial_ends_at
  into
    selected_plan,
    selected_status,
    selected_period_start,
    selected_period_end,
    selected_trial_end
  from public.organization_subscriptions as subscription
  where subscription.organization_id = target_organization_id;

  if selected_plan is null then
    raise exception 'USAGE_SUBSCRIPTION_MISSING' using errcode = 'P0001';
  end if;

  if selected_plan = 'INTERNAL' then
    selected_period_start := date_trunc('month', current_time);
    selected_period_end := selected_period_start + interval '1 month';
    status_allows_usage := true;
  elsif selected_status = 'trialing' then
    status_allows_usage := selected_trial_end is not null
      and current_time < selected_trial_end
      and current_time >= selected_period_start
      and current_time < selected_period_end;
  elsif selected_status in ('active', 'past_due') then
    status_allows_usage := current_time >= selected_period_start
      and current_time < selected_period_end;
  end if;

  selected_limit := private.plan_usage_limit(selected_plan, target_metric);
  if selected_limit = -1 then
    raise exception 'USAGE_PLAN_OR_METRIC_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_organization_id::text || ':' || target_metric || ':' || selected_period_start::text,
      0
    )
  );

  update public.organization_usage_events
  set status = 'expired', reservation_expires_at = null
  where organization_id = target_organization_id
    and metric = target_metric
    and status = 'reserved'
    and reservation_expires_at <= current_time;

  select usage_event.status
  into existing_status
  from public.organization_usage_events as usage_event
  where usage_event.organization_id = target_organization_id
    and usage_event.metric = target_metric
    and usage_event.idempotency_key = target_idempotency_key;

  select
    coalesce(sum(usage_event.units) filter (where usage_event.status = 'committed'), 0),
    coalesce(sum(usage_event.units) filter (
      where usage_event.status = 'reserved'
        and usage_event.reservation_expires_at > current_time
    ), 0)
  into committed_total, reserved_total
  from public.organization_usage_events as usage_event
  where usage_event.organization_id = target_organization_id
    and usage_event.metric = target_metric
    and usage_event.period_start = selected_period_start
    and usage_event.period_end = selected_period_end;

  if is_deep_analysis then
    select
      coalesce(sum(usage_event.units) filter (where usage_event.status = 'committed'), 0),
      coalesce(sum(usage_event.units) filter (
        where usage_event.status = 'reserved'
          and usage_event.reservation_expires_at > current_time
      ), 0)
    into deep_committed_total, deep_reserved_total
    from public.organization_usage_events as usage_event
    where usage_event.organization_id = target_organization_id
      and usage_event.metric = 'AI_ANALYSES'
      and usage_event.idempotency_key like 'deep-analysis:%'
      and usage_event.period_start = selected_period_start
      and usage_event.period_end = selected_period_end;

    deep_quota_allows_usage := case
      when selected_plan = 'INTERNAL' then true
      when selected_plan = 'TRIAL' then deep_committed_total + deep_reserved_total + target_units <= 2
      when selected_plan = 'PRO' then true
      else false
    end;
  end if;

  if existing_status in ('committed', 'reserved') then
    return query select
      null::uuid,
      false,
      true,
      selected_plan,
      selected_limit,
      selected_period_start,
      selected_period_end;
    return;
  end if;

  quota_allows_usage := status_allows_usage
    and deep_quota_allows_usage
    and (selected_limit is null or committed_total + reserved_total + target_units <= selected_limit);

  insert into public.organization_usage_events (
    organization_id,
    metric,
    idempotency_key,
    units,
    status,
    period_start,
    period_end,
    reservation_token,
    reservation_expires_at,
    over_limit_at_reservation,
    committed_at
  ) values (
    target_organization_id,
    target_metric,
    target_idempotency_key,
    target_units,
    'reserved',
    selected_period_start,
    selected_period_end,
    new_token,
    current_time + interval '15 minutes',
    not quota_allows_usage,
    null
  )
  on conflict (organization_id, metric, idempotency_key)
  do update set
    units = excluded.units,
    status = 'reserved',
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    reservation_token = excluded.reservation_token,
    reservation_expires_at = excluded.reservation_expires_at,
    over_limit_at_reservation = excluded.over_limit_at_reservation,
    committed_at = null;

  return query select
    new_token,
    true,
    quota_allows_usage,
    selected_plan,
    selected_limit,
    selected_period_start,
    selected_period_end;
end;
$$;

revoke all on function public.reserve_organization_usage(text, uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.reserve_organization_usage(text, uuid, text, integer, text)
  to authenticated;

commit;
