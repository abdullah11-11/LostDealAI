-- Prompt 16: Sandbox-only Paddle synchronization. Historical usage/trial rows
-- and period anchors are never reset by a billing transition.
begin;
alter table public.organization_subscriptions
  drop constraint organization_subscriptions_status_valid,
  add constraint organization_subscriptions_status_valid check (subscription_status in ('trialing','active','past_due','paused','canceled','incomplete')),
  add column provider_price_id text,
  add column provider_period_start timestamptz,
  add column provider_period_end timestamptz,
  add column provider_scheduled_action text check (provider_scheduled_action in ('cancel','pause','resume')),
  add column provider_scheduled_at timestamptz,
  add column last_provider_event_id text,
  add column last_provider_event_occurred_at timestamptz,
  add column billing_operation_id uuid,
  add column billing_operation_started_at timestamptz,
  add column billing_operation_target text check (billing_operation_target in ('STARTER','PRO','cancel'));
drop index public.organization_subscriptions_provider_customer_unique_idx;
create index organization_subscriptions_provider_customer_idx on public.organization_subscriptions(provider,provider_customer_id);

create table public.billing_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_code text not null check (plan_code in ('STARTER','PRO')),
  price_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '30 minutes',
  consumed_at timestamptz,
  constraint billing_intent_price check (
    (plan_code='STARTER' and price_id='pri_01m2mqgrjazqnz7wyex9p7dyt8') or
    (plan_code='PRO' and price_id='pri_01m2mqs3q7f9r0kyqzmrt6gkgg'))
);
create index billing_checkout_intents_org_idx on public.billing_checkout_intents(organization_id,expires_at);
create table public.billing_event_receipts (
  event_id text primary key check (length(event_id) between 1 and 100),
  event_type text not null check (event_type in ('subscription.created','subscription.updated','subscription.activated','subscription.past_due','subscription.paused','subscription.resumed','subscription.canceled','reconciliation')),
  occurred_at timestamptz not null,
  subscription_id text not null check (subscription_id ~ '^sub_[a-z0-9]{26}$'),
  organization_id uuid references public.organizations(id) on delete set null,
  outcome text not null check (outcome in ('PROCESSING','APPLIED','STALE_EVENT','UNKNOWN_PRICE','MISSING_CHECKOUT_INTENT','EXPIRED_CHECKOUT_INTENT','CONSUMED_CHECKOUT_INTENT','PLAN_PRICE_MISMATCH','SUBSCRIPTION_CONFLICT','UNKNOWN_SUBSCRIPTION','INTERNAL_WORKSPACE_BLOCKED','INVALID_STATUS','RECONCILE_CONFLICT')),
  processed_at timestamptz not null default clock_timestamp()
);
create index billing_event_receipts_org_idx on public.billing_event_receipts(organization_id);
alter table public.billing_checkout_intents enable row level security;
alter table public.billing_event_receipts enable row level security;
revoke all on public.billing_checkout_intents, public.billing_event_receipts from public,anon,authenticated;

