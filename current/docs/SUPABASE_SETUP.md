# Supabase setup for LostDeal AI V1

This guide connects a new Supabase project to the version-controlled database
architecture created in Prompt 3. The LostDeal AI interface remains demo-only
in this milestone; these steps prepare the database for the authentication and
data-connection work that follows.

## Current Prompt 3.5 connection status

The initial migration and `supabase/tests/schema_checks.sql` have already been
run manually against the current hosted Supabase project. Do not apply the
initial migration again. Future schema changes must use a new migration file.

Prompt 12 adds one forward-only migration:

`supabase/migrations/20260830000000_prompt12_deal_delete.sql`

Apply it after the initial migration. It adds only a tenant-scoped DELETE policy
and DELETE grant on `public.deals`; the existing analysis foreign key already
cascades. Then run `supabase/tests/prompt12_security_checks.sql`. Do not edit or
re-run the original migration to add this permission.

Prompt 15 adds one additional forward-only migration:

`supabase/migrations/20260901000000_prompt15_commercial_foundation.sql`

Apply it after Prompt 12. It creates organization subscription and usage-event
tables, read-only member RLS policies, an existing-organization `INTERNAL`
backfill, a future-organization 14-day `TRIAL` bootstrap, and atomic usage
reservation/commit functions. It stores no card data or fake provider IDs.
After applying it, run `supabase/tests/prompt15_commercial_checks.sql` and
confirm both tables have RLS, no authenticated/anonymous table DML grants are
reported, anonymous RPC access is false, authenticated reservation/commit and
aggregate-usage RPC access is true,
every existing organization has an `INTERNAL` row, and all limit-mirror checks
are true.
The reservation and commit RPCs additionally require the server-only
`BILLING_USAGE_AUTHORITY_SECRET`; the migration stores only its SHA-256
verifier. A direct authenticated browser call without that secret must fail.

Prompt 15.1 adds the smallest forward-only limit update:

`supabase/migrations/20260902000000_prompt15_1_plan_limits.sql`

The owner reports that both the Prompt 15 and Prompt 15.1 migrations are already
applied and their commercial checks passed. Do not edit or reapply them. Prompt
15.1 only replaced the private plan-limit mirror with the approved Trial,
Starter, and Pro allowances, kept `INTERNAL` unlimited, and left `BUSINESS`
inactive.

Prompt 15.2 adds one minimal forward-only usage-metric update:

`supabase/migrations/20260902010000_prompt15_2_auto_convert_limit.sql`

The owner reports this migration is applied and its commercial checks passed.
It extends the existing generic usage ledger
and reservation/read/commit functions with `AUTO_CONVERT_ROWS`: Trial 25,
Starter 0, Pro 1,500, Internal unlimited, and Business inactive. It creates no
table, policy, service-role path, raw-file store, or second metering system.
Then run `supabase/tests/prompt15_commercial_checks.sql` and confirm every new
Auto Convert limit result is true. Keep `BILLING_ENFORCEMENT_MODE=SHADOW`;
commercial provider execution remains inactive until Prompt 16.

Prompt 15.3 adds one forward-only Deep Analysis update:

`supabase/migrations/20260902020000_prompt15_3_deep_analysis.sql`

The owner reports it is applied and the updated commercial checks passed. It adds the requested/current analysis mode,
schema version, bounded customer-visible Deep JSON, and Deep completion time; it
also enforces the future Trial two-Deep-operation subset inside the existing
`AI_ANALYSES` reservation RPC. It creates no table, policy, usage metric, or
service-role path. Do not edit or reapply it.

Prompt 15.3.1 added one forward-only runtime hardening update:

`supabase/migrations/20260905070000_prompt15_3_1_runtime_hardening.sql`

The owner reports it is applied exactly once after Prompt 15.3. It adds safe analysis diagnostic and
usage-finalization state, narrow server-authorized analysis/score/finalization
RPCs, global tenant-checked Recovery Score ordering, and least-privilege grants.
It creates no table, usage metric, plan, payment object, service-role path, or
environment variable; it reuses `BILLING_USAGE_AUTHORITY_SECRET`. Then run
`supabase/tests/prompt15_commercial_checks.sql` and confirm every boolean is
true, including direct authenticated AI-write denial, protected RPC execution,
durable finalization, both score directions, and all prior plan/Deep limits.
Existing stored analysis remains readable through the compatibility path.

Prompt 15.3.2 adds one forward-only reservation runtime hotfix:

`supabase/migrations/20260905083511_prompt15_3_2_usage_reservation_runtime_hotfix.sql`

