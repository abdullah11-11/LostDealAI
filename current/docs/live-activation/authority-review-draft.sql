-- UNAPPLIED REVIEW DRAFT. NOT A MIGRATION. Never run against a persistent
-- environment without owner approval, current snapshot, generated migration,
-- reviewed real catalog/authority configuration, full gates and recovery plan.
-- Tested only in the in-memory isolated PostgreSQL fixture.
begin;

create table private.paddle_live_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  authority_sha256 text check(authority_sha256 ~ '^[a-f0-9]{64}$'),
  catalog_revision uuid,
  check(not enabled or (authority_sha256 is not null and catalog_revision is not null))
);
insert into private.paddle_live_settings(singleton) values(true);
create table private.paddle_live_catalog (
  revision uuid not null, plan_code text not null check(plan_code in ('STARTER','PRO')),
  price_id text not null check(price_id ~ '^pri_[a-z0-9]{26}$' and price_id not in ('pri_01m2mqgrjazqnz7wyex9p7dyt8','pri_01m2mqs3q7f9r0kyqzmrt6gkgg')),
  product_id text not null check(product_id ~ '^pro_[a-z0-9]{26}$'),
  amount integer not null, currency text not null check(currency='USD'),
  interval_unit text not null check(interval_unit='month'), frequency integer not null check(frequency=1),
  check((plan_code='STARTER' and amount=1500) or (plan_code='PRO' and amount=4500)),
  primary key(revision,plan_code), unique(revision,price_id), unique(revision,plan_code,price_id)
);
create table private.paddle_live_checkout_intents (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  catalog_revision uuid not null, plan_code text not null, price_id text not null,
  created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '30 minutes', consumed_at timestamptz,
  foreign key(catalog_revision,plan_code,price_id) references private.paddle_live_catalog(revision,plan_code,price_id)
);
create index paddle_live_intents_org_idx on private.paddle_live_checkout_intents(organization_id,expires_at);
create table private.paddle_live_event_receipts (
  event_id text primary key check(event_id ~ '^evt_[a-z0-9]{26}$'),
  event_type text not null check(event_type in ('subscription.created','subscription.updated','subscription.activated','subscription.past_due','subscription.paused','subscription.resumed','subscription.canceled','reconciliation')),
  occurred_at timestamptz not null, subscription_id text not null check(subscription_id ~ '^sub_[a-z0-9]{26}$'),
  organization_id uuid references public.organizations(id) on delete set null,
  outcome text not null check(outcome in ('PROCESSING','APPLIED','STALE_EVENT','UNKNOWN_PRICE','MISSING_CHECKOUT_INTENT','EXPIRED_CHECKOUT_INTENT','CONSUMED_CHECKOUT_INTENT','PLAN_PRICE_MISMATCH','SUBSCRIPTION_CONFLICT','UNKNOWN_SUBSCRIPTION','INTERNAL_WORKSPACE_BLOCKED','INVALID_STATUS','RECONCILE_CONFLICT')),
  processed_at timestamptz not null default clock_timestamp()
);
alter table private.paddle_live_settings enable row level security;
alter table private.paddle_live_catalog enable row level security;
alter table private.paddle_live_checkout_intents enable row level security;
alter table private.paddle_live_event_receipts enable row level security;
revoke all on private.paddle_live_settings,private.paddle_live_catalog,private.paddle_live_checkout_intents,private.paddle_live_event_receipts from public,anon,authenticated;

create function private.assert_live_billing_authority(secret text) returns void
language plpgsql security definer set search_path='' as $$
declare sandbox_authorized boolean:=false;
begin
  -- Distinct authority is enforced, including after future Sandbox rotation.
  -- Probe only the existing read-only verifier; unexpected failures stay closed.
  begin
    perform private.assert_billing_authority(secret); sandbox_authorized:=true;
  exception when sqlstate '42501' then
    if sqlerrm is distinct from 'AUTHORITY_REJECTED' then raise; end if;
  end;
  if secret is null or secret !~ '^[a-fA-F0-9]{64}$' or not exists(select 1 from private.paddle_live_settings
    where singleton and enabled and authority_sha256=encode(extensions.digest(secret,'sha256'),'hex')) or sandbox_authorized then
    raise exception 'LIVE_AUTHORITY_REJECTED' using errcode='42501';
  end if;
end; $$;
revoke all on function private.assert_live_billing_authority(text) from public,anon,authenticated;

