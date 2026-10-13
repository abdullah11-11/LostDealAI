-- Prompt 16 Paddle Sandbox Simulator event-ID compatibility hotfix.
-- Replace only the provider event-ID validation in the existing billing RPC.
-- Authority verifiers, grants, RLS, storage, and all billing semantics are unchanged.
do $compat$
declare
  target_function constant regprocedure := 'public.synchronize_paddle_subscription(text,jsonb,text)'::regprocedure;
  platform_only constant text := 'event_id !~ ''^evt_[a-z0-9]{26}$''';
  platform_and_simulator constant text := 'event_id !~ ''^(evt|ntfsimevt)_[a-z0-9]{26}$''';
  original_definition text;
  replacement_definition text;
  original_acl aclitem[];
  original_owner oid;
  original_security_definer boolean;
  original_config text[];
begin
  select pg_get_functiondef(p.oid), p.proacl, p.proowner, p.prosecdef, p.proconfig
  into original_definition, original_acl, original_owner, original_security_definer, original_config
  from pg_proc p
  where p.oid = target_function;

  if not found
    or not original_security_definer
    or not ('search_path=""' = any(original_config))
    or (length(original_definition) - length(replace(original_definition, platform_only, ''))) / length(platform_only) <> 1
    or position(platform_and_simulator in original_definition) > 0 then
    raise exception 'PADDLE_EVENT_ID_COMPAT_PRECONDITION_FAILED';
  end if;

  replacement_definition := replace(original_definition, platform_only, platform_and_simulator);
  execute replacement_definition;

  if not exists (
    select 1
    from pg_proc p
    where p.oid = target_function
      and p.proacl is not distinct from original_acl
      and p.proowner = original_owner
      and p.prosecdef = original_security_definer
      and p.proconfig is not distinct from original_config
  ) or pg_get_functiondef(target_function) is distinct from replacement_definition then
    raise exception 'PADDLE_EVENT_ID_COMPAT_INVARIANT_CHANGED';
  end if;
end;
$compat$;