Apply it exactly once after Prompt 15.3.1. Owner QA showed both Standard and Deep
stopping before OpenAI because `date_trunc('month', current_time)` received SQL
`CURRENT_TIME` as `time with time zone`, despite the ambiguously named local
variable having been declared `timestamptz`. The replacement uses
`runtime_now timestamptz := clock_timestamp()` for the INTERNAL month boundary,
status windows, expiration checks, active reservations, and 15-minute expiry.
It preserves the exact five-argument RPC, table return shape, security definer,
empty search path, authority/membership checks, plan limits, Trial Deep limit,
locking, idempotency, and grants. It adds no overload or broad `private` schema
access.

After application, run `supabase/tests/prompt15_commercial_checks.sql` and
confirm every result is true, including one exact reservation overload,
`runtime_now`, no ambiguous `current_time`, authenticated-only execution, and no
anonymous/authenticated `private` schema usage. Then run one owner Standard and
one owner Deep operation and confirm exactly one `AI_ANALYSES` unit for each.
Do not perform those paid live operations automatically. Prompt 16 remains
blocked until their fresh database logs are clean.

Prompt 15.3.3 adds one forward-only Recovery Score sort authorization hotfix:

`supabase/migrations/20260906080228_prompt15_3_3_recovery_sort_rpc_auth_hotfix.sql`

Apply it exactly once after Prompt 15.3.2. The Prompt 15.3.1 sort RPC was a
`SECURITY INVOKER` function that correctly called `private.is_org_member(...)`,
but authenticated callers intentionally have no `USAGE` privilege on the
`private` schema. That combination caused Recovery Score sorting to fail before
the membership check could run. The replacement keeps the same exact RPC
signature, validation, filters, global ordering, nulls-last behavior, ID tie
break, offset, limit, and table return shape, while changing only the execution
context to `SECURITY DEFINER`. It retains an empty `search_path`, fully qualified
references, an explicit membership check before data access, anonymous denial,
and authenticated-only execution. It does not grant either client role access
to the `private` schema and makes no AI or score-calculation call.

After application, run both
`supabase/tests/prompt15_commercial_checks.sql` and
`supabase/tests/prompt15_3_3_recovery_sort_auth_checks.sql`. Confirm all catalog
checks pass, both Recovery Score directions return database-global ordering,
pagination follows that ordering, and cross-organization execution is denied.
Then perform owner UI smoke tests for Recovery Score High to Low and Low to High
and one Auto Convert regression smoke. Do not invoke paid provider work merely
to test sorting. Prompt 16 remains blocked until the migration and owner smoke
tests are complete.

Prompt 15.3.4 is an application-only Deep semantic validator hotfix and adds no
database migration. It retains the existing persisted
`semantic_validation_failure` value and records its eight finer failure classes
only in safe server logs, so the Prompt 15.3.1 database check constraint does
not change. Do not edit or reapply any earlier migration for Prompt 15.3.4.
After deploying the application, perform exactly one owner live Deep test; on
success verify one committed `AI_ANALYSES` unit and zero new units on reload.

Prompt 15.3.5 adds exactly one forward-only bounded diagnostic migration:

`supabase/migrations/20260908055554_prompt15_3_5_deep_semantic_diagnostic_hardening.sql`

Apply it exactly once after Prompt 15.3.3 (Prompt 15.3.4 had no migration). It
extends the existing `deals_analysis_error_detail_valid` CHECK constraint and
the same protected `transition_deal_analysis(...)` RPC with these exact safe
semantic values: `duplicate_secondary_blocker`, `primary_secondary_overlap`,
`duplicate_objection_reason`, `weak_evidence_contract`,
`timing_category_evidence_mismatch`,
`price_value_category_evidence_mismatch`,
`competitor_category_evidence_mismatch`, and
`discount_category_evidence_mismatch`. The RPC remains `SECURITY DEFINER` with
an empty search path, server-authority verification, organization membership,
tenant-scoped updates, a strict transition/error allowlist, anonymous denial,
and authenticated-only execution. It grants no authenticated write access to
the diagnostic column and no client access to the private schema.

After application, verify the migration record, constraint, function security
attributes and ACL. Confirm an arbitrary diagnostic value is rejected and an
authenticated direct update of `analysis_error_detail` is denied. Do not place
raw provider output, notes, transcript, evidence excerpts, hidden reasoning,
credentials, or stack traces in that field. Then deploy Prompt 15.3.5 and have
the owner perform exactly one Synthetic Juniper Deep test; success must commit
one `AI_ANALYSES` unit and reload must commit zero. Do not run that paid owner
test during automated migration verification.