create function public.get_live_billing_configuration(target_authority_secret text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare selected_revision uuid;
begin
  perform private.assert_live_billing_authority(target_authority_secret);
  select catalog_revision into selected_revision from private.paddle_live_settings where singleton;
  if (select count(*) from private.paddle_live_catalog c where c.revision=selected_revision) <> 2 then raise exception 'LIVE_CATALOG_REQUIRED'; end if;
  return jsonb_build_object('version',1,'environment','live','revision',selected_revision,
    'prices',(select jsonb_object_agg(plan_code,price_id) from private.paddle_live_catalog c where c.revision=selected_revision),
    'products',(select jsonb_object_agg(plan_code,product_id) from private.paddle_live_catalog c where c.revision=selected_revision));
end; $$;

create function public.create_live_billing_checkout_intent(target_authority_secret text,target_organization_id uuid,target_plan text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; i private.paddle_live_checkout_intents%rowtype; c private.paddle_live_catalog%rowtype; config jsonb;
begin
  config:=public.get_live_billing_configuration(target_authority_secret);
  if not private.is_org_owner(target_organization_id) then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  select * into s from public.organization_subscriptions where organization_id=target_organization_id for update;
  if not found or s.plan_code in ('INTERNAL','BUSINESS') then raise exception 'CHECKOUT_UNAVAILABLE'; end if;
  -- Never reclassify any Sandbox tenant. Live resubscribe retains history/usage.
  if ((s.provider is null and s.provider_customer_id is null and s.provider_subscription_id is null and s.plan_code='TRIAL')
    or (s.provider='paddle_live' and s.subscription_status='canceled')) is not true then raise exception 'SUBSCRIPTION_CONFLICT'; end if;
  if s.billing_operation_id is not null then raise exception 'BILLING_OPERATION_PENDING'; end if;
  select * into c from private.paddle_live_catalog where revision=(config->>'revision')::uuid and plan_code=target_plan;
  if not found then raise exception 'UNKNOWN_PRICE'; end if;
  select * into i from private.paddle_live_checkout_intents where organization_id=target_organization_id and consumed_at is null and expires_at>clock_timestamp() order by created_at desc limit 1;
  if found then
    if i.plan_code<>target_plan or i.catalog_revision<>c.revision then raise exception 'CHECKOUT_PENDING'; end if;
  else
    insert into private.paddle_live_checkout_intents(organization_id,catalog_revision,plan_code,price_id) values(target_organization_id,c.revision,target_plan,c.price_id) returning * into i;
  end if;
  return jsonb_build_object('intentId',i.id,'priceId',i.price_id,'expiresAt',i.expires_at);
end; $$;

-- Read-only ownership proof for an existing provider-fetched _ptxn transaction.
-- Does not create/consume an intent, reconcile a plan or alter usage/subscription.
create function public.verify_live_billing_payment_link(target_authority_secret text,target_organization_id uuid,target_transaction jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; config jsonb; intent text:=target_transaction->>'intent_id'; price text:=target_transaction->>'price_id';
begin
  config:=public.get_live_billing_configuration(target_authority_secret);
  if not private.is_org_owner(target_organization_id) then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  if target_transaction->>'environment' is distinct from 'live' or target_transaction->>'catalog_revision' is distinct from config->>'revision'
    or coalesce(target_transaction->>'transaction_id','') !~ '^txn_[a-z0-9]{26}$' or coalesce(target_transaction->>'customer_id','') !~ '^ctm_[a-z0-9]{26}$'
    or (target_transaction->>'subscription_id' is not null and target_transaction->>'subscription_id' !~ '^sub_[a-z0-9]{26}$')
    or coalesce(target_transaction->>'status','') not in ('ready','billed','past_due') or target_transaction->>'currency' is distinct from 'USD'
    or target_transaction->>'collection_mode' is distinct from 'automatic'
    or coalesce(target_transaction->>'origin','') not in ('web','api','subscription_recurring','subscription_update','subscription_payment_method_change')
    or not exists(select 1 from private.paddle_live_catalog c where c.revision=(config->>'revision')::uuid and c.price_id=price) then return false; end if;
  select * into s from public.organization_subscriptions where organization_id=target_organization_id;
  if not found or s.plan_code in ('INTERNAL','BUSINESS') then return false; end if;
  if s.provider='paddle_live' and s.subscription_status in ('active','past_due','paused')
    and s.provider_customer_id=target_transaction->>'customer_id' and s.provider_subscription_id=target_transaction->>'subscription_id' then return true; end if;
  if ((s.provider is null and s.provider_customer_id is null and s.provider_subscription_id is null and s.plan_code='TRIAL')
    or (s.provider='paddle_live' and s.subscription_status='canceled')) is not true or intent is null or intent !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then return false; end if;
  return exists(select 1 from private.paddle_live_checkout_intents i where i.id=intent::uuid and i.organization_id=target_organization_id
    and i.catalog_revision=(config->>'revision')::uuid and i.price_id=price and i.consumed_at is null and i.expires_at>clock_timestamp());
end; $$;

create function public.begin_live_billing_operation(target_authority_secret text,target_organization_id uuid,target_plan text) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.organization_subscriptions%rowtype; token uuid:=gen_random_uuid();
begin
  perform public.get_live_billing_configuration(target_authority_secret);
  if not private.is_org_owner(target_organization_id) then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  select * into s from public.organization_subscriptions where organization_id=target_organization_id for update;
  if not found or s.provider is distinct from 'paddle_live' or s.plan_code not in ('STARTER','PRO') or s.subscription_status<>'active' or s.provider_subscription_id is null then raise exception 'SUBSCRIPTION_CONFLICT'; end if;
  if target_plan is null or target_plan not in ('STARTER','PRO','cancel') or target_plan=s.plan_code then raise exception 'INVALID_PLAN_CHANGE'; end if;
  if s.billing_operation_id is not null or s.provider_scheduled_action is not null then raise exception 'BILLING_OPERATION_PENDING'; end if;
  update public.organization_subscriptions set billing_operation_id=token,billing_operation_started_at=clock_timestamp(),billing_operation_target=target_plan where organization_id=target_organization_id;
  return token;
end; $$;

create function public.abort_live_billing_operation(target_authority_secret text,target_organization_id uuid,target_operation_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare cleared integer;
begin
  perform private.assert_live_billing_authority(target_authority_secret);
  if not private.is_org_owner(target_organization_id) then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
  if target_operation_id is null then raise exception 'INVALID_BILLING_OPERATION' using errcode='22023'; end if;
  update public.organization_subscriptions set billing_operation_id=null,billing_operation_started_at=null,billing_operation_target=null
    where organization_id=target_organization_id and provider='paddle_live' and billing_operation_id=target_operation_id;
  get diagnostics cleared=row_count; return cleared=1;
end; $$;

create function public.synchronize_paddle_live_subscription(target_authority_secret text,target_event jsonb,target_expected_event_id text default null) returns text
language plpgsql security definer set search_path='' as $$
<<sync>>
declare
  s public.organization_subscriptions%rowtype; i private.paddle_live_checkout_intents%rowtype; config jsonb;
  event_id text:=target_event->>'event_id'; event_type text:=target_event->>'event_type';
  occurred timestamptz:=(target_event->>'occurred_at')::timestamptz;
  subscription_id text:=target_event->>'subscription_id'; customer_id text:=target_event->>'customer_id';
  price text:=target_event->>'price_id'; status text:=target_event->>'status';
  mapped text; outcome text:='APPLIED'; initial_binding boolean:=false;
begin
  config:=public.get_live_billing_configuration(target_authority_secret);
  if target_event->>'environment' is distinct from 'live' or target_event->>'catalog_revision' is distinct from config->>'revision'
    or event_id is null or event_id !~ '^evt_[a-z0-9]{26}$' or occurred is null or occurred>clock_timestamp()+interval '1 minute'
    or event_type is null or event_type not in ('subscription.created','subscription.updated','subscription.activated','subscription.past_due','subscription.paused','subscription.resumed','subscription.canceled','reconciliation')
    or subscription_id is null or subscription_id !~ '^sub_[a-z0-9]{26}$' or customer_id is null or customer_id !~ '^ctm_[a-z0-9]{26}$'
    or (target_event->>'scheduled_action' is not null and target_event->>'scheduled_action' not in ('cancel','pause','resume'))
    or ((target_event->>'scheduled_action' is null) <> (target_event->>'scheduled_at' is null)) then raise exception 'INVALID_EVENT' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('paddle-live-sub:'||subscription_id,0));
  insert into private.paddle_live_event_receipts(event_id,event_type,occurred_at,subscription_id,outcome) values(event_id,event_type,occurred,subscription_id,'PROCESSING') on conflict do nothing;
  if not found then return 'DUPLICATE_EVENT'; end if;
  select * into s from public.organization_subscriptions where provider='paddle_live' and provider_subscription_id=subscription_id for update;
  if not found then
    if event_type='reconciliation' then raise exception 'UNKNOWN_SUBSCRIPTION'; end if;
    select * into i from private.paddle_live_checkout_intents where id=(target_event->>'intent_id')::uuid;
    if not found then outcome:='MISSING_CHECKOUT_INTENT';
    else
      select * into s from public.organization_subscriptions where organization_id=i.organization_id for update;
      select * into i from private.paddle_live_checkout_intents where id=i.id for update;
      if s.organization_id is null then outcome:='UNKNOWN_SUBSCRIPTION';
      elsif s.plan_code in ('INTERNAL','BUSINESS') then outcome:='INTERNAL_WORKSPACE_BLOCKED';
      elsif i.consumed_at is not null then outcome:='CONSUMED_CHECKOUT_INTENT';
      elsif i.expires_at<=clock_timestamp() then outcome:='EXPIRED_CHECKOUT_INTENT';
      elsif i.price_id is distinct from price or i.catalog_revision::text is distinct from config->>'revision' then outcome:='PLAN_PRICE_MISMATCH';
      elsif ((s.provider is null and s.provider_customer_id is null and s.provider_subscription_id is null and s.plan_code='TRIAL')
        or (s.provider='paddle_live' and s.subscription_status='canceled')) is not true then outcome:='SUBSCRIPTION_CONFLICT';
      elsif status is distinct from 'active' then outcome:='INVALID_STATUS';
      else initial_binding:=true; end if;
    end if;
  end if;
  select plan_code into mapped from private.paddle_live_catalog where revision=(config->>'revision')::uuid and price_id=price;
  if outcome='APPLIED' then
    if s.plan_code in ('INTERNAL','BUSINESS') then outcome:='INTERNAL_WORKSPACE_BLOCKED';
    elsif mapped is null then outcome:='UNKNOWN_PRICE';
    elsif status is null or status not in ('active','past_due','paused','canceled') then outcome:='INVALID_STATUS';
    elsif not initial_binding and s.provider_customer_id is distinct from customer_id then outcome:='SUBSCRIPTION_CONFLICT';
    elsif not initial_binding and s.last_provider_event_occurred_at>=occurred then outcome:='STALE_EVENT';
    elsif not initial_binding and s.subscription_status='canceled' and status<>'canceled' then outcome:='INVALID_STATUS'; end if;
  end if;
  if event_type='reconciliation' then
    if not private.is_org_owner(s.organization_id) then raise exception 'BILLING_OWNER_REQUIRED' using errcode='42501'; end if;
    if s.last_provider_event_id is distinct from target_expected_event_id or s.billing_operation_started_at>clock_timestamp()-interval '2 minutes' then outcome:='RECONCILE_CONFLICT'; end if;
  end if;
  if outcome='APPLIED' then
    if status='active' and ((target_event->>'period_start') is null or (target_event->>'period_end') is null or (target_event->>'period_end')::timestamptz<=(target_event->>'period_start')::timestamptz) then raise exception 'INVALID_PERIOD'; end if;
    if initial_binding then update private.paddle_live_checkout_intents set consumed_at=clock_timestamp() where id=i.id; end if;
    update public.organization_subscriptions set provider='paddle_live',provider_customer_id=customer_id,provider_subscription_id=subscription_id,provider_price_id=price,
      plan_code=mapped,subscription_status=status,provider_period_start=(target_event->>'period_start')::timestamptz,provider_period_end=(target_event->>'period_end')::timestamptz,
      provider_scheduled_action=target_event->>'scheduled_action',provider_scheduled_at=(target_event->>'scheduled_at')::timestamptz,
      cancel_at_period_end=coalesce(target_event->>'scheduled_action'='cancel',false),last_provider_event_id=event_id,last_provider_event_occurred_at=occurred,
      billing_operation_id=case when billing_operation_target=mapped or billing_operation_target='cancel' and target_event->>'scheduled_action'='cancel' or event_type='reconciliation' or status<>'active' then null else billing_operation_id end,
      billing_operation_target=case when billing_operation_target=mapped or billing_operation_target='cancel' and target_event->>'scheduled_action'='cancel' or event_type='reconciliation' or status<>'active' then null else billing_operation_target end,
      billing_operation_started_at=case when billing_operation_target=mapped or billing_operation_target='cancel' and target_event->>'scheduled_action'='cancel' or event_type='reconciliation' or status<>'active' then null else billing_operation_started_at end
      where organization_id=s.organization_id;
  end if;
  update private.paddle_live_event_receipts r set organization_id=s.organization_id,outcome=sync.outcome,processed_at=clock_timestamp() where r.event_id=sync.event_id;
  return outcome;
end; $$;

revoke all on function public.get_live_billing_configuration(text),public.create_live_billing_checkout_intent(text,uuid,text),public.verify_live_billing_payment_link(text,uuid,jsonb),public.begin_live_billing_operation(text,uuid,text),public.abort_live_billing_operation(text,uuid,uuid),public.synchronize_paddle_live_subscription(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.get_live_billing_configuration(text),public.synchronize_paddle_live_subscription(text,jsonb,text) to anon,authenticated;
grant execute on function public.create_live_billing_checkout_intent(text,uuid,text),public.verify_live_billing_payment_link(text,uuid,jsonb),public.begin_live_billing_operation(text,uuid,text),public.abort_live_billing_operation(text,uuid,uuid) to authenticated;

-- Narrow forward replacement of four existing authority function predicates.
-- No historical file, secret verifier, ACL, owner or other function body changes.
do $extend$
declare signature text; before_def text; after_def text; predicate text; replacement text; acl aclitem[]; owner_id oid; settings text[]; before_hash text; expected_hash text;
begin
  foreach signature in array array['public.persist_deal_import(text,uuid,uuid,text,text,integer,integer,jsonb,boolean)','public.claim_analysis_run(text,uuid,uuid,text,uuid)','public.create_billing_checkout_intent(text,uuid,text)','public.synchronize_paddle_subscription(text,jsonb,text)'] loop
    if signature like 'public.persist_deal_import%' then predicate:='provider=''paddle_sandbox'''; replacement:='provider in (''paddle_sandbox'',''paddle_live'')'; expected_hash:='7b919caef4f0b7190d80d7a67a119fe54f0ff918344fe039a4b9d1a05f18700a';
    elsif signature like 'public.claim_analysis_run%' then predicate:='sub.provider=''paddle_sandbox'''; replacement:='sub.provider in (''paddle_sandbox'',''paddle_live'')'; expected_hash:='6b5e915a5b1e43fc7479121c90aefeeb4b129bb3db12cc1b44242960cf878468';
    elsif signature like 'public.create_billing_checkout_intent%' then predicate:='if not found or s.plan_code=''INTERNAL'''; replacement:='if not found or s.provider=''paddle_live'' or s.plan_code=''INTERNAL'''; expected_hash:='6d4c6acd7703c9a7a67d5d17548a27767625845da451ab42c59069e1ceead470';
    else predicate:='elsif i.consumed_at is not null then'; replacement:='elsif s.provider=''paddle_live'' then outcome:=''SUBSCRIPTION_CONFLICT''; elsif i.consumed_at is not null then'; expected_hash:='8b1adfdcc1e6dec324f6b6759dc7ec4ca95bd16f39c36647fd93f4f04d55bfda'; end if;
    select pg_get_functiondef(p.oid),p.proacl,p.proowner,p.proconfig,encode(extensions.digest(p.prosrc,'sha256'),'hex') into before_def,acl,owner_id,settings,before_hash from pg_proc p where p.oid=signature::regprocedure and p.prosecdef;
    if before_def is null or before_hash is distinct from expected_hash or not ('search_path=""'=any(settings)) or (length(before_def)-length(replace(before_def,predicate,'')))/length(predicate)<>1 then raise exception 'LIVE_USAGE_EXTENSION_PRECONDITION_FAILED'; end if;
    after_def:=replace(before_def,predicate,replacement); execute after_def;
    if not exists(select 1 from pg_proc p where p.oid=signature::regprocedure and p.proacl is not distinct from acl and p.proowner=owner_id and p.prosecdef and p.proconfig is not distinct from settings)
      or pg_get_functiondef(signature::regprocedure) is distinct from after_def then raise exception 'LIVE_USAGE_EXTENSION_INVARIANT_CHANGED'; end if;
  end loop;
end;
$extend$;
commit;
