begin;
-- Execute AFTER the Prompt 16 migration. This file owns a rollback-only transaction.
-- Do not remove its BEGIN/ROLLBACK: the synthetic authority replacement must never persist.
-- No provider calls, real customer rows, or credentials are used.
do $$ begin
  begin perform public.synchronize_paddle_subscription('invalid','{}'::jsonb);
    raise exception 'invalid authority accepted';
  exception when insufficient_privilege then null; end;
  if has_table_privilege('anon','public.billing_event_receipts','INSERT') or
     has_table_privilege('authenticated','public.billing_event_receipts','INSERT') or
     has_table_privilege('authenticated','public.billing_checkout_intents','UPDATE') or
     has_column_privilege('authenticated','public.organization_subscriptions','plan_code','UPDATE') then
    raise exception 'direct billing mutation permitted'; end if;
  if not has_function_privilege('anon','public.synchronize_paddle_subscription(text,jsonb,text)','EXECUTE') then raise exception 'webhook RPC unreachable'; end if;
end $$;
create or replace function private.assert_billing_authority(secret text) returns void
language plpgsql security definer set search_path='' as $$ begin
  if secret is distinct from 'p16-synthetic-test-only' then raise exception 'AUTHORITY_REJECTED' using errcode='42501'; end if;
end $$;

