-- LostDeal AI Prompt 15.3.1 — forward-only Deep runtime hardening.
-- Protect AI-derived writes behind narrow member + server-authority RPCs,
-- make analysis usage finalization durable, and provide globally correct
-- Recovery Score ordering without PostgREST relationship ordering.
begin;

alter table public.deals
  add column analysis_error_detail text;

alter table public.deals
  add constraint deals_analysis_error_detail_valid
  check (
    analysis_error_detail is null
    or analysis_error_detail in (
      'provider_incomplete',
      'provider_refusal',
      'provider_unavailable',
      'schema_parse_failure',
      'zod_validation_failure',
      'normalization_failure',
      'evidence_grounding_failure',
      'evidence_index_failure',
      'unsupported_numeric_claim',
      'unsupported_decision_maker_claim',
      'unsupported_competitor_claim',
      'unsupported_psychological_claim',
      'unsupported_factual_claim',
      'prompt_injection_output',
      'blocker_mismatch',
      'semantic_validation_failure',
      'persistence_failure',
      'usage_finalization_failure'
    )
  );

alter table public.deal_analyses
  add column analysis_usage_key text,
  add column analysis_usage_status text not null default 'LEGACY';

alter table public.deal_analyses
  add constraint deal_analyses_usage_status_valid
    check (analysis_usage_status in ('LEGACY', 'PENDING', 'COMMITTED')),
  add constraint deal_analyses_usage_key_consistent
    check (
      (analysis_usage_status = 'LEGACY' and analysis_usage_key is null)
      or (
        analysis_usage_status in ('PENDING', 'COMMITTED')
        and length(analysis_usage_key) between 1 and 200
      )
    );

create unique index deal_analyses_analysis_usage_key_unique
  on public.deal_analyses (organization_id, analysis_usage_key)
  where analysis_usage_key is not null;

-- Imported deals use database defaults for protected analysis state. Ordinary
-- authenticated clients retain source-field updates but cannot manufacture AI
-- status, error, mode, analysis payloads, model metadata, or scores.
revoke insert (analysis_status, analysis_error) on table public.deals from authenticated;
revoke update (analysis_status, analysis_error, requested_analysis_mode)
  on table public.deals from authenticated;

revoke all on table public.deal_analyses from authenticated;
grant select on table public.deal_analyses to authenticated;

drop policy if exists deal_analyses_insert_org_member on public.deal_analyses;
drop policy if exists deal_analyses_update_org_member on public.deal_analyses;