Prompt 15.3.6 is an application-only Deep runtime closure and adds **no
database migration**. It preserves the applied Prompt 15.3.5 diagnostic
constraint and protected transition RPC exactly as deployed. Do not edit or
reapply any earlier migration. Its deterministic repair replaces only an
unsupported optional timing, price/value, competitor, or discount field with a
fixed empty-evidence fallback; critical failures retain the existing protected
diagnostic and zero-commit behavior. The owner Synthetic Juniper operation is
now verified: one completed Deep result, one committed `AI_ANALYSES` unit, and
zero additional units on a later reload.

Prompt 15.3.7 adds **no database migration**. Run the current
`supabase/tests/schema_checks.sql`,
`supabase/tests/prompt15_commercial_checks.sql`, and rollback-only Recovery
Score authorization check. The omnibus catalog and impersonation checks cover
all eight tables, RLS, least-privilege column grants, protected RPCs, private
schema denial, same-tenant access, and cross-tenant denial. Prompt 15.3.x is
closed; Prompt 16 may begin while billing remains `SHADOW`.

The development connection uses only these client-safe values in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Never commit `.env.local`. After configuring it, run `npm run verify:supabase`
to perform harmless anonymous reads against the six expected tables. A
permission-denied result is expected and confirms the Data API reached the
table while anonymous access remained blocked. The command reports statuses
only and never prints environment values or database rows.

## 1. Create a Supabase project

