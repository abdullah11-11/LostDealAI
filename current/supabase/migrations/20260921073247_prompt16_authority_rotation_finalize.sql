-- Prompt 16 authority rotation, phase 3: retire the temporary old verifier.
-- The raw authority secret is never stored here; only its approved SHA-256 digest is used.
-- This migration changes one exact comparison in each authorized function and nothing else.
do $rotation$
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
  fn record;
  original_definition text;
  replacement_definition text;
  dual_comparison text;
  final_comparison text;
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

  dual_comparison := 'not in (' || quote_literal(old_digest) || ', ' || quote_literal(new_digest) || ')';
  final_comparison := 'is distinct from ' || quote_literal(new_digest);

  for fn in
    select p.oid, p.prosecdef, p.proconfig, p.proacl, p.proowner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname = any(expected)
  loop
    original_definition := pg_get_functiondef(fn.oid);

    if not fn.prosecdef
      or not ('search_path=""' = any(fn.proconfig))
      or position(old_digest in original_definition) = 0
      or position(new_digest in original_definition) = 0
      or (
        length(original_definition) - length(replace(original_definition, dual_comparison, ''))
      ) / length(dual_comparison) <> 1 then
      raise exception 'AUTHORITY_FINALIZATION_PRECONDITION_FAILED';
    end if;

    replacement_definition := replace(original_definition, dual_comparison, final_comparison);
    execute replacement_definition;

    if not exists (
      select 1
      from pg_proc p
      where p.oid = fn.oid
        and p.proacl is not distinct from fn.proacl
        and p.proowner = fn.proowner
        and p.prosecdef = fn.prosecdef
        and p.proconfig is not distinct from fn.proconfig
    )
      or pg_get_functiondef(fn.oid) is distinct from replacement_definition
      or position(old_digest in pg_get_functiondef(fn.oid)) > 0
      or position(final_comparison in pg_get_functiondef(fn.oid)) = 0 then
      raise exception 'AUTHORITY_FINALIZATION_INVARIANT_CHANGED';
    end if;
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f'
      and n.nspname in ('public', 'private')
      and position(old_digest in p.prosrc) > 0
  ) then
    raise exception 'OLD_AUTHORITY_DIGEST_STILL_ACTIVE';
  end if;
end;
$rotation$;