create function private.assert_analysis_runtime_authority(
  target_authority_secret text,
  target_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if encode(
    extensions.digest(coalesce(target_authority_secret, ''), 'sha256'),
    'hex'
  ) is distinct from '0d092f687fa975007a0c40bbaf91cd60cafe6ba5da8d3b2d780da8297ef953f1' then
    raise exception 'ANALYSIS_AUTHORITY_INVALID' using errcode = '42501';
  end if;

  if not private.is_org_member(target_organization_id) then
    raise exception 'ANALYSIS_ORGANIZATION_UNAUTHORIZED' using errcode = '42501';
  end if;
end;
$$;

create function public.transition_deal_analysis(
  target_authority_secret text,
  target_organization_id uuid,
  target_deal_id uuid,
  target_transition text,
  target_error_code text,
  target_error_detail text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer := 0;
begin
  perform private.assert_analysis_runtime_authority(
    target_authority_secret,
    target_organization_id
  );

  if target_transition not in (
    'CLAIM_STANDARD', 'CLAIM_DEEP',
    'REPAIR_STANDARD', 'REPAIR_DEEP',
    'FAIL_STANDARD', 'FAIL_DEEP'
  ) then
    raise exception 'ANALYSIS_TRANSITION_INVALID' using errcode = '22023';
  end if;

  if target_transition in ('FAIL_STANDARD', 'FAIL_DEEP') then
    if target_error_code not in (
      'OPENAI_NOT_CONFIGURED', 'AI_TEMPORARILY_UNAVAILABLE', 'AI_RATE_LIMITED',
      'AI_RESPONSE_INVALID', 'SOURCE_TOO_LONG', 'INSUFFICIENT_SOURCE',
      'AI_REFUSAL', 'ANALYSIS_FAILED'
    ) then
      raise exception 'ANALYSIS_ERROR_CODE_INVALID' using errcode = '22023';
    end if;
    if target_error_detail is not null and target_error_detail not in (
      'provider_incomplete', 'provider_refusal', 'provider_unavailable',
      'schema_parse_failure', 'zod_validation_failure', 'normalization_failure',
      'evidence_grounding_failure', 'evidence_index_failure',
      'unsupported_numeric_claim', 'unsupported_decision_maker_claim',
      'unsupported_competitor_claim', 'unsupported_psychological_claim',
      'unsupported_factual_claim',
      'prompt_injection_output', 'blocker_mismatch', 'semantic_validation_failure',
      'persistence_failure', 'usage_finalization_failure'
    ) then
      raise exception 'ANALYSIS_ERROR_DETAIL_INVALID' using errcode = '22023';
    end if;
  elsif target_error_code is not null or target_error_detail is not null then
    raise exception 'ANALYSIS_TRANSITION_ERROR_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':' || target_deal_id::text, 0)
  );

  if target_transition = 'CLAIM_STANDARD' then
    update public.deals
    set analysis_status = 'processing',
        analysis_error = null,
        analysis_error_detail = null,
        requested_analysis_mode = 'STANDARD'
    where organization_id = target_organization_id
      and id = target_deal_id
      and analysis_status in ('pending', 'failed');
  elsif target_transition = 'CLAIM_DEEP' then
    update public.deals
    set analysis_status = 'processing',
        analysis_error = null,
        analysis_error_detail = null,
        requested_analysis_mode = 'DEEP'
    where organization_id = target_organization_id
      and id = target_deal_id
      and analysis_status in ('pending', 'failed', 'completed');
  elsif target_transition = 'REPAIR_STANDARD' then
    update public.deals as deal
    set analysis_status = 'completed',
        analysis_error = null,
        analysis_error_detail = null,
        requested_analysis_mode = coalesce((
          select analysis.analysis_mode
          from public.deal_analyses as analysis
          where analysis.organization_id = target_organization_id
            and analysis.deal_id = target_deal_id
        ), 'STANDARD')
    where deal.organization_id = target_organization_id
      and deal.id = target_deal_id
      and exists (
        select 1 from public.deal_analyses as analysis
        where analysis.organization_id = target_organization_id
          and analysis.deal_id = target_deal_id
      );
  elsif target_transition = 'REPAIR_DEEP' then
    update public.deals as deal
    set analysis_status = 'completed',
        analysis_error = null,
        analysis_error_detail = null,
        requested_analysis_mode = 'DEEP'
    where deal.organization_id = target_organization_id
      and deal.id = target_deal_id
      and exists (
        select 1 from public.deal_analyses as analysis
        where analysis.organization_id = target_organization_id
          and analysis.deal_id = target_deal_id
          and analysis.analysis_mode = 'DEEP'
          and analysis.deep_analysis is not null
      );
  elsif target_transition = 'FAIL_STANDARD' then
    update public.deals
    set analysis_status = 'failed',
        analysis_error = target_error_code,
        analysis_error_detail = target_error_detail,
        requested_analysis_mode = 'STANDARD'
    where organization_id = target_organization_id
      and id = target_deal_id
      and analysis_status = 'processing';
  else
    update public.deals
    set analysis_status = 'failed',
        analysis_error = target_error_code,
        analysis_error_detail = target_error_detail,
        requested_analysis_mode = 'DEEP'
    where organization_id = target_organization_id
      and id = target_deal_id
      and analysis_status = 'processing';
  end if;

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

create function public.persist_deal_analysis(
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

  return true;
end;
$$;

create function public.finalize_analysis_usage(
  target_authority_secret text,
  target_organization_id uuid,
  target_metric text,
  target_idempotency_key text,
  target_committed_units integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_status text;
  selected_units integer;
  changed_rows integer := 0;
begin
  perform private.assert_analysis_runtime_authority(
    target_authority_secret,
    target_organization_id
  );

  if target_metric <> 'AI_ANALYSES'
    or target_committed_units <> 1
    or target_idempotency_key is null
    or length(target_idempotency_key) not between 1 and 200
    or not (
      target_idempotency_key like 'analysis:%'
      or target_idempotency_key like 'deep-analysis:%'
    ) then
    raise exception 'ANALYSIS_USAGE_FINALIZATION_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_organization_id::text || ':' || target_metric || ':' || target_idempotency_key,
      0
    )
  );

  if not exists (
    select 1 from public.deal_analyses as analysis
    where analysis.organization_id = target_organization_id
      and analysis.analysis_usage_key = target_idempotency_key
      and analysis.analysis_usage_status in ('PENDING', 'COMMITTED')
  ) then
    return false;
  end if;

  select usage_event.status, usage_event.units
  into selected_status, selected_units
  from public.organization_usage_events as usage_event
  where usage_event.organization_id = target_organization_id
    and usage_event.metric = target_metric
    and usage_event.idempotency_key = target_idempotency_key
  for update;

  if selected_status is null
    or selected_units is null
    or target_committed_units > selected_units
    or selected_status not in ('reserved', 'expired', 'committed') then
    return false;
  end if;

  if selected_status <> 'committed' then
    update public.organization_usage_events
    set units = target_committed_units,
        status = 'committed',
        committed_at = clock_timestamp(),
        reservation_expires_at = null
    where organization_id = target_organization_id
      and metric = target_metric
      and idempotency_key = target_idempotency_key
      and status in ('reserved', 'expired');

    get diagnostics changed_rows = row_count;
    if changed_rows <> 1 then
      return false;
    end if;
  elsif selected_units <> target_committed_units then
    return false;
  end if;

  update public.deal_analyses
  set analysis_usage_status = 'COMMITTED'
  where organization_id = target_organization_id
    and analysis_usage_key = target_idempotency_key
    and analysis_usage_status in ('PENDING', 'COMMITTED');

  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception 'ANALYSIS_USAGE_STATE_CONFLICT' using errcode = 'P0001';
  end if;

  return true;
end;
$$;

create function public.persist_deal_recovery_score(
  target_authority_secret text,
  target_organization_id uuid,
  target_deal_id uuid,
  target_recovery_score integer,
  target_recovery_priority text,
  target_score_explanation text,
  target_model_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_rows integer := 0;
begin
  perform private.assert_analysis_runtime_authority(
    target_authority_secret,
    target_organization_id
  );

  if target_recovery_score not between 0 and 100
    or target_recovery_priority not in ('HIGH', 'MEDIUM', 'LOW')
    or target_score_explanation is null
    or length(target_score_explanation) not between 1 and 1000
    or jsonb_typeof(target_model_metadata) <> 'object' then
    raise exception 'RECOVERY_SCORE_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  update public.deal_analyses as analysis
  set recovery_score = target_recovery_score,
      recovery_priority = target_recovery_priority,
      score_explanation = target_score_explanation,
      model_metadata = target_model_metadata
  where analysis.organization_id = target_organization_id
    and analysis.deal_id = target_deal_id
    and exists (
      select 1 from public.deals as deal
      where deal.organization_id = target_organization_id
        and deal.id = target_deal_id
        and deal.analysis_status = 'completed'
    );

  get diagnostics changed_rows = row_count;
  return changed_rows = 1;
end;
$$;

create function public.list_deal_ids_by_recovery_score(
  target_organization_id uuid,
  target_search text,
  target_analysis_status text,
  target_priority text,
  target_reason text,
  target_service text,
  target_salesperson text,
  target_ascending boolean,
  target_offset integer,
  target_limit integer
)
returns table (deal_id uuid)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_org_member(target_organization_id) then
    raise exception 'DEAL_LIST_ORGANIZATION_UNAUTHORIZED' using errcode = '42501';
  end if;
  if (
    target_analysis_status is not null
    and target_analysis_status not in ('pending', 'processing', 'completed', 'failed')
  ) or (
    target_priority is not null and target_priority not in ('HIGH', 'MEDIUM', 'LOW')
  ) or (
    target_reason is not null and target_reason not in (
      'PRICE', 'FINANCING', 'TIMING', 'COMPETITOR', 'NO_RESPONSE',
      'DECISION_MAKER', 'TRUST', 'PRODUCT_FIT', 'AVAILABILITY',
      'NO_FOLLOW_UP', 'BAD_EXPERIENCE', 'NOT_QUALIFIED', 'OTHER'
    )
  ) or (target_search is not null and length(target_search) > 100)
    or (target_service is not null and length(target_service) > 160)
    or (target_salesperson is not null and length(target_salesperson) > 160)
    or target_ascending is null
    or target_offset is null
    or target_offset < 0
    or target_limit is null
    or target_limit < 1
    or target_limit > 100 then
    raise exception 'DEAL_LIST_REQUEST_INVALID' using errcode = '22023';
  end if;

  return query
  with filtered as (
    select deal.id, analysis.recovery_score
    from public.deals as deal
    left join public.deal_analyses as analysis
      on analysis.organization_id = deal.organization_id
      and analysis.deal_id = deal.id
    where deal.organization_id = target_organization_id
      and (
        target_search is null
        or position(lower(target_search) in lower(coalesce(deal.customer_name, ''))) > 0
        or position(lower(target_search) in lower(coalesce(deal.external_deal_id, ''))) > 0
      )
      and (target_analysis_status is null or deal.analysis_status = target_analysis_status)
      and (target_priority is null or analysis.recovery_priority = target_priority)
      and (target_reason is null or analysis.lost_reason = target_reason)
      and (target_service is null or deal.service_type = target_service)
      and (target_salesperson is null or deal.salesperson = target_salesperson)
  )
  select filtered.id
  from filtered
  order by
    case when target_ascending then filtered.recovery_score end asc nulls last,
    case when not target_ascending then filtered.recovery_score end desc nulls last,
    filtered.id asc
  offset target_offset
  limit target_limit;
end;
$$;

revoke all on function private.assert_analysis_runtime_authority(text, uuid)
  from public, anon, authenticated;

revoke all on function public.transition_deal_analysis(text, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.persist_deal_analysis(text, uuid, uuid, jsonb, text, text, jsonb, timestamptz, jsonb, text, boolean)
  from public, anon, authenticated;
revoke all on function public.finalize_analysis_usage(text, uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.persist_deal_recovery_score(text, uuid, uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.list_deal_ids_by_recovery_score(uuid, text, text, text, text, text, text, boolean, integer, integer)
  from public, anon, authenticated;

grant execute on function public.transition_deal_analysis(text, uuid, uuid, text, text, text)
  to authenticated;
grant execute on function public.persist_deal_analysis(text, uuid, uuid, jsonb, text, text, jsonb, timestamptz, jsonb, text, boolean)
  to authenticated;
grant execute on function public.finalize_analysis_usage(text, uuid, text, text, integer)
  to authenticated;
grant execute on function public.persist_deal_recovery_score(text, uuid, uuid, integer, text, text, jsonb)
  to authenticated;
grant execute on function public.list_deal_ids_by_recovery_score(uuid, text, text, text, text, text, text, boolean, integer, integer)
  to authenticated;

commit;
