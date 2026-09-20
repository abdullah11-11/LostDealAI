-- LostDeal AI V1 — Prompt 3
-- Initial multi-tenant schema, authorization helpers, RLS policies, and grants.
-- Apply this migration to a new Supabase project before connecting the UI.

begin;

-- Supabase recommends keeping SECURITY DEFINER authorization helpers outside
-- schemas exposed by the Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  industry text,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_empty check (length(btrim(name)) > 0)
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  constraint organization_members_organization_id_user_id_key
    unique (organization_id, user_id),
  constraint organization_members_role_valid
    check (role in ('owner', 'member'))
);

create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  filename text not null,
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  status text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uploads_organization_id_id_key unique (organization_id, id),
  constraint uploads_filename_not_empty check (length(btrim(filename)) > 0),
  constraint uploads_total_rows_nonnegative check (total_rows >= 0),
  constraint uploads_valid_rows_nonnegative check (valid_rows >= 0),
  constraint uploads_invalid_rows_nonnegative check (invalid_rows >= 0),
  constraint uploads_status_valid
    check (status in ('pending', 'processing', 'completed', 'failed'))
);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  upload_id uuid,
  external_deal_id text,
  customer_name text,
  deal_value numeric(14, 2) not null,
  quote_date date,
  status text not null default 'lost',
  salesperson text,
  service_type text,
  lead_source text,
  sales_notes text,
  transcript text,
  analysis_status text not null default 'pending',
  analysis_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deals_organization_id_id_key unique (organization_id, id),
  constraint deals_upload_belongs_to_organization
    foreign key (organization_id, upload_id)
    references public.uploads (organization_id, id)
    on delete set null (upload_id),
  constraint deals_deal_value_nonnegative check (deal_value >= 0),
  constraint deals_status_valid check (status = 'lost'),
  constraint deals_analysis_status_valid
    check (analysis_status in ('pending', 'processing', 'completed', 'failed'))
);

create table public.deal_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  deal_id uuid not null,
  lost_reason text not null,
  lost_reason_detail text,
  buying_intent_score integer not null,
  recovery_score integer,
  confidence_score integer not null,
  recovery_priority text,
  score_explanation text,
  evidence jsonb not null default '[]'::jsonb,
  positive_signals jsonb not null default '[]'::jsonb,
  negative_signals jsonb not null default '[]'::jsonb,
  recommended_action text,
  recommended_timing text,
  recommended_channel text,
  follow_up_message text,
  model_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_analyses_deal_id_key unique (deal_id),
  constraint deal_analyses_deal_belongs_to_organization
    foreign key (organization_id, deal_id)
    references public.deals (organization_id, id)
    on delete cascade,
  constraint deal_analyses_lost_reason_valid check (
    lost_reason in (
      'PRICE',
      'FINANCING',
      'TIMING',
      'COMPETITOR',
      'NO_RESPONSE',
      'DECISION_MAKER',
      'TRUST',
      'PRODUCT_FIT',
      'AVAILABILITY',
      'NO_FOLLOW_UP',
      'BAD_EXPERIENCE',
      'NOT_QUALIFIED',
      'OTHER'
    )
  ),
  constraint deal_analyses_buying_intent_score_range
    check (buying_intent_score between 0 and 100),
  constraint deal_analyses_recovery_score_range
    check (recovery_score between 0 and 100),
  constraint deal_analyses_confidence_score_range
    check (confidence_score between 0 and 100),
  constraint deal_analyses_recovery_priority_valid
    check (recovery_priority in ('HIGH', 'MEDIUM', 'LOW')),
  constraint deal_analyses_recommended_channel_valid
    check (recommended_channel in ('HUMAN_CALL', 'SMS', 'EMAIL', 'NO_ACTION', 'OTHER')),
  constraint deal_analyses_evidence_is_array
    check (jsonb_typeof(evidence) = 'array'),
  constraint deal_analyses_positive_signals_is_array
    check (jsonb_typeof(positive_signals) = 'array'),
  constraint deal_analyses_negative_signals_is_array
    check (jsonb_typeof(negative_signals) = 'array')
);

