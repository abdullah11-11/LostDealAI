-- Prompt 16: release only the exact local operation token after a definitive
-- provider rejection. Ambiguous timeouts and transport failures remain locked
-- until an authenticated owner performs provider-backed reconciliation.
create function public.abort_billing_operation(
  target_authority_secret text,
  target_organization_id uuid,
  target_operation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleared_rows integer;
begin
  perform private.assert_billing_authority(target_authority_secret);
  if not private.is_org_owner(target_organization_id) then
    raise exception 'BILLING_OWNER_REQUIRED' using errcode = '42501';
  end if;
  if target_operation_id is null then
    raise exception 'INVALID_BILLING_OPERATION' using errcode = '22023';
  end if;

  update public.organization_subscriptions
  set billing_operation_id = null,
      billing_operation_started_at = null,
      billing_operation_target = null
  where organization_id = target_organization_id
    and billing_operation_id = target_operation_id;
  get diagnostics cleared_rows = row_count;
  return cleared_rows = 1;
end;
$$;

revoke all on function public.abort_billing_operation(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.abort_billing_operation(text, uuid, uuid) to authenticated;
