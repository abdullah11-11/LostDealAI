-- Prompt 17A: atomic import/provider outcomes, narrow write authority, fenced analysis leases.
-- Existing migrations, subscription rows, usage history and tenant data remain immutable.
begin;

alter table public.uploads add column request_fingerprint text
  check (request_fingerprint is null or request_fingerprint ~ '^[a-f0-9]{64}$');

create table public.provider_operation_results (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_key text not null check (length(operation_key) between 1 and 200),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  metric text not null check (metric in ('AI_MAPPING_REQUESTS','AUTO_CONVERT_ROWS')),
  result jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 12582912),
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, operation_key)
);
alter table public.provider_operation_results enable row level security;
revoke all on public.provider_operation_results from public, anon, authenticated;
grant select on public.provider_operation_results to authenticated;
create policy provider_operation_results_select_member on public.provider_operation_results
  for select to authenticated using (private.is_org_member(organization_id));

create table private.analysis_run_claims (
  organization_id uuid not null,
  deal_id uuid not null,
  claim_token uuid not null,
  mode text not null check (mode in ('STANDARD','DEEP')),
  expires_at timestamptz not null,
  primary key (organization_id, deal_id),
  foreign key (organization_id, deal_id) references public.deals(organization_id,id) on delete cascade
);
alter table private.analysis_run_claims enable row level security;
revoke all on private.analysis_run_claims from public, anon, authenticated;

-- Table revocation alone does not remove historical column grants.
do $$
declare relation_name text; columns_list text;
begin
  foreach relation_name in array array['deals','uploads'] loop
    select string_agg(quote_ident(attname), ', ') into columns_list
      from pg_attribute where attrelid = ('public.' || relation_name)::regclass
      and attnum > 0 and not attisdropped;
    execute format('revoke insert, update on public.%I from public, anon, authenticated', relation_name);
    execute format('revoke insert (%s), update (%s) on public.%I from public, anon, authenticated',
      columns_list, columns_list, relation_name);
  end loop;
end;
$$;
-- Event triggers run as their owner; ordinary clients need no execution grant.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create or replace function public.commit_organization_usage(
  target_authority_secret text, target_organization_id uuid, target_metric text,
  target_idempotency_key text, target_reservation_token uuid, target_committed_units integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare existing public.organization_usage_events%rowtype;
begin
  perform private.assert_analysis_runtime_authority(target_authority_secret, target_organization_id);
  if target_metric not in ('IMPORTED_DEALS','AI_ANALYSES','AI_MAPPING_REQUESTS','AUTO_CONVERT_ROWS')
    or target_committed_units is null or target_committed_units < 1 then
    raise exception 'USAGE_COMMIT_INVALID' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_metric || ':' || target_idempotency_key,0));
  select * into existing from public.organization_usage_events
    where organization_id=target_organization_id and metric=target_metric
      and idempotency_key=target_idempotency_key for update;
  if existing.reservation_token is distinct from target_reservation_token
    or existing.units < target_committed_units then return false; end if;
  if existing.status='committed' then return existing.units=target_committed_units; end if;
  if existing.status not in ('reserved','expired') then return false; end if;
  update public.organization_usage_events set units=target_committed_units, status='committed',
    committed_at=clock_timestamp(),reservation_expires_at=null where id=existing.id;
  return found;
end; $$;

create function public.release_unused_usage(
  target_authority_secret text, target_organization_id uuid, target_metric text,
  target_idempotency_key text, target_reservation_token uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_analysis_runtime_authority(target_authority_secret,target_organization_id);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_metric || ':' || target_idempotency_key,0));
  -- Never refunds committed work; releases only this caller's unused reservation.
  delete from public.organization_usage_events where organization_id=target_organization_id
    and metric=target_metric and idempotency_key=target_idempotency_key
    and reservation_token=target_reservation_token and status in ('reserved','expired')
    and not exists (select 1 from public.deal_analyses a where a.organization_id=target_organization_id
      and a.analysis_usage_key=target_idempotency_key and a.analysis_usage_status='PENDING');
  return found;
end; $$;