1. Go to [Supabase](https://supabase.com/dashboard) and create an account or
   sign in.
2. Select **New project**.
3. Choose an organization, project name, region, and a strong database
   password.
4. Store the database password in a password manager. Do not put it in this
   repository or in browser code.
5. Wait until the project finishes provisioning.

The official [Next.js quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
shows the same Project URL and Publishable key setup used here.

## 2. Find the Project URL and Publishable key

1. Open the project in the Supabase Dashboard.
2. Open the project's **Connect** dialog. You can also use **Project Settings →
   API Keys** if the dashboard presents the values there.
3. Copy the **Project URL**.
4. Copy the **Publishable key**. New projects should use the key whose value
   starts with `sb_publishable_`.

The Publishable key identifies a public client and is safe to place in a web
application only when Row Level Security is correctly enabled. Read
[Understanding API keys](https://supabase.com/docs/guides/getting-started/api-keys)
for the current key types.

Do **not** copy a secret key, legacy `service_role` key, database password, or
connection string into client-side environment variables.

## 3. Create `.env.local`

At the project root, copy `.env.example` to a new file named `.env.local`.
Fill the public Supabase values and server-only OpenAI settings:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6
OPENAI_AUTO_CONVERT_MODEL=gpt-5.6-luna
OPENAI_STANDARD_ANALYSIS_MODEL=gpt-5.6-terra
OPENAI_DEEP_ANALYSIS_MODEL=gpt-5.6-terra
APP_ORIGIN=https://lostdeal-ai.equal-dune-2306.chatgpt.site
BILLING_ENFORCEMENT_MODE=SHADOW
BILLING_USAGE_AUTHORITY_SECRET=
```

Set `OPENAI_API_KEY` only in `.env.local` or the production server secret store.
It is required for LostDeal AI analysis and must never use a `NEXT_PUBLIC_`
prefix. Recovery Score calculation and refresh do not use this key or make an
OpenAI request. `OPENAI_STANDARD_ANALYSIS_MODEL` and
`OPENAI_DEEP_ANALYSIS_MODEL` select the server-only Standard and Deep models.
The bounded Prompt 15.3 benchmark chose Terra for both. If either is missing,
only the explicitly tested Terra legacy fallback is accepted for those two
analysis modes; another `OPENAI_MODEL` value cannot silently escalate their
cost. The legacy variable continues to serve existing AI Mapping and Auto
Convert fallback paths.
`OPENAI_AUTO_CONVERT_MODEL` separately selects the tested Luna Auto Convert
model. Keep `OPENAI_MODEL` only for older compatibility paths.

`APP_ORIGIN` must be one HTTPS origin with no path, query, credentials, or
fragment. Add the exact generated `/auth/confirm?next=/reset-password&type=recovery`
destination (or the narrowest matching production callback rule) to Supabase's
allowed redirect URLs. The callback accepts the default PKCE `code` return only
when that fixed recovery destination/type is present; it also preserves the
existing token-hash verification path for a reviewed custom email template.
`BILLING_ENFORCEMENT_MODE=SHADOW` is the required Prompt 15 rollout: metering
runs when the schema is present, while missing commercial schema or would-deny
decisions do not unexpectedly block current users. Do not enable `ENFORCED`
until Prompt 16 checkout, verified subscription webhooks, upgrade handling, and
owner billing QA are complete.

`BILLING_USAGE_AUTHORITY_SECRET` must be a cryptographically random 64-character
hex value held only in local/server secret storage. It must match the SHA-256
verifier embedded in the unapplied Prompt 15 migration. Never expose it through
a `NEXT_PUBLIC_` variable, response, log, or client component. Do not rotate it
independently after the migration is applied; use a reviewed forward migration
and coordinated environment cutover.

For production password reset, configure custom SMTP and a verified sending
domain; review the recovery email template; allowlist the exact production
callback; and test a real existing account, an unknown address, an expired
link, and a successful password update. Supabase's default sender is not a
production delivery strategy.

`.env.local` is ignored by Git. Never commit it. The two `NEXT_PUBLIC_` values
will eventually be available to browser code, so their safety depends on the
database grants and RLS policies in the migration.

## 4. Apply the migration

The source of truth is:

`supabase/migrations/20260810000000_initial_lostdeal_schema.sql`

Use one of the following methods. Apply it to a new project only once.

### Option A — Supabase SQL Editor

1. Open **SQL Editor** in the Supabase Dashboard.
2. Create a new query.
3. Open the migration file locally and copy its complete contents into the
   editor.
4. Review that the target shown in the Dashboard is the correct project.
5. Select **Run**.
6. Confirm that the query completes without an error.

If it fails, keep the full error message and stop. Do not repeatedly run a
partially applied script without understanding the error. The migration uses a
transaction, so ordinary failures should roll back its changes.

### Option B — Supabase CLI

The [Supabase CLI documentation](https://supabase.com/docs/guides/local-development/cli/getting-started)
describes installation and project linking. A typical flow is:

```bash
npx supabase init
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

- Run `npx supabase init` only if the repository does not already contain
  `supabase/config.toml`.
- The project reference is the subdomain portion of your Project URL.
- Login may open a browser or request a personal access token. Never commit
  that token.
- `db push` applies unapplied files from `supabase/migrations/` to the linked
  project.

A local Docker-based Supabase stack is useful for deeper testing but is not
required to apply this Prompt 3 migration to a hosted project.

## 5. Verify the tables and RLS

In **Table Editor**, confirm these six tables exist in the `public` schema:

- `profiles`
- `organizations`
- `organization_members`
- `uploads`
- `deals`
- `deal_analyses`
- `organization_subscriptions`
- `organization_usage_events`

Then open **SQL Editor**, paste the contents of
`supabase/tests/schema_checks.sql`, and run it. That file uses read-only
catalog queries and reports:

- whether every expected table exists;
- whether RLS is enabled;
- whether expected constraints, indexes, policies, triggers, and functions
  exist;
- whether `anon` received any application-table privilege;
- whether authenticated users can execute only the intended authorization
  helpers.

Every `present`, `rls_enabled`, and `configured_as_expected` result should be
`true`. The anonymous-grants result should return zero rows.

You can also run Supabase's **Security Advisor** and **Performance Advisor**.
The [advisor documentation](https://supabase.com/docs/guides/database/database-advisors)
explains what they inspect.

## 6. Understand the onboarding bootstrap

The first organization setup is intentionally a two-step operation:

1. The signed-in user inserts an organization with `created_by` equal to their
   own authenticated user ID.
2. That same user inserts the organization's first membership with themselves
   as `owner`.

Before the first membership exists, a narrow creator-only policy allows the
creator to read that organization. The initial membership policy succeeds only
when all of these are true:

- the caller created the organization;
- `user_id` is the caller's own user ID;
- `role` is `owner`;
- the organization has no membership yet.

As soon as the owner membership exists, ordinary membership becomes the access
mechanism. The helper functions are `SECURITY DEFINER` only to avoid recursive
RLS checks on `organization_members`; they live in a non-exposed `private`
schema, use an empty `search_path`, reference fully qualified table names,
return only booleans, and grant execution only to the `authenticated` role.

## 7. Test profile creation carefully

The migration adds a small trigger that creates `public.profiles` after a new
row is inserted into `auth.users`. Create a test user and confirm its profile
appears. Supabase explicitly warns that a broken `auth.users` trigger can block
signup, so investigate any signup database error before continuing.

See Supabase's [User Management guide](https://supabase.com/docs/guides/auth/managing-user-data)
for the recommended trigger pattern.

## Security rules to keep

- Never place a secret key, `service_role` key, database password, or personal
  access token in `NEXT_PUBLIC_` variables.
- Never disable RLS to make a frontend request work.
- Never rely on a frontend `organization_id` filter as the security boundary;
  the database policy is the boundary.
- Keep schema changes in versioned migration files.
- Do not grant application-table access to `anon` without a specific reviewed
  requirement.
- Test cross-organization access with two real test users before connecting
  production data.

Supabase's [Row Level Security guide](https://supabase.com/docs/guides/database/postgres/row-level-security)
and [Securing your API guide](https://supabase.com/docs/guides/api/securing-your-api)
explain why SQL grants and RLS must be used together.
