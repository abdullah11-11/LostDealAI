-- LostDeal AI V1 — Prompt 15
-- Commercial foundation: organization subscriptions, tenant usage events,
-- idempotent quota reservations, and read-only member visibility.

begin;

create extension if not exists pgcrypto with schema extensions;

create table public.organization_subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  plan_code text not null,
  subscription_status text not null,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_subscriptions_plan_code_valid
    check (plan_code in ('INTERNAL', 'TRIAL', 'STARTER', 'PRO', 'BUSINESS')),
  constraint organization_subscriptions_status_valid
    check (subscription_status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  constraint organization_subscriptions_period_valid
    check (current_period_end > current_period_start),
  constraint organization_subscriptions_trial_valid
    check (trial_ends_at is null or trial_ends_at > current_period_start),
  constraint organization_subscriptions_provider_length
    check (provider is null or length(provider) between 1 and 50),
  constraint organization_subscriptions_provider_customer_length
    check (provider_customer_id is null or length(provider_customer_id) between 1 and 255),
  constraint organization_subscriptions_provider_subscription_length
    check (provider_subscription_id is null or length(provider_subscription_id) between 1 and 255)
);

create unique index organization_subscriptions_provider_customer_unique_idx
  on public.organization_subscriptions (provider, provider_customer_id)
  where provider is not null and provider_customer_id is not null;

create unique index organization_subscriptions_provider_subscription_unique_idx
  on public.organization_subscriptions (provider, provider_subscription_id)
  where provider is not null and provider_subscription_id is not null;

create table public.organization_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  metric text not null,
  idempotency_key text not null,
  units integer not null,
  status text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  reservation_token uuid not null default gen_random_uuid(),
  reservation_expires_at timestamptz,
  over_limit_at_reservation boolean not null default false,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_usage_events_metric_valid
    check (metric in ('IMPORTED_DEALS', 'AI_ANALYSES', 'AI_MAPPING_REQUESTS')),
  constraint organization_usage_events_status_valid
    check (status in ('reserved', 'committed', 'expired')),
  constraint organization_usage_events_units_positive check (units > 0),
  constraint organization_usage_events_key_length
    check (length(idempotency_key) between 1 and 200),
  constraint organization_usage_events_period_valid check (period_end > period_start),
  constraint organization_usage_events_commit_valid check (
    (status = 'committed' and committed_at is not null)
    or (status <> 'committed' and committed_at is null)
  ),
  constraint organization_usage_events_reservation_expiry_valid check (
    (status = 'reserved' and reservation_expires_at is not null)
    or status <> 'reserved'
  ),
  constraint organization_usage_events_idempotency_unique
    unique (organization_id, metric, idempotency_key)
);

create index organization_usage_events_period_lookup_idx
  on public.organization_usage_events (organization_id, metric, period_start, period_end, status);

create index organization_usage_events_reservation_expiry_idx
  on public.organization_usage_events (reservation_expires_at)
  where status = 'reserved';

create trigger organization_subscriptions_set_updated_at
  before update on public.organization_subscriptions
  for each row execute function public.set_updated_at();

create trigger organization_usage_events_set_updated_at
  before update on public.organization_usage_events
  for each row execute function public.set_updated_at();

-- Existing Prompt 1–14 organizations are authorized owner/test workspaces.
-- Backfill them as INTERNAL before installing the future-organization trigger.
insert into public.organization_subscriptions (
  organization_id,
  plan_code,
  subscription_status,
  current_period_start,
  current_period_end
)
select
  organization.id,
  'INTERNAL',
  'active',
  date_trunc('month', now()),
  date_trunc('month', now()) + interval '1 month'
from public.organizations as organization
on conflict (organization_id) do nothing;

create function private.handle_new_organization_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trial_end timestamptz := now() + interval '14 days';
begin
  insert into public.organization_subscriptions (
    organization_id,
    plan_code,
    subscription_status,
    current_period_start,
    current_period_end,
    trial_ends_at
  ) values (
    new.id,
    'TRIAL',
    'trialing',
    now(),
    trial_end,
    trial_end
  )
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

create trigger organizations_create_trial_subscription
  after insert on public.organizations
  for each row execute function private.handle_new_organization_subscription();

-- This database mirror keeps the atomic quota transaction authoritative.
-- tests/prompt15-commercial.test.ts locks it to lib/billing/plans.ts.
create function private.plan_usage_limit(target_plan_code text, target_metric text)
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
    when target_plan_code = 'STARTER' and target_metric = 'IMPORTED_DEALS' then 500
    when target_plan_code = 'STARTER' and target_metric = 'AI_ANALYSES' then 100
    when target_plan_code = 'STARTER' and target_metric = 'AI_MAPPING_REQUESTS' then 10
    when target_plan_code = 'PRO' and target_metric = 'IMPORTED_DEALS' then 2000
    when target_plan_code = 'PRO' and target_metric = 'AI_ANALYSES' then 500
    when target_plan_code = 'PRO' and target_metric = 'AI_MAPPING_REQUESTS' then 40
    when target_plan_code = 'BUSINESS' and target_metric = 'IMPORTED_DEALS' then 10000
    when target_plan_code = 'BUSINESS' and target_metric = 'AI_ANALYSES' then 2000
    when target_plan_code = 'BUSINESS' and target_metric = 'AI_MAPPING_REQUESTS' then 150
    else -1
  end;