create function public.persist_deal_import(
  target_authority_secret text, target_organization_id uuid, target_upload_id uuid,
  target_fingerprint text, target_filename text, target_total_rows integer,
  target_skipped_rows integer, target_rows jsonb, target_enforced boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing public.uploads%rowtype; reservation record; row_count integer; provider_enforced boolean;
begin
  perform private.assert_analysis_runtime_authority(target_authority_secret,target_organization_id);
  if target_upload_id is null or target_fingerprint is null or target_fingerprint !~ '^[a-f0-9]{64}$'
    or target_filename is null or length(target_filename) not between 1 and 255
    or jsonb_typeof(target_rows) is distinct from 'array'
    or target_total_rows is null or target_skipped_rows is null or target_skipped_rows < 0
    or target_enforced is null then raise exception 'IMPORT_INPUT_INVALID' using errcode='22023'; end if;
  row_count := jsonb_array_length(target_rows);
  if row_count not between 1 and 2000 or target_total_rows <> row_count + target_skipped_rows
    then raise exception 'IMPORT_COUNTS_INVALID' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements(target_rows) r where jsonb_typeof(r) <> 'object'
    or r - array['external_deal_id','customer_name','deal_value','quote_date','salesperson','service_type','lead_source','sales_notes','transcript'] <> '{}'::jsonb)
    then raise exception 'IMPORT_FIELDS_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':import:' || target_upload_id::text,0));
  select * into existing from public.uploads where id=target_upload_id;
  if found then
    if existing.organization_id <> target_organization_id
      or existing.request_fingerprint is distinct from target_fingerprint or existing.status <> 'completed'
      then raise exception 'IMPORT_OPERATION_CONFLICT' using errcode='23505'; end if;
    return jsonb_build_object('uploadId',existing.id,'filename',existing.filename,'totalRows',existing.total_rows,
      'insertedCount',existing.valid_rows,'invalidRows',existing.invalid_rows,'createdAt',existing.created_at);
  end if;
  select provider='paddle_sandbox' into provider_enforced from public.organization_subscriptions where organization_id=target_organization_id;
  select * into reservation from public.reserve_organization_usage(target_authority_secret,target_organization_id,
    'IMPORTED_DEALS',row_count,'import:' || target_upload_id::text);
  if not reservation.is_new or reservation.reservation_token is null then
    raise exception 'IMPORT_OPERATION_CONFLICT' using errcode='23505'; end if;
  if (target_enforced or coalesce(provider_enforced,false)) and not reservation.allowed then
    raise exception 'IMPORT_QUOTA_EXCEEDED' using errcode='P0001'; end if;
  insert into public.uploads(id,organization_id,created_by,filename,total_rows,valid_rows,invalid_rows,status,request_fingerprint)
    values(target_upload_id,target_organization_id,auth.uid(),target_filename,target_total_rows,row_count,target_skipped_rows,'completed',target_fingerprint)
    returning * into existing;
  insert into public.deals(organization_id,upload_id,external_deal_id,customer_name,deal_value,quote_date,
    status,salesperson,service_type,lead_source,sales_notes,transcript)
    select target_organization_id,target_upload_id,r.external_deal_id,r.customer_name,r.deal_value,r.quote_date,
      'lost',r.salesperson,r.service_type,r.lead_source,r.sales_notes,r.transcript
    from jsonb_to_recordset(target_rows) as r(external_deal_id text,customer_name text,deal_value numeric,quote_date date,
      salesperson text,service_type text,lead_source text,sales_notes text,transcript text);
  if not public.commit_organization_usage(target_authority_secret,target_organization_id,'IMPORTED_DEALS',
    'import:' || target_upload_id::text,reservation.reservation_token,row_count) then
    raise exception 'IMPORT_USAGE_COMMIT_FAILED' using errcode='P0001'; end if;
  return jsonb_build_object('uploadId',existing.id,'filename',existing.filename,'totalRows',existing.total_rows,
    'insertedCount',existing.valid_rows,'invalidRows',existing.invalid_rows,'createdAt',existing.created_at);
end; $$;

