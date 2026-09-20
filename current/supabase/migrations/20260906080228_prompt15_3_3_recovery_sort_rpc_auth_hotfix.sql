-- LostDeal AI Prompt 15.3.3 — forward-only Recovery Score sort RPC
-- authorization hotfix. The public RPC must enter the private membership
-- helper without granting authenticated clients broad private-schema access.
begin;

create or replace function public.list_deal_ids_by_recovery_score(
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
security definer
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

revoke all on function public.list_deal_ids_by_recovery_score(uuid, text, text, text, text, text, text, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_deal_ids_by_recovery_score(uuid, text, text, text, text, text, text, boolean, integer, integer)
  to authenticated;

commit;
