-- LostDeal AI V1 — Prompt 12
-- Narrow tenant-scoped deal deletion. Associated analyses already cascade via
-- deal_analyses_deal_belongs_to_organization; upload rows and other deals stay.

begin;

create policy deals_delete_org_member
  on public.deals
  for delete
  to authenticated
  using (private.is_org_member(organization_id));

grant delete on table public.deals to authenticated;

commit;