create function public.persist_provider_operation(
  target_authority_secret text, target_organization_id uuid, target_operation_key text,
  target_fingerprint text, target_metric text, target_reservation_token uuid,
  target_units integer, target_result jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare existing public.provider_operation_results%rowtype;
begin
  perform private.assert_analysis_runtime_authority(target_authority_secret,target_organization_id);
  if target_fingerprint is null or target_fingerprint !~ '^[a-f0-9]{64}$'
    or target_metric not in ('AI_MAPPING_REQUESTS','AUTO_CONVERT_ROWS')
    or target_units is null or target_units not between 0 and 10000
    or jsonb_typeof(target_result) is distinct from 'object'
    or octet_length(target_result::text)>12582912 then
    raise exception 'PROVIDER_OPERATION_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':provider:' || target_operation_key,0));
  select * into existing from public.provider_operation_results
    where organization_id=target_organization_id and operation_key=target_operation_key;
  if found then
    if existing.request_fingerprint<>target_fingerprint or existing.metric<>target_metric then
      raise exception 'PROVIDER_OPERATION_CONFLICT' using errcode='23505'; end if;
    return existing.result;
  end if;
  if target_units>0 then
    if not public.commit_organization_usage(target_authority_secret,target_organization_id,target_metric,
      target_operation_key,target_reservation_token,target_units) then
      raise exception 'PROVIDER_USAGE_COMMIT_FAILED' using errcode='P0001'; end if;
  elsif target_reservation_token is not null then
    perform public.release_unused_usage(target_authority_secret,target_organization_id,target_metric,target_operation_key,target_reservation_token);
  end if;
  insert into public.provider_operation_results(organization_id,operation_key,request_fingerprint,metric,result)
    values(target_organization_id,target_operation_key,target_fingerprint,target_metric,target_result);
  return target_result;
end; $$;

create function public.claim_analysis_run(
  target_authority_secret text, target_organization_id uuid, target_deal_id uuid,
  target_mode text, target_claim_token uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
declare active_claim private.analysis_run_claims%rowtype; deal_status text; deal_changed_at timestamptz; sub public.organization_subscriptions%rowtype;
begin
  perform private.assert_analysis_runtime_authority(target_authority_secret,target_organization_id);
  if target_mode not in ('STANDARD','DEEP') or target_claim_token is null then
    raise exception 'ANALYSIS_CLAIM_INVALID' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_deal_id::text,0));
  select * into sub from public.organization_subscriptions where organization_id=target_organization_id;
  if sub.provider='paddle_sandbox' and sub.subscription_status <> 'active' then return false; end if;
  if target_mode='DEEP' and sub.plan_code not in ('INTERNAL','PRO','TRIAL') then return false; end if;
  select analysis_status,updated_at into deal_status,deal_changed_at from public.deals where organization_id=target_organization_id and id=target_deal_id for update;
  if not found or (deal_status='completed' and target_mode='STANDARD') then return false; end if;
  select * into active_claim from private.analysis_run_claims where organization_id=target_organization_id and deal_id=target_deal_id;
  if found and active_claim.expires_at>clock_timestamp() then return false; end if;
  if not found and deal_status='processing' and deal_changed_at>clock_timestamp()-interval '15 minutes' then return false; end if;
  insert into private.analysis_run_claims(organization_id,deal_id,claim_token,mode,expires_at)
    values(target_organization_id,target_deal_id,target_claim_token,target_mode,clock_timestamp()+interval '15 minutes')
    on conflict(organization_id,deal_id) do update set claim_token=excluded.claim_token,mode=excluded.mode,expires_at=excluded.expires_at;
  update public.deals set analysis_status='processing',analysis_error=null,analysis_error_detail=null,requested_analysis_mode=target_mode
    where organization_id=target_organization_id and id=target_deal_id;
  return true;
end; $$;

create function public.recover_analysis_run(
  target_authority_secret text, target_organization_id uuid, target_deal_id uuid
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_analysis_runtime_authority(target_authority_secret,target_organization_id);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_deal_id::text,0));
  if exists(select 1 from private.analysis_run_claims where organization_id=target_organization_id
    and deal_id=target_deal_id and expires_at>clock_timestamp()) then return false; end if;
  update public.deals set analysis_status='failed',analysis_error='ANALYSIS_FAILED',analysis_error_detail='provider_unavailable'
    where organization_id=target_organization_id and id=target_deal_id and analysis_status='processing'
      and (exists (select 1 from private.analysis_run_claims c where c.organization_id=target_organization_id
        and c.deal_id=target_deal_id and c.expires_at<=clock_timestamp())
        or (updated_at<clock_timestamp()-interval '15 minutes' and not exists (
          select 1 from private.analysis_run_claims c where c.organization_id=target_organization_id and c.deal_id=target_deal_id)));
  if not found then return false; end if;
  delete from private.analysis_run_claims where organization_id=target_organization_id and deal_id=target_deal_id;
  return true;
end; $$;