do $$
declare uid uuid; org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); intent jsonb; ev jsonb; result text;
  anchor_start timestamptz; anchor_end timestamptz; trial_end timestamptz; before_usage jsonb; n integer;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then raise exception 'test requires an existing owner identity'; end if;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  insert into public.organizations(id,name,industry,created_by) values(org,'Synthetic Billing Rollback QA','Other',uid),(other_org,'Synthetic Cross Org Rollback QA','Other',uid);
  insert into public.organization_members(organization_id,user_id,role) values(org,uid,'owner');
  select current_period_start,current_period_end,trial_ends_at into anchor_start,anchor_end,trial_end from public.organization_subscriptions where organization_id=org;
  execute 'set local role authenticated';
  if public.get_billing_subscription(org)->>'organization_id' <> org::text then raise exception 'owner read failed'; end if;
  begin perform public.get_billing_subscription(other_org); raise exception 'cross org read accepted'; exception when insufficient_privilege then null; end;
  begin update public.organization_subscriptions set plan_code='PRO' where organization_id=org; raise exception 'direct plan write accepted'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.billing_checkout_intents; raise exception 'intent table exposed'; exception when insufficient_privilege then null; end;
  execute 'reset role';

  begin perform public.create_billing_checkout_intent('p16-synthetic-test-only',other_org,'PRO'); raise exception 'cross org accepted'; exception when insufficient_privilege then null; end;
  update public.organization_members set role='member' where organization_id=org;
  begin perform public.create_billing_checkout_intent('p16-synthetic-test-only',org,'PRO'); raise exception 'member accepted'; exception when insufficient_privilege then null; end;
  update public.organization_members set role='owner' where organization_id=org;
  update public.organization_subscriptions set plan_code='INTERNAL' where organization_id=org;
  begin perform public.create_billing_checkout_intent('p16-synthetic-test-only',org,'PRO'); raise exception 'internal accepted'; exception when raise_exception then if sqlerrm<>'CHECKOUT_UNAVAILABLE' then raise; end if; end;
  update public.organization_subscriptions set plan_code='TRIAL' where organization_id=org;
  intent:=public.create_billing_checkout_intent('p16-synthetic-test-only',org,'STARTER');
  if public.create_billing_checkout_intent('p16-synthetic-test-only',org,'STARTER')->>'intentId' <> intent->>'intentId' then raise exception 'concurrent intent not reused'; end if;
  if (intent->>'expiresAt')::timestamptz>clock_timestamp()+interval '30 minutes' then raise exception 'expiry invalid'; end if;
  insert into public.organization_usage_events(organization_id,metric,idempotency_key,units,status,period_start,period_end,committed_at)
    select org,metric,'p16-synthetic-'||metric,2,'committed',anchor_start,anchor_end,clock_timestamp() from unnest(array['IMPORTED_DEALS','AI_ANALYSES','AI_MAPPING_REQUESTS','AUTO_CONVERT_ROWS']) metric;
  select jsonb_agg(to_jsonb(u) order by metric) into before_usage from public.organization_usage_events u where organization_id=org;
  ev:=jsonb_build_object('event_id','evt_'||repeat('a',26),'event_type','subscription.created','occurred_at',clock_timestamp()-interval '20 seconds',
    'subscription_id','sub_'||repeat('a',26),'customer_id','ctm_'||repeat('a',26),'price_id','pri_01m2mqgrjazqnz7wyex9p7dyt8','status','active',
    'intent_id',intent->>'intentId','period_start',clock_timestamp(),'period_end',clock_timestamp()+interval '1 month','scheduled_action',null,'scheduled_at',null);
  result:=public.synchronize_paddle_subscription('p16-synthetic-test-only',ev);
  if result<>'APPLIED' then raise exception 'initial binding failed %',result; end if;
  if public.synchronize_paddle_subscription('p16-synthetic-test-only',ev)<>'DUPLICATE_EVENT' then raise exception 'duplicate failed'; end if;
  ev:=ev||jsonb_build_object('event_id','evt_'||repeat('b',26),'occurred_at',clock_timestamp()-interval '30 seconds','status','past_due');
  if public.synchronize_paddle_subscription('p16-synthetic-test-only',ev)<>'STALE_EVENT' then raise exception 'stale failed'; end if;
  begin perform public.create_billing_checkout_intent('p16-synthetic-test-only',org,'PRO'); raise exception 'second subscription allowed'; exception when raise_exception then if sqlerrm<>'SUBSCRIPTION_CONFLICT' then raise; end if; end;
  ev:=ev||jsonb_build_object('event_id','evt_'||repeat('c',26),'event_type','subscription.updated','occurred_at',clock_timestamp()-interval '19 seconds','status','active','price_id','pri_01m2mqs3q7f9r0kyqzmrt6gkgg','intent_id',null);
  perform public.begin_billing_operation('p16-synthetic-test-only',org,'PRO');
  begin perform public.begin_billing_operation('p16-synthetic-test-only',org,'PRO'); raise exception 'duplicate mutation allowed'; exception when raise_exception then if sqlerrm<>'BILLING_OPERATION_PENDING' then raise; end if; end;
  if public.synchronize_paddle_subscription('p16-synthetic-test-only',ev)<>'APPLIED' then raise exception 'upgrade failed'; end if;
  for n in 1..5 loop
    ev:=ev||jsonb_build_object('event_id','evt_'||repeat((n+1)::text,26),'occurred_at',clock_timestamp()-(18-n)*interval '1 second',
      'status',case n when 1 then 'past_due' when 2 then 'active' when 3 then 'paused' when 4 then 'active' else 'active' end,
      'price_id',case when n=5 then 'pri_01m2mqgrjazqnz7wyex9p7dyt8' else 'pri_01m2mqs3q7f9r0kyqzmrt6gkgg' end);
    if public.synchronize_paddle_subscription('p16-synthetic-test-only',ev)<>'APPLIED' then raise exception 'lifecycle failed %',n; end if;
  end loop;
  ev:=ev||jsonb_build_object('event_id','evt_'||repeat('d',26),'occurred_at',clock_timestamp()-interval '10 seconds','scheduled_action','cancel','scheduled_at',clock_timestamp()+interval '1 month');
  if public.synchronize_paddle_subscription('p16-synthetic-test-only',ev)<>'APPLIED' then raise exception 'scheduled cancel failed'; end if;
  if (select subscription_status from public.organization_subscriptions where organization_id=org)<>'active' then raise exception 'canceled too soon'; end if;
  ev:=ev||jsonb_build_object('event_id','evt_'||repeat('e',26),'occurred_at',clock_timestamp()-interval '9 seconds','status','canceled','scheduled_action',null,'scheduled_at',null);
  if public.synchronize_paddle_subscription('p16-synthetic-test-only',ev)<>'APPLIED' then raise exception 'cancel failed'; end if;
  if (select plan_code from public.organization_subscriptions where organization_id=org)='TRIAL' then raise exception 'trial reset'; end if;
  if exists(select 1 from public.organization_subscriptions where organization_id=org and (current_period_start<>anchor_start or current_period_end<>anchor_end or trial_ends_at<>trial_end)) then raise exception 'usage/trial period changed'; end if;
  if before_usage is distinct from (select jsonb_agg(to_jsonb(u) order by metric) from public.organization_usage_events u where organization_id=org) then raise exception 'usage reset'; end if;
  ev:=ev||jsonb_build_object('event_id','evt_'||repeat('f',26),'occurred_at',clock_timestamp()-interval '8 seconds','subscription_id','sub_'||repeat('b',26),'intent_id',intent->>'intentId');
  if public.synchronize_paddle_subscription('p16-synthetic-test-only',ev)<>'CONSUMED_CHECKOUT_INTENT' then raise exception 'intent replay accepted'; end if;
end $$;
select 'PROMPT16_ROLLBACK_BILLING_PROOF_PASS' as result;

rollback;
