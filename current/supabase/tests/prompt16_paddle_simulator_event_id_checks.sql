-- Run the whole file after the compatibility migration. All changes roll back.
begin;

-- Replace only the authority assertion inside this transaction so parser and
-- receipt behavior can be exercised without any real runtime secret.
create or replace function private.assert_billing_authority(secret text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if secret is distinct from 'prompt16-simulator-parser-proof' then
    raise exception 'AUTHORITY_REJECTED' using errcode = '42501';
  end if;
end;
$$;

do $checks$
declare
  base_event jsonb := jsonb_build_object(
    'event_type', 'subscription.updated',
    'occurred_at', clock_timestamp(),
    'subscription_id', 'sub_' || repeat('s', 26),
    'customer_id', 'ctm_' || repeat('c', 26),
    'price_id', 'pri_01m2mqgrjazqnz7wyex9p7dyt8',
    'status', 'active',
    'intent_id', null,
    'period_start', clock_timestamp(),
    'period_end', clock_timestamp() + interval '1 month',
    'scheduled_action', null,
    'scheduled_at', null
  );
  supplied_id text;
  outcome text;
  rejected integer := 0;
begin
  foreach supplied_id in array array[
    'evt_' || repeat('a', 26),
    'ntfsimevt_' || repeat('b', 26)
  ] loop
    outcome := public.synchronize_paddle_subscription(
      'prompt16-simulator-parser-proof',
      base_event || jsonb_build_object('event_id', supplied_id)
    );
    if outcome is distinct from 'MISSING_CHECKOUT_INTENT' then
      raise exception 'EXPECTED_SAFE_MISSING_INTENT_OUTCOME: %', supplied_id;
    end if;
    if not exists (
      select 1 from public.billing_event_receipts r
      where r.event_id = supplied_id and r.outcome = 'MISSING_CHECKOUT_INTENT'
    ) then
      raise exception 'EXACT_EVENT_ID_NOT_PERSISTED: %', supplied_id;
    end if;
  end loop;

  foreach supplied_id in array array[
    'ntfsim_' || repeat('a', 26),
    'ntfsimrun_' || repeat('a', 26),
    'ntf_' || repeat('a', 26),
    'evt_' || repeat('a', 25),
    'ntfsimevt_' || repeat('a', 27),
    'EVT_' || repeat('a', 26),
    'evt_' || repeat('a', 25) || '-',
    'arbitrary_' || repeat('a', 26),
    ''
  ] loop
    begin
      perform public.synchronize_paddle_subscription(
        'prompt16-simulator-parser-proof',
        base_event || jsonb_build_object('event_id', supplied_id)
      );
      raise exception 'MALFORMED_EVENT_ID_ACCEPTED: %', supplied_id;
    exception when invalid_parameter_value then
      rejected := rejected + 1;
    end;
  end loop;

  begin
    perform public.synchronize_paddle_subscription(
      'prompt16-simulator-parser-proof',
      base_event || jsonb_build_object('event_id', null)
    );
    raise exception 'NULL_EVENT_ID_ACCEPTED';
  exception when invalid_parameter_value then
    rejected := rejected + 1;
  end;

  if rejected <> 10 then raise exception 'EVENT_ID_REJECTION_COUNT: %', rejected; end if;
end;
$checks$;

select '2_VALID_EVENT_IDS_AND_10_INVALID_EVENT_IDS_PASS' as result;
rollback;