$$;

create function public.reserve_organization_usage(
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
  if target_metric not in ('IMPORTED_DEALS', 'AI_ANALYSES', 'AI_MAPPING_REQUESTS')
    or target_units is null or target_units < 1 or target_units > 10000
    or target_idempotency_key is null
    or length(target_idempotency_key) not between 1 and 200 then
    raise exception 'USAGE_REQUEST_INVALID' using errcode = '22023';
  end if;

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
  set
    status = 'expired',
    reservation_expires_at = null
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

create function public.get_organization_usage(target_organization_id uuid)
returns table (
  metric text,
  committed_usage bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_plan text;
  selected_period_start timestamptz;
  selected_period_end timestamptz;
begin
  if not private.is_org_member(target_organization_id) then
    raise exception 'USAGE_ORGANIZATION_UNAUTHORIZED' using errcode = '42501';
  end if;

  select
    subscription.plan_code,
    subscription.current_period_start,
    subscription.current_period_end
  into
    selected_plan,
    selected_period_start,
    selected_period_end
  from public.organization_subscriptions as subscription
  where subscription.organization_id = target_organization_id;

  if selected_plan is null then
    raise exception 'USAGE_SUBSCRIPTION_MISSING' using errcode = 'P0001';
  end if;

  if selected_plan = 'INTERNAL' then
    selected_period_start := date_trunc('month', clock_timestamp());
    selected_period_end := selected_period_start + interval '1 month';
  end if;

  return query
  with metrics(metric) as (
    values ('IMPORTED_DEALS'::text), ('AI_ANALYSES'::text), ('AI_MAPPING_REQUESTS'::text)
  )
  select
    metrics.metric,
    coalesce(sum(usage_event.units), 0)::bigint as committed_usage
  from metrics
  left join public.organization_usage_events as usage_event
    on usage_event.organization_id = target_organization_id
    and usage_event.metric = metrics.metric
    and usage_event.status = 'committed'
    and usage_event.period_start = selected_period_start
    and usage_event.period_end = selected_period_end
  group by metrics.metric
  order by metrics.metric;
end;
$$;

create function public.commit_organization_usage(
  target_authority_secret text,
  target_organization_id uuid,
  target_metric text,
  target_idempotency_key text,
  target_reservation_token uuid,
  target_committed_units integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer := 0;
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
  if target_metric not in ('IMPORTED_DEALS', 'AI_ANALYSES', 'AI_MAPPING_REQUESTS')
    or target_committed_units is null or target_committed_units < 1 then
    raise exception 'USAGE_COMMIT_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_organization_id::text || ':' || target_metric || ':' || target_idempotency_key,
      0
    )
  );

  update public.organization_usage_events
  set
    units = target_committed_units,
    status = 'committed',
    committed_at = clock_timestamp(),
    reservation_expires_at = null
  where organization_id = target_organization_id
    and metric = target_metric
    and idempotency_key = target_idempotency_key
    and reservation_token = target_reservation_token
    and status in ('reserved', 'expired')
    and target_committed_units <= units;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

revoke all on function private.handle_new_organization_subscription() from public, anon, authenticated;
revoke all on function private.plan_usage_limit(text, text) from public, anon, authenticated;
revoke all on function public.reserve_organization_usage(text, uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.commit_organization_usage(text, uuid, text, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.get_organization_usage(uuid)
  from public, anon, authenticated;

grant execute on function public.reserve_organization_usage(text, uuid, text, integer, text)
  to authenticated;
grant execute on function public.commit_organization_usage(text, uuid, text, text, uuid, integer)
  to authenticated;
grant execute on function public.get_organization_usage(uuid)
  to authenticated;

alter table public.organization_subscriptions enable row level security;
alter table public.organization_usage_events enable row level security;

create policy organization_subscriptions_select_member
  on public.organization_subscriptions
  for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy organization_usage_events_select_member
  on public.organization_usage_events
  for select
  to authenticated
  using (private.is_org_member(organization_id));

revoke all on table public.organization_subscriptions from anon, authenticated;
revoke all on table public.organization_usage_events from anon, authenticated;

grant select (
  organization_id,
  plan_code,
  subscription_status,
  current_period_start,
  current_period_end,
  trial_ends_at,
  cancel_at_period_end,
  created_at,
  updated_at
) on table public.organization_subscriptions to authenticated;

commit;