-- ---------------------------------------------------------------------------
-- Indexes used by tenancy policies and common V1 queries
-- ---------------------------------------------------------------------------

create index organization_members_user_id_idx
  on public.organization_members (user_id);

-- The unique (organization_id, user_id) constraint already provides an index
-- whose leading column supports organization_id membership lookups.

create index uploads_organization_id_idx
  on public.uploads (organization_id);

create index deals_organization_id_idx
  on public.deals (organization_id);

create index deals_upload_id_idx
  on public.deals (upload_id);

create index deals_quote_date_idx
  on public.deals (quote_date);

create index deals_analysis_status_idx
  on public.deals (analysis_status);

create unique index deals_organization_external_deal_id_unique_idx
  on public.deals (organization_id, external_deal_id)
  where external_deal_id is not null;

create index deal_analyses_organization_id_idx
  on public.deal_analyses (organization_id);

-- The one-current-analysis unique constraint on deal_id also supplies the
-- deal_id lookup index.

-- ---------------------------------------------------------------------------
-- Reusable updated_at trigger
-- ---------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger uploads_set_updated_at
  before update on public.uploads
  for each row execute function public.set_updated_at();

create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

create trigger deal_analyses_set_updated_at
  before update on public.deal_analyses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auth profile creation
--
-- Supabase warns that an error in an auth.users trigger can block signup. Keep
-- this function deliberately small and test it after applying the migration.
-- ---------------------------------------------------------------------------

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Non-recursive authorization helpers
--
-- These functions are SECURITY DEFINER so they can inspect membership without
-- re-entering organization_members RLS. Their empty search_path and fully
-- qualified object names prevent object-shadowing attacks. They return only
-- booleans and are executable only by authenticated users.
-- ---------------------------------------------------------------------------

create function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
  );
$$;

create function private.is_org_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'owner'
  );
$$;

create function private.can_read_organization_during_bootstrap(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.organizations as organization
      where organization.id = target_organization_id
        and organization.created_by = (select auth.uid())
    )
    and not exists (
      select 1
      from public.organization_members as membership
      where membership.organization_id = target_organization_id
    );
$$;