create function private.assert_billing_authority(secret text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if encode(extensions.digest(coalesce(secret,''),'sha256'),'hex') is distinct from
    '0d092f687fa975007a0c40bbaf91cd60cafe6ba5da8d3b2d780da8297ef953f1' then
    raise exception 'AUTHORITY_REJECTED' using errcode='42501';
  end if;
end; $$;
revoke all on function private.assert_billing_authority(text) from public,anon,authenticated;

create function public.get_billing_subscription(target_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_org_owner(target_organization_id) then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  return (select to_jsonb(s) from public.organization_subscriptions s where s.organization_id=target_organization_id);
end; $$;

create function public.create_billing_checkout_intent(target_authority_secret text,target_organization_id uuid,target_plan text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; i public.billing_checkout_intents%rowtype; price text;
begin
  perform private.assert_billing_authority(target_authority_secret);
  if not private.is_org_owner(target_organization_id) then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  select * into s from public.organization_subscriptions where organization_id=target_organization_id for update;
  if not found or s.plan_code='INTERNAL' or s.plan_code='BUSINESS' then raise exception 'CHECKOUT_UNAVAILABLE'; end if;
  if s.provider_subscription_id is not null and s.subscription_status <> 'canceled' then raise exception 'SUBSCRIPTION_CONFLICT'; end if;
  if s.billing_operation_id is not null then raise exception 'BILLING_OPERATION_PENDING'; end if;
  price := case target_plan when 'STARTER' then 'pri_01m2mqgrjazqnz7wyex9p7dyt8' when 'PRO' then 'pri_01m2mqs3q7f9r0kyqzmrt6gkgg' end;
  if price is null then raise exception 'UNKNOWN_PRICE'; end if;
  select * into i from public.billing_checkout_intents where organization_id=target_organization_id and consumed_at is null and expires_at>clock_timestamp() order by created_at desc limit 1;
  if found then
    if i.plan_code<>target_plan then raise exception 'CHECKOUT_PENDING'; end if;
  else
    insert into public.billing_checkout_intents(organization_id,plan_code,price_id) values(target_organization_id,target_plan,price) returning * into i;
  end if;
  return jsonb_build_object('intentId',i.id,'priceId',i.price_id,'expiresAt',i.expires_at);
end; $$;

create function public.begin_billing_operation(target_authority_secret text,target_organization_id uuid,target_plan text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; token uuid:=gen_random_uuid();
begin
  perform private.assert_billing_authority(target_authority_secret);
  if not private.is_org_owner(target_organization_id) then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  select * into s from public.organization_subscriptions where organization_id=target_organization_id for update;
  if not found or s.provider is distinct from 'paddle_sandbox' or s.plan_code not in ('STARTER','PRO') or s.subscription_status <> 'active' or s.provider_subscription_id is null then raise exception 'SUBSCRIPTION_CONFLICT'; end if;
  if target_plan is null or target_plan not in ('STARTER','PRO','cancel') or target_plan=s.plan_code then raise exception 'INVALID_PLAN_CHANGE'; end if;
  if s.billing_operation_id is not null or s.provider_scheduled_action is not null then raise exception 'BILLING_OPERATION_PENDING'; end if;
  update public.organization_subscriptions set billing_operation_id=token,billing_operation_started_at=clock_timestamp(),billing_operation_target=target_plan where organization_id=target_organization_id;
  return token;
end; $$;

create function public.synchronize_paddle_subscription(target_authority_secret text,target_event jsonb,target_expected_event_id text default null) returns text
language plpgsql security definer set search_path='' as $$
<<sync>>
declare
  s public.organization_subscriptions%rowtype; i public.billing_checkout_intents%rowtype;
  event_id text:=target_event->>'event_id'; event_type text:=target_event->>'event_type';
  occurred timestamptz:=(target_event->>'occurred_at')::timestamptz;
  subscription_id text:=target_event->>'subscription_id'; customer_id text:=target_event->>'customer_id';
  price text:=target_event->>'price_id'; status text:=target_event->>'status';
  mapped text; outcome text:='APPLIED'; initial_binding boolean:=false;
begin
  perform private.assert_billing_authority(target_authority_secret);
  if event_id is null or occurred is null or occurred>clock_timestamp()+interval '1 minute'
    or event_type is null or event_type not in ('subscription.created','subscription.updated','subscription.activated','subscription.past_due','subscription.paused','subscription.resumed','subscription.canceled','reconciliation')
    or subscription_id is null or subscription_id !~ '^sub_[a-z0-9]{26}$'
    or customer_id is null or customer_id !~ '^ctm_[a-z0-9]{26}$'
    or (event_type<>'reconciliation' and event_id !~ '^evt_[a-z0-9]{26}$') then raise exception 'INVALID_EVENT' using errcode='22023'; end if;
  -- Lock subscription and event independently; transaction rollback releases both.
  perform pg_advisory_xact_lock(hashtextextended('paddle-sub:'||subscription_id,0));
  insert into public.billing_event_receipts(event_id,event_type,occurred_at,subscription_id,outcome)
    values(event_id,event_type,occurred,subscription_id,'PROCESSING') on conflict do nothing;
  if not found then return 'DUPLICATE_EVENT'; end if;
  select * into s from public.organization_subscriptions where provider='paddle_sandbox' and provider_subscription_id=subscription_id for update;
  if not found then
    if event_type='reconciliation' then raise exception 'UNKNOWN_SUBSCRIPTION'; end if;
    select * into i from public.billing_checkout_intents where id=(target_event->>'intent_id')::uuid;
    if not found then outcome:='MISSING_CHECKOUT_INTENT';
    else
      -- Same lock order as checkout: subscription row first, then intent row.
      select * into s from public.organization_subscriptions where organization_id=i.organization_id for update;
      select * into i from public.billing_checkout_intents where id=i.id for update;
      if s.organization_id is null then outcome:='UNKNOWN_SUBSCRIPTION';
      elsif s.plan_code='INTERNAL' then outcome:='INTERNAL_WORKSPACE_BLOCKED';
      elsif i.consumed_at is not null then outcome:='CONSUMED_CHECKOUT_INTENT';
      elsif i.expires_at<=clock_timestamp() then outcome:='EXPIRED_CHECKOUT_INTENT';
      elsif i.price_id is distinct from price then outcome:='PLAN_PRICE_MISMATCH';
      elsif s.provider_subscription_id is not null and s.subscription_status<>'canceled' then outcome:='SUBSCRIPTION_CONFLICT';
      else initial_binding:=true;
      end if;
    end if;
  end if;
  mapped:=case price when 'pri_01m2mqgrjazqnz7wyex9p7dyt8' then 'STARTER' when 'pri_01m2mqs3q7f9r0kyqzmrt6gkgg' then 'PRO' end;
  if outcome='APPLIED' then
    if s.plan_code='INTERNAL' then outcome:='INTERNAL_WORKSPACE_BLOCKED';
    elsif mapped is null then outcome:='UNKNOWN_PRICE';
    elsif status is null or status not in ('active','past_due','paused','canceled','trialing') then outcome:='INVALID_STATUS';
    elsif not initial_binding and s.provider_customer_id is distinct from customer_id then outcome:='SUBSCRIPTION_CONFLICT';
    elsif not initial_binding and s.last_provider_event_occurred_at>=occurred then outcome:='STALE_EVENT';
    elsif not initial_binding and s.subscription_status='canceled' and status<>'canceled' then outcome:='INVALID_STATUS';
    end if;
  end if;
  if event_type='reconciliation' then
    if not private.is_org_owner(s.organization_id) then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
    if s.last_provider_event_id is distinct from target_expected_event_id or s.billing_operation_started_at>clock_timestamp()-interval '2 minutes' then outcome:='RECONCILE_CONFLICT'; end if;
  end if;
  if outcome='APPLIED' then
    if status='active' and ((target_event->>'period_start') is null or (target_event->>'period_end') is null or (target_event->>'period_end')::timestamptz<=(target_event->>'period_start')::timestamptz) then raise exception 'INVALID_PERIOD'; end if;
    if initial_binding then update public.billing_checkout_intents set consumed_at=clock_timestamp() where id=i.id; end if;
    update public.organization_subscriptions set
      provider='paddle_sandbox',provider_customer_id=customer_id,provider_subscription_id=subscription_id,provider_price_id=price,
      plan_code=mapped,subscription_status=case when status='trialing' then 'incomplete' else status end,
      provider_period_start=(target_event->>'period_start')::timestamptz,provider_period_end=(target_event->>'period_end')::timestamptz,
      provider_scheduled_action=target_event->>'scheduled_action',provider_scheduled_at=(target_event->>'scheduled_at')::timestamptz,
      cancel_at_period_end=coalesce(target_event->>'scheduled_action'='cancel',false),
      last_provider_event_id=event_id,last_provider_event_occurred_at=occurred,
      billing_operation_id=case when billing_operation_target=mapped or billing_operation_target='cancel' and target_event->>'scheduled_action'='cancel' or event_type='reconciliation' or status<>'active' then null else billing_operation_id end,
      billing_operation_target=case when billing_operation_target=mapped or billing_operation_target='cancel' and target_event->>'scheduled_action'='cancel' or event_type='reconciliation' or status<>'active' then null else billing_operation_target end,
      billing_operation_started_at=case when billing_operation_target=mapped or billing_operation_target='cancel' and target_event->>'scheduled_action'='cancel' or event_type='reconciliation' or status<>'active' then null else billing_operation_started_at end
    where organization_id=s.organization_id;
    if status='trialing' then outcome:='INVALID_STATUS'; end if;
  end if;
  update public.billing_event_receipts r set organization_id=s.organization_id,outcome=sync.outcome,processed_at=clock_timestamp() where r.event_id=sync.event_id;
  return outcome;
end; $$;

revoke all on function public.get_billing_subscription(uuid) from public,anon,authenticated;
revoke all on function public.create_billing_checkout_intent(text,uuid,text) from public,anon,authenticated;
revoke all on function public.begin_billing_operation(text,uuid,text) from public,anon,authenticated;
revoke all on function public.synchronize_paddle_subscription(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.get_billing_subscription(uuid),public.create_billing_checkout_intent(text,uuid,text),public.begin_billing_operation(text,uuid,text) to authenticated;
-- Public credential can invoke only this secret-authorized, bounded billing RPC.
grant execute on function public.synchronize_paddle_subscription(text,jsonb,text) to anon,authenticated;
grant select(provider,provider_period_end,provider_scheduled_action,provider_scheduled_at) on public.organization_subscriptions to authenticated;
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
  runtime_now timestamptz := clock_timestamp();
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

  -- Preserve the original usage-period anchor on activation and plan changes.
  -- After an expired period, commercial usage advances in monthly windows;
  -- no billing event rewrites prior usage rows or current trial eligibility.
  if selected_plan in ('STARTER','PRO') then
    while selected_period_end <= runtime_now loop
      selected_period_start := selected_period_end;
      selected_period_end := selected_period_start + interval '1 month';
    end loop;
  end if;

  if selected_plan = 'INTERNAL' then
    selected_period_start := date_trunc('month', runtime_now);
    selected_period_end := selected_period_start + interval '1 month';
    status_allows_usage := true;
  elsif selected_status = 'trialing' then
    status_allows_usage := selected_trial_end is not null
      and runtime_now < selected_trial_end
      and runtime_now >= selected_period_start
      and runtime_now < selected_period_end;
  elsif selected_status = 'active' then
    status_allows_usage := runtime_now >= selected_period_start
      and runtime_now < selected_period_end;
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
    and reservation_expires_at <= runtime_now;

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
        and usage_event.reservation_expires_at > runtime_now
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
          and usage_event.reservation_expires_at > runtime_now
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
    runtime_now + interval '15 minutes',
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


create or replace function public.get_organization_usage(target_organization_id uuid)
returns table (metric text, committed_usage bigint)
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
  into selected_plan, selected_period_start, selected_period_end
  from public.organization_subscriptions as subscription
  where subscription.organization_id = target_organization_id;

  if selected_plan is null then
    raise exception 'USAGE_SUBSCRIPTION_MISSING' using errcode = 'P0001';
  end if;

  -- Preserve the original usage-period anchor on activation and plan changes.
  -- After an expired period, commercial usage advances in monthly windows;
  -- no billing event rewrites prior usage rows or current trial eligibility.
  if selected_plan in ('STARTER','PRO') then
    while selected_period_end <= clock_timestamp() loop
      selected_period_start := selected_period_end;
      selected_period_end := selected_period_start + interval '1 month';
    end loop;
  end if;

  if selected_plan = 'INTERNAL' then
    selected_period_start := date_trunc('month', clock_timestamp());
    selected_period_end := selected_period_start + interval '1 month';
  end if;

  return query
  with metrics(metric) as (
    values
      ('IMPORTED_DEALS'::text),
      ('AI_ANALYSES'::text),
      ('AI_MAPPING_REQUESTS'::text),
      ('AUTO_CONVERT_ROWS'::text)
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


commit;