create function public.fail_analysis_run(
  target_authority_secret text, target_organization_id uuid, target_deal_id uuid,
  target_claim_token uuid, target_mode text, target_error_code text, target_error_detail text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_analysis_runtime_authority(target_authority_secret,target_organization_id);
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_deal_id::text,0));
  if not exists(select 1 from private.analysis_run_claims where organization_id=target_organization_id
    and deal_id=target_deal_id and claim_token=target_claim_token and mode=target_mode) then return false; end if;
  if not public.transition_deal_analysis(target_authority_secret,target_organization_id,target_deal_id,
    'FAIL_' || target_mode,target_error_code,target_error_detail) then return false; end if;
  delete from private.analysis_run_claims where organization_id=target_organization_id and deal_id=target_deal_id;
  return true;
end; $$;

revoke all on function public.persist_deal_import(text,uuid,uuid,text,text,integer,integer,jsonb,boolean),
 public.persist_provider_operation(text,uuid,text,text,text,uuid,integer,jsonb),
 public.release_unused_usage(text,uuid,text,text,uuid),
 public.claim_analysis_run(text,uuid,uuid,text,uuid),
 public.recover_analysis_run(text,uuid,uuid),
 public.fail_analysis_run(text,uuid,uuid,uuid,text,text,text) from public,anon;
grant execute on function public.persist_deal_import(text,uuid,uuid,text,text,integer,integer,jsonb,boolean),
 public.persist_provider_operation(text,uuid,text,text,text,uuid,integer,jsonb),
 public.release_unused_usage(text,uuid,text,text,uuid),
 public.claim_analysis_run(text,uuid,uuid,text,uuid),
 public.recover_analysis_run(text,uuid,uuid),
 public.fail_analysis_run(text,uuid,uuid,uuid,text,text,text) to authenticated;