create function private.can_bootstrap_organization_membership(
  target_organization_id uuid,
  target_user_id uuid,
  target_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and target_user_id = (select auth.uid())
    and target_role = 'owner'
    and exists (
      select 1
      from public.organizations as organization
      where organization.id = target_organization_id
        and organization.created_by = (select auth.uid())
    )
    and not exists (
      select 1
      from public.organization_members as membership
      where membership.organization_id = target_organization_id
    );
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function private.handle_new_user() from public, anon, authenticated;
revoke all on function private.is_org_member(uuid) from public, anon, authenticated;
revoke all on function private.is_org_owner(uuid) from public, anon, authenticated;
revoke all on function private.can_read_organization_during_bootstrap(uuid)
  from public, anon, authenticated;
revoke all on function private.can_bootstrap_organization_membership(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_owner(uuid) to authenticated;
grant execute on function private.can_read_organization_during_bootstrap(uuid)
  to authenticated;
grant execute on function private.can_bootstrap_organization_membership(uuid, uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.uploads enable row level security;
alter table public.deals enable row level security;
alter table public.deal_analyses enable row level security;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy organizations_insert_own
  on public.organizations
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy organizations_select_member_or_bootstrap_creator
  on public.organizations
  for select
  to authenticated
  using (
    private.is_org_member(id)
    or private.can_read_organization_during_bootstrap(id)
  );

create policy organizations_update_owner
  on public.organizations
  for update
  to authenticated
  using (private.is_org_owner(id))
  with check (private.is_org_owner(id));

create policy organization_members_select_org_member
  on public.organization_members
  for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy organization_members_insert_initial_owner
  on public.organization_members
  for insert
  to authenticated
  with check (
    private.can_bootstrap_organization_membership(
      organization_id,
      user_id,
      role
    )
  );

create policy uploads_select_org_member
  on public.uploads
  for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy uploads_insert_org_member
  on public.uploads
  for insert
  to authenticated
  with check (
    private.is_org_member(organization_id)
    and created_by = (select auth.uid())
  );

create policy uploads_update_org_member
  on public.uploads
  for update
  to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

create policy deals_select_org_member
  on public.deals
  for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy deals_insert_org_member
  on public.deals
  for insert
  to authenticated
  with check (private.is_org_member(organization_id));

create policy deals_update_org_member
  on public.deals
  for update
  to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

create policy deal_analyses_select_org_member
  on public.deal_analyses
  for select
  to authenticated
  using (private.is_org_member(organization_id));

create policy deal_analyses_insert_org_member
  on public.deal_analyses
  for insert
  to authenticated
  with check (private.is_org_member(organization_id));

create policy deal_analyses_update_org_member
  on public.deal_analyses
  for update
  to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- Least-privilege Data API grants
--
-- RLS and SQL grants are separate layers. Anonymous users receive no table or
-- helper-function access. Organization identifiers and creator identifiers are
-- deliberately omitted from UPDATE grants so clients cannot move records
-- between tenants or rewrite ownership metadata.
-- ---------------------------------------------------------------------------

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.organizations from anon, authenticated;
revoke all on table public.organization_members from anon, authenticated;
revoke all on table public.uploads from anon, authenticated;
revoke all on table public.deals from anon, authenticated;
revoke all on table public.deal_analyses from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

grant select on table public.organizations to authenticated;
grant insert (id, name, industry, created_by)
  on table public.organizations to authenticated;
grant update (name, industry)
  on table public.organizations to authenticated;

grant select on table public.organization_members to authenticated;
grant insert (id, organization_id, user_id, role)
  on table public.organization_members to authenticated;

grant select on table public.uploads to authenticated;
grant insert (
  id,
  organization_id,
  filename,
  total_rows,
  valid_rows,
  invalid_rows,
  status,
  created_by
) on table public.uploads to authenticated;
grant update (total_rows, valid_rows, invalid_rows, status)
  on table public.uploads to authenticated;

grant select on table public.deals to authenticated;
grant insert (
  id,
  organization_id,
  upload_id,
  external_deal_id,
  customer_name,
  deal_value,
  quote_date,
  status,
  salesperson,
  service_type,
  lead_source,
  sales_notes,
  transcript,
  analysis_status,
  analysis_error
) on table public.deals to authenticated;
grant update (
  external_deal_id,
  customer_name,
  deal_value,
  quote_date,
  status,
  salesperson,
  service_type,
  lead_source,
  sales_notes,
  transcript,
  analysis_status,
  analysis_error
) on table public.deals to authenticated;

grant select on table public.deal_analyses to authenticated;
grant insert (
  id,
  organization_id,
  deal_id,
  lost_reason,
  lost_reason_detail,
  buying_intent_score,
  recovery_score,
  confidence_score,
  recovery_priority,
  score_explanation,
  evidence,
  positive_signals,
  negative_signals,
  recommended_action,
  recommended_timing,
  recommended_channel,
  follow_up_message,
  model_metadata
) on table public.deal_analyses to authenticated;
grant update (
  lost_reason,
  lost_reason_detail,
  buying_intent_score,
  recovery_score,
  confidence_score,
  recovery_priority,
  score_explanation,
  evidence,
  positive_signals,
  negative_signals,
  recommended_action,
  recommended_timing,
  recommended_channel,
  follow_up_message,
  model_metadata
) on table public.deal_analyses to authenticated;

commit;
