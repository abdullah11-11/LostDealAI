-- LostDeal AI Prompt 15.3.5 — durable bounded Deep semantic diagnostics.
-- Reuse the protected analysis_error_detail field for exact enum-only failure
-- classes. No provider output, customer source, prompt, or reasoning is stored.
begin;

alter table public.deals
  drop constraint deals_analysis_error_detail_valid;

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
      'duplicate_secondary_blocker',
      'primary_secondary_overlap',
      'duplicate_objection_reason',
      'weak_evidence_contract',
      'timing_category_evidence_mismatch',
      'price_value_category_evidence_mismatch',
      'competitor_category_evidence_mismatch',
      'discount_category_evidence_mismatch',
      'persistence_failure',
      'usage_finalization_failure'
    )
  );

create or replace function public.transition_deal_analysis(
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
      'duplicate_secondary_blocker', 'primary_secondary_overlap',
      'duplicate_objection_reason', 'weak_evidence_contract',
      'timing_category_evidence_mismatch',
      'price_value_category_evidence_mismatch',
      'competitor_category_evidence_mismatch',
      'discount_category_evidence_mismatch',
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

revoke all on function public.transition_deal_analysis(text, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.transition_deal_analysis(text, uuid, uuid, text, text, text)
  to authenticated;

commit;
