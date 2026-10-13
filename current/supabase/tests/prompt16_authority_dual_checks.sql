-- Run the whole file. No real authority secret is available or required.
begin;
do $checks$
declare
  supplied text;
  invocation text;
  expected_error text;
  checks integer:=0;
begin
  foreach supplied in array array['random-authority-fixture','',null::text] loop
    foreach invocation in array array[
      'select private.assert_analysis_runtime_authority($1,null)',
      'select private.assert_billing_authority($1)',
      'select public.reserve_organization_usage($1,null,''AI_ANALYSES'',1,''rotation-fixture'')',
      'select public.commit_organization_usage($1,null,''AI_ANALYSES'',''rotation-fixture'',null,1)'
    ] loop
      begin
        execute invocation using supplied;
        raise exception 'INVALID_AUTHORITY_ACCEPTED';
      exception when insufficient_privilege then
        get stacked diagnostics expected_error=message_text;
        if expected_error not in ('ANALYSIS_AUTHORITY_INVALID','AUTHORITY_REJECTED','USAGE_AUTHORITY_INVALID') then raise; end if;
        checks:=checks+1;
      end;
    end loop;
  end loop;
  if checks<>12 then raise exception 'AUTHORITY_TEST_COUNT'; end if;
  execute 'set local role authenticated';
  begin
    perform public.synchronize_paddle_subscription('random-authority-fixture','{}'::jsonb);
    raise exception 'CLIENT_AUTHORITY_FABRICATION';
  exception when insufficient_privilege then null; end;
  begin
    update public.organization_subscriptions set plan_code='PRO' where false;
    raise exception 'DIRECT_PLAN_WRITE_GRANTED';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.billing_event_receipts where false;
    raise exception 'DIRECT_BILLING_WRITE_GRANTED';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end;
$checks$;
select '12_INVALID_AUTHORITY_AND_3_CLIENT_BOUNDARY_CHECKS_PASS' as result;
rollback;
