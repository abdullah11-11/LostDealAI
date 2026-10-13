# LostDeal AI V1 production security checklist

Current development/activation status is documented in
[the activation runbook](COMMERCIAL_ACTIVATION_RUNBOOK.md). Completed entries
below retain dated milestone evidence; external configuration and real-world
acceptance remain separate gates. Production is still Version 49,
owner-private, Sandbox/SHADOW. The Live authority proposal is unapplied.

Use this checklist before expanding access beyond the current owner-only Site.

## Application controls

- [x] Verified server identity uses Supabase `getClaims()`.
- [x] Active organization is resolved server-side; browser organization IDs are never authorization truth.
- [x] RLS remains enabled on the eleven public application tables in the accepted Prompt 17/18 source and catalog evidence; new private Live proposal tables require their own isolated/persistent acceptance.
- [x] Mutation API routes enforce same-origin/Fetch Metadata checks and expected content types.
- [x] Distributed D1 rate limiting protects AI, upload, scoring, and deal-deletion mutations.
- [x] Forgot Password uses the same D1 architecture at 5 attempts per 15 minutes with a SHA-256 hashed normalized-email key; raw email is not stored in limiter telemetry.
- [x] Password update requires a verified Supabase recovery session plus a short-lived HttpOnly, SameSite recovery marker; reset tokens and passwords are never logged.
- [x] Plan entitlements and rollout mode are server-owned. Browser code cannot assign a plan or select `OFF`/`SHADOW`/`ENFORCED`.
- [x] Usage reservation/commit requires a server-only authority secret whose database migration stores only a SHA-256 verifier; direct authenticated browser RPC calls cannot forge usage.
- [x] Authenticated clients have read-only AI-result access; analysis, Deep payload, model metadata, analysis state, and Recovery Score writes use narrow membership-checked server-authorized RPCs.
- [x] A successful persisted analysis is marked usage-pending until an idempotent analysis-bound finalizer commits exactly one existing reservation; retry reconciliation performs no second provider call.
- [x] Paid AI actions reserve organization quota before provider execution; enforced over-limit decisions produce zero provider calls.
- [x] AI authorization, authoritative deal retrieval, and the processing claim occur before OpenAI.
- [x] Manual AI trigger, 25-deal server batch cap, duplicate-call protection, one bounded transient retry, 50,000-character source cap, and token metadata remain active.
- [x] Security headers include CSP, frame denial, MIME sniffing protection, referrer policy, permissions policy, and HTTPS HSTS.
- [x] Authenticated pages and protected API responses are private/no-store.
- [x] CSV bytes are not retained; only structured rows and safe upload metadata are stored.
- [x] Errors and normal logs exclude source text, cookies, JWTs, provider payloads, and secrets.
- [x] Deep optional-field repair is allowlisted and field-local; critical fabrication, unsupported claims, invalid critical evidence, and prompt-injection output remain whole-operation failures before persistence.
- [x] Prompt 12 source, public assets, client bundle, and backup are scanned for secrets.
- [x] Production contains the Prompt 12 deal-delete constraint, tenant policy, authenticated grant, and analysis cascade.
- [x] `supabase/tests/prompt12_security_checks.sql` passes against production.
- [x] Owner applied `supabase/migrations/20260901000000_prompt15_commercial_foundation.sql`.
- [x] Owner applied `supabase/migrations/20260902000000_prompt15_1_plan_limits.sql`, `20260902010000_prompt15_2_auto_convert_limit.sql`, and `20260902020000_prompt15_3_deep_analysis.sql`; prior commercial checks passed.
- [x] Owner applied `supabase/migrations/20260905070000_prompt15_3_1_runtime_hardening.sql` once after Prompt 15.3.
- [x] Prompt 15.3.2 deterministic guards prove the reservation replacement removes ambiguous `current_time` while otherwise preserving the authorized function, plan limits, tenant checks, locks, idempotency, expiration, and grants.
- [x] Intended reservation calls reached both private helpers under `SECURITY DEFINER`; unrelated older permission-probe logs do not justify broad `private` schema access, and none is granted.
- [x] Owner applied `supabase/migrations/20260905083511_prompt15_3_2_usage_reservation_runtime_hotfix.sql`; Standard and Deep each completed with exactly one committed unit and fresh logs were clean.
- [x] Owner applied and verified `supabase/migrations/20260906080228_prompt15_3_3_recovery_sort_rpc_auth_hotfix.sql`; authenticated same-organization sort works without granting client access to the private schema.
- [x] Owner applied and verified `supabase/migrations/20260908055554_prompt15_3_5_deep_semantic_diagnostic_hardening.sql`; arbitrary diagnostics and direct authenticated diagnostic writes remain denied.
- [x] Prompt 15.3.6 adds no migration and preserves every prior migration hash, protected RPC, RLS policy, grant, usage rule, and diagnostic allowlist.
- [x] Prompt 15.3.6 synthetic Terra canary passed with `store:false`, zero persistence writes, zero customer usage events, and no second provider call.
- [x] Owner Synthetic Juniper Deep run completed after Prompt 15.3.6: persisted Deep with `NO_RESPONSE`, exactly one committed unit, reload `+0`, and privacy-safe fresh logs.
- [x] Prompt 15.3.7 rollback-only tenant probes pass for same-organization reads/writes, cross-organization denial, anonymous denial, and protected-column denial.
- [x] Prompt 15.3.7 adds no migration and preserves all ten migration hashes, model locks, plan limits, scoring behavior, and provider-call boundaries.