create or replace function public.persist_deal_analysis(
  target_authority_secret text,
  target_organization_id uuid,
  target_deal_id uuid,
  target_analysis jsonb,
  target_analysis_mode text,
  target_schema_version text,
  target_deep_analysis jsonb,
  target_deep_analyzed_at timestamptz,
  target_model_metadata jsonb,
  target_usage_key text,
  target_usage_required boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer := 0;
  selected_usage_status text := case when target_usage_required then 'PENDING' else 'LEGACY' end;
begin
  perform private.assert_analysis_runtime_authority(
    target_authority_secret,
    target_organization_id
  );

  if jsonb_typeof(target_analysis) <> 'object'
    or not target_analysis ?& array[
      'lost_reason', 'lost_reason_detail', 'buying_intent_score',
      'confidence_score', 'evidence', 'positive_signals', 'negative_signals',
      'recommended_action', 'recommended_timing', 'recommended_channel',
      'follow_up_message'
    ]
    or target_analysis - array[
      'lost_reason', 'lost_reason_detail', 'buying_intent_score',
      'confidence_score', 'evidence', 'positive_signals', 'negative_signals',
      'recommended_action', 'recommended_timing', 'recommended_channel',
      'follow_up_message'
    ] <> '{}'::jsonb
    or jsonb_typeof(target_model_metadata) <> 'object' then
    raise exception 'ANALYSIS_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  if target_analysis_mode = 'STANDARD' then
    if target_schema_version <> 'standard-1.0'
      or target_deep_analysis is not null
      or target_deep_analyzed_at is not null
      or (target_usage_key is not null and target_usage_key <> 'analysis:' || target_deal_id::text) then
      raise exception 'STANDARD_ANALYSIS_PAYLOAD_INVALID' using errcode = '22023';
    end if;
  elsif target_analysis_mode = 'DEEP' then
    if target_schema_version <> 'deep-1.0'
      or jsonb_typeof(target_deep_analysis) <> 'object'
      or target_deep_analyzed_at is null
      or (
        target_usage_key is not null
        and target_usage_key not like ('deep-analysis:' || target_deal_id::text || ':%')
      ) then
      raise exception 'DEEP_ANALYSIS_PAYLOAD_INVALID' using errcode = '22023';
    end if;
  else
    raise exception 'ANALYSIS_MODE_INVALID' using errcode = '22023';
  end if;

  if target_usage_required is null
    or (target_usage_required and (target_usage_key is null or length(target_usage_key) not between 1 and 200))
    or (not target_usage_required and target_usage_key is not null) then
    raise exception 'ANALYSIS_USAGE_KEY_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':' || target_deal_id::text, 0)
  );

  if not exists (
    select 1 from public.deals as deal
    where deal.organization_id = target_organization_id
      and deal.id = target_deal_id
      and deal.analysis_status = 'processing'
  ) then
    return false;
  end if;

  if not exists (
    select 1 from private.analysis_run_claims c
    where c.organization_id=target_organization_id and c.deal_id=target_deal_id
      and c.claim_token::text=target_model_metadata->>'runtime_claim_id'
      and c.mode=target_analysis_mode and c.expires_at>clock_timestamp()
  ) then return false; end if;

  insert into public.deal_analyses (
    organization_id, deal_id, lost_reason, lost_reason_detail,
    buying_intent_score, recovery_score, confidence_score,
    recovery_priority, score_explanation, evidence, positive_signals,
    negative_signals, recommended_action, recommended_timing,
    recommended_channel, follow_up_message, model_metadata,
    analysis_mode, analysis_schema_version, deep_analysis, deep_analyzed_at,
    analysis_usage_key, analysis_usage_status
  ) values (
    target_organization_id,
    target_deal_id,
    target_analysis ->> 'lost_reason',
    target_analysis ->> 'lost_reason_detail',
    (target_analysis ->> 'buying_intent_score')::integer,
    null,
    (target_analysis ->> 'confidence_score')::integer,
    null,
    null,
    target_analysis -> 'evidence',
    target_analysis -> 'positive_signals',
    target_analysis -> 'negative_signals',
    target_analysis ->> 'recommended_action',
    target_analysis ->> 'recommended_timing',
    target_analysis ->> 'recommended_channel',
    target_analysis ->> 'follow_up_message',
    target_model_metadata,
    target_analysis_mode,
    target_schema_version,
    target_deep_analysis,
    target_deep_analyzed_at,
    target_usage_key,
    selected_usage_status
  )
  on conflict (deal_id) do update set
    lost_reason = excluded.lost_reason,
    lost_reason_detail = excluded.lost_reason_detail,
    buying_intent_score = excluded.buying_intent_score,
    recovery_score = null,
    confidence_score = excluded.confidence_score,
    recovery_priority = null,
    score_explanation = null,
    evidence = excluded.evidence,
    positive_signals = excluded.positive_signals,
    negative_signals = excluded.negative_signals,
    recommended_action = excluded.recommended_action,
    recommended_timing = excluded.recommended_timing,
    recommended_channel = excluded.recommended_channel,
    follow_up_message = excluded.follow_up_message,
    model_metadata = excluded.model_metadata,
    analysis_mode = excluded.analysis_mode,
    analysis_schema_version = excluded.analysis_schema_version,
    deep_analysis = excluded.deep_analysis,
    deep_analyzed_at = excluded.deep_analyzed_at,
    analysis_usage_key = excluded.analysis_usage_key,
    analysis_usage_status = excluded.analysis_usage_status
  where public.deal_analyses.organization_id = excluded.organization_id;

  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'ANALYSIS_PERSISTENCE_CONFLICT' using errcode = 'P0001';
  end if;

  update public.deals
  set analysis_status = 'completed',
      analysis_error = null,
      analysis_error_detail = null,
      requested_analysis_mode = target_analysis_mode
  where organization_id = target_organization_id
    and id = target_deal_id
    and analysis_status = 'processing';

  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'ANALYSIS_COMPLETION_CONFLICT' using errcode = 'P0001';
  end if;

  delete from private.analysis_run_claims where organization_id=target_organization_id and deal_id=target_deal_id;
  return true;
end;
$$;

CREATE OR REPLACE FUNCTION public.reserve_organization_usage(target_authority_secret text, target_organization_id uuid, target_metric text, target_units integer, target_idempotency_key text)
 RETURNS TABLE(reservation_token uuid, is_new boolean, allowed boolean, plan_code text, usage_limit integer, period_start timestamp with time zone, period_end timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.assert_analysis_runtime_authority(target_authority_secret,target_organization_id);
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
      where usage_event.status in ('reserved','expired')
        and (usage_event.reservation_expires_at > runtime_now or exists (
  select 1 from public.deal_analyses a where a.organization_id=usage_event.organization_id
    and a.analysis_usage_key=usage_event.idempotency_key and a.analysis_usage_status='PENDING'
))
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
        where usage_event.status in ('reserved','expired')
          and (usage_event.reservation_expires_at > runtime_now or exists (
  select 1 from public.deal_analyses a where a.organization_id=usage_event.organization_id
    and a.analysis_usage_key=usage_event.idempotency_key and a.analysis_usage_status='PENDING'
))
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

  if existing_status in ('committed', 'reserved') or exists (
    select 1 from public.deal_analyses a where a.organization_id=target_organization_id
      and a.analysis_usage_key=target_idempotency_key and a.analysis_usage_status='PENDING'
  ) then
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
$function$
;

commit;
