-- Run the whole file. It is read-only apart from local role changes and always rolls back.
begin;

do $checks$
declare
  old_digest constant text := '0d092f687fa975007a0c40bbaf91cd60cafe6ba5da8d3b2d780da8297ef953f1';
  new_digest constant text := 'ec4a6b6cc5efdfc40ddcf991ecec133ca0e4364e705f29453d023aba6b91747f';
  expected constant text[] := array[
    'private.assert_analysis_runtime_authority',
    'private.assert_billing_authority',
    'public.commit_organization_usage',
    'public.reserve_organization_usage'
  ];
  actual text[];
  supplied text;
  invocation text;
  expected_error text;
  checks integer := 0;
begin
  select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname)
  into actual
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prokind = 'f'
    and n.nspname in ('public', 'private')
    and (
      position(old_digest in p.prosrc) > 0
      or position(new_digest in p.prosrc) > 0
      or p.prosrc ilike '%digest(%'
      or p.prosrc ilike '%sha256%'
    );

  if actual is distinct from expected then
    raise exception 'AUTHORITY_VERIFIER_SET_CHANGED';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname = any(expected)
      and (
        not p.prosecdef
        or not ('search_path=""' = any(p.proconfig))
        or position(old_digest in pg_get_functiondef(p.oid)) > 0
        or position(new_digest in pg_get_functiondef(p.oid)) = 0
      )
  ) then
    raise exception 'FINAL_AUTHORITY_FUNCTION_INVARIANT_FAILED';
  end if;

  foreach supplied in array array['random-authority-fixture', '', null::text] loop
    foreach invocation in array array[
      'select private.assert_analysis_runtime_authority($1,null)',
      'select private.assert_billing_authority($1)',
      'select public.reserve_organization_usage($1,null,''AI_ANALYSES'',1,''rotation-final-fixture'')',
      'select public.commit_organization_usage($1,null,''AI_ANALYSES'',''rotation-final-fixture'',null,1)'
    ] loop
      begin
        execute invocation using supplied;
        raise exception 'INVALID_AUTHORITY_ACCEPTED';
      exception when insufficient_privilege then
        get stacked diagnostics expected_error = message_text;
        if expected_error not in ('ANALYSIS_AUTHORITY_INVALID', 'AUTHORITY_REJECTED', 'USAGE_AUTHORITY_INVALID') then
          raise;
        end if;
        checks := checks + 1;
      end;
    end loop;
  end loop;

  if checks <> 12 then
    raise exception 'AUTHORITY_TEST_COUNT';
  end if;

  execute 'set local role authenticated';
  begin
    perform public.synchronize_paddle_subscription('random-authority-fixture', '{}'::jsonb);
    raise exception 'AUTHENTICATED_AUTHORITY_FABRICATION';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.organization_subscriptions set plan_code = 'PRO' where false;
    raise exception 'DIRECT_PLAN_WRITE_GRANTED';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.billing_event_receipts where false;
    raise exception 'DIRECT_BILLING_WRITE_GRANTED';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  execute 'set local role anon';
  begin
    perform public.synchronize_paddle_subscription('random-authority-fixture', '{}'::jsonb);
    raise exception 'ANONYMOUS_AUTHORITY_FABRICATION';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.billing_event_receipts(event_id, event_type, occurred_at, outcome)
    values ('evt_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'subscription.updated', now(), 'FABRICATED');
    raise exception 'ANONYMOUS_RECEIPT_FABRICATION';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end;
$checks$;

select '4_FINAL_VERIFIERS_12_INVALID_AUTHORITIES_AND_5_CLIENT_BOUNDARIES_PASS' as result;
rollback;