## External production configuration

- [ ] Configure a production custom domain and verify HTTPS/HSTS behavior.
- [ ] Set the Supabase Site URL to the production origin.
- [ ] Allowlist only required Supabase redirect URLs.
- [ ] Keep anonymous sign-ins OFF.
- [ ] Keep unused authentication providers OFF.
- [ ] Keep `OPENAI_API_KEY` server-only; never use a `NEXT_PUBLIC_` prefix.
- [ ] Keep `APP_ORIGIN` set to the exact HTTPS production origin and allowlist only the required Supabase callbacks.
- [ ] Keep `BILLING_ENFORCEMENT_MODE=SHADOW` until verified checkout/subscription synchronization and billing QA exist.
- [ ] Keep `BILLING_USAGE_AUTHORITY_SECRET` server-only and synchronized with the migration verifier; never rotate either side independently.
- [ ] Configure custom SMTP, SPF/DKIM/DMARC, and live password-recovery delivery before commercial launch.
- [ ] Keep Supabase service-role/secret keys and database credentials out of client code and Sites source.
- [ ] Verify RLS and least-privilege grants on every public application table after each migration.
- [ ] Set provider-side OpenAI budget limits and usage alerts.
- [ ] Define backup and restore procedures and test restoration.
- [ ] Define privacy-safe logging, monitoring, alerting, and incident-response ownership.
- [ ] Schedule deletion of synthetic security-test accounts and rows.
- [ ] Prepare reviewed privacy policy and terms before commercial launch.

> **Production launch requirement: enable verified email confirmation after custom SMTP/domain is configured.**

Development Confirm Email may intentionally remain off. Do not enable production
confirmation until the sending domain, SMTP delivery, confirmation URL, and
support/recovery path have been tested. Prompt 12 does not change remote
Supabase authentication settings.

## Distributed rate limits

Limits are fixed server-side and keyed by verified user ID plus allowlisted
action. Browser payloads cannot select an action, limit, window, or batch size.
The D1 increment is atomic across workers; old windows are pruned after 24
hours. If the shared backend is unavailable, protected mutations fail closed.

| Action | Limit | Window |
| --- | ---: | ---: |
| Single AI analysis | 8 | 10 minutes |
| Batch AI analysis | 2 | 15 minutes |
| Upload validation | 20 | 10 minutes |
| Upload import | 6 | 10 minutes |
| Single deterministic score | 60 | 10 minutes |
| Batch score / refresh | 40 | 10 minutes |
| Deal deletion | 10 | 10 minutes |
| Forgot password (hashed normalized email) | 5 | 15 minutes |

Blocked requests return `429 Too Many Requests` with a bounded `Retry-After`
value and a generic message. Normal read-only navigation is not rate-limited.

## Security-header compatibility

The CSP denies framing, objects, foreign forms, and non-self scripts. The current
Vinext runtime requires compatible inline script/style allowances; a nonce-based
CSP is a future hardening option once the hosting runtime exposes a stable nonce
pipeline. `connect-src` permits only same-origin requests and Supabase HTTPS.

## Dependency and database advisor record

The Prompt 15.3.7 production audit (`npm audit --omit=dev`) reports zero
critical, high, moderate, or low findings after advancing the compatible
transitive `baseline-browser-mapping` package. No direct runtime dependency or
application behavior changed.

The broader development audit reports zero critical, two high, zero moderate,
and one low finding. Both high findings resolve to Vinext's build-only
`image-size@2.0.2` dependency; npm offers only a semver-major Vinext beta as the
automated fix. The low Babel finding likewise has no compatible 7.x fix and
requires Babel 8. Neither dependency is in the production dependency audit or
hosted request path. Review those major toolchain upgrades in a separate
compatibility milestone rather than coupling them to this omnibus closure.

Current Supabase advisor warnings are pre-existing and Prompt 15.3.7 adds no
DDL. Authenticated execution warnings for the protected analysis/usage RPCs are
expected because those functions intentionally combine authenticated PostgREST
discovery with server-authority and tenant-membership verification. Separate
commercial-launch review remains required for the public `rls_auto_enable()`
helper, leaked-password protection, four unindexed foreign keys, and one unused
index. No broad private-schema or direct AI-result write grant was introduced.

## Known scoped limitations

- Production email confirmation awaits custom SMTP/domain configuration.
- Workspace, organization, and account deletion are not implemented in Prompt 12.
- Formal privacy/legal documents are external launch deliverables.
- Free-text notes/transcripts may contain customer-provided personal data.
- The configured external AI provider processes relevant source only after an explicit Analyze action.
- Monitoring and alert delivery depend on deployment/provider capabilities and operator setup.
