# Prompt 16 — Paddle sandbox billing foundation

Status: implementation checkpoint; provider simulator and sandbox end-to-end acceptance remain owner-required. Prompt 17 and commercial launch are NO-GO. Baseline: release 38, commit 8b619e440ef3f7b6da2ac663dc63fb7996c2c58e.

## Architecture and trust

The existing LostDeal Site remains owner-private. Paddle cannot reach a private Site route through its hosting authentication. The only public ingress is the Supabase Edge Function `paddle-webhook`, with JWT verification disabled for that function alone. It verifies the Paddle signature on timestamp plus exact streamed raw bytes using Web Crypto, accepts a five-second timestamp tolerance and multiple rotating signatures, and limits input to 256 KiB. Missing/bad signatures fail; missing environment/secrets fail closed. GET returns 405. No browser callback grants entitlements.

Endpoint: https://usdgvzcheutgcmawiiog.supabase.co/functions/v1/paddle-webhook

The Edge function uses a publishable Supabase key and the existing billing authority secret to invoke only `synchronize_paddle_subscription`. It never uses a service-role key. The RPC checks the existing authority verifier, an opaque checkout intent for initial binding, exact plan prices, subscription/customer consistency, event identity and event time. Subscription locking, unique event receipts and transactional writes prevent duplicates and partial changes. Equal/older events are ignored. Owner reconciliation uses the same normalizer/RPC and an optimistic last-event guard; recent mutations cannot be overwritten. No raw webhook, payment data, portal URL, or provider response is stored.

The single forward migration is `20260916095842_prompt16_paddle_billing_foundation.sql`. Ten historical migrations remain byte-identical. Two small tables hold 30-minute checkout intents and bounded event receipts; direct anonymous/authenticated access is revoked and RLS is enabled. Existing subscription rows receive minimal provider metadata and operation locks. All billing functions use an empty search path and explicit grants. Owner actions additionally require membership/owner authorization. Existing authority, tenant and usage contracts remain in force.

## Sandbox configuration

| Plan | Monthly price | Paddle price ID |
|---|---|---|
| Starter | $15 | pri_01m2mqgrjazqnz7wyex9p7dyt8 |
| Pro | $45 | pri_01m2mqs3q7f9r0kyqzmrt6gkgg |

No annual billing, Paddle trial, live environment, or Business self-service. Internal remains unlimited and excluded from billing. SDKs are pinned: @paddle/paddle-js 1.6.5 and @paddle/paddle-node-sdk 3.10.0. Paddle.js loads only after an explicit checkout action. Ordinary page loads read local billing state and make no Paddle API call. Account navigation uses a document request so the narrow account-only sandbox CSP applies.

Private Site runtime variables:
- PADDLE_ENVIRONMENT=sandbox
- PADDLE_STARTER_PRICE_ID and PADDLE_PRO_PRICE_ID: exact IDs above
- PADDLE_CHECKOUT_ENABLED=false until the owner checkpoint is verified
- PADDLE_API_KEY: sandbox API key, secret
- NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: sandbox test_ token (public client identifier)
- Existing BILLING_USAGE_AUTHORITY_SECRET remains unchanged and secret.

Edge secrets/configuration:
- PADDLE_ENVIRONMENT=sandbox
- PADDLE_WEBHOOK_SECRET: destination signing secret, secret
- BILLING_USAGE_AUTHORITY_SECRET: same existing authority value, secret
- SUPABASE_URL: platform-provided project URL
- SUPABASE_PUBLISHABLE_KEYS default entry, or LOSTDEAL_PUBLISHABLE_KEY: project publishable key

Do not paste credentials into chat, source, logs, or screenshots. Use the private Site runtime-secret editor and Supabase Edge Function Secrets settings. The Edge function intentionally does not read platform service-role credentials. Merely deploying it does not prove its required secrets are present.

## Subscription behavior

Checkout accepts only a server-approved plan, quantity one, authenticated owner email and opaque intent ID. Repeated same-plan clicks reuse the unexpired intent; conflicting plan selection fails. Expired/consumed intents cannot bind a new subscription. An organization cannot acquire a second synchronized active subscription. Browser completion only polls local synchronization for a bounded interval.

Upgrade Starter to Pro: prorated_immediately and prevent_change on payment failure. Downgrade Pro to Starter: immediate plan change, prorated_next_billing_period credit. Local entitlements change only after verified synchronization, never from the API mutation response. Cancellation is next_billing_period; active scheduled-cancel access continues until canceled. past_due, paused, canceled and unexpected trialing block new provider-backed work. Historical analyses, Deep results and Auto Convert results remain readable. Starter denies new Deep/Auto Convert.

Global billing mode stays SHADOW. Paddle-backed workspaces enforce existing quotas and active status even in SHADOW/OFF. Internal and existing trials retain their prior policy. Purchase, upgrade, downgrade and cancellation do not reset usage or trial eligibility. The original usage period remains anchored; paid periods roll forward monthly after expiry, with PostgreSQL month-end clamping mirrored in the usage display. Existing usage events are never deleted or rewritten by synchronization.

Owner mutation routes require same-origin JSON, strict bounded bodies and six requests per ten minutes. Provider calls time out after ten seconds and are not retried automatically. An ambiguous mutation leaves an operation lock until a matching webhook or owner reconciliation (after at least two minutes) confirms state. Reconciliation cannot discover an unbound initial purchase; the signed initial event must arrive. Portal sessions use stored customer/subscription IDs and return only the scoped subscription payment-method URL; no general customer-wide portal link is exposed.

## Owner webhook setup checkpoint

1. Open Paddle Sandbox → Developer tools → Notifications → New destination.
2. Choose webhook delivery and enter the exact public Edge endpoint above. Select these seven events:
   subscription.created, subscription.updated, subscription.activated, subscription.past_due, subscription.paused, subscription.resumed, subscription.canceled.
3. Save the destination and securely set its signing secret as PADDLE_WEBHOOK_SECRET in Supabase Edge Function Secrets. Set the Edge environment and existing authority value as listed above. Do not create a new authority value; its hash must match the existing database verifier.
4. Securely configure the private Site sandbox API key and test_ client token if absent. API permissions must allow reading/updating subscriptions and creating customer portal sessions; no catalog-write permission is needed. Verify exact permission labels against the current Paddle key editor. Never substitute a live key.
5. Tell the assistant setup is complete, without sharing secrets. Keep checkout disabled until signed delivery and database connectivity have been verified.

Resume from this checkpoint: verify signed simulator deliveries, duplicates, older events, all seven lifecycle types and subscription synchronization. Then enable sandbox checkout deliberately and perform one bounded Starter purchase in a dedicated synthetic QA workspace, followed by upgrade, downgrade, portal and scheduled cancellation tests. Assert no usage/trial reset, no historical-data loss, correct status denial and one subscription per workspace. Do not test in Internal or use real payments. Do not run paid OpenAI benchmarks.

## Validation and operations

`tests/prompt16-billing.test.ts` covers the HMAC/raw-body boundary, request bounds, exact sandbox prices, fixture normalization, SDK request serialization, entitlement states, origin constraints, CSP and monthly display. `supabase/tests/prompt16_billing_checks.sql` is self-contained BEGIN/ROLLBACK and verifies owner/member/cross-organization/direct-write boundaries, initial binding, duplicate/stale events, operation locks, lifecycle transitions, intent replay and preservation of all four usage metrics. Its temporary synthetic authority helper must never be committed to the database. Always execute the whole file, including ROLLBACK.

Operational failures return bounded generic errors, not raw provider details. Inspect event receipt outcomes and synchronized local state; do not retain raw webhook bodies. Missing signing secret, authority or publishable key is a setup blocker, not permission to bypass signature verification. Failed API mutations should be reconciled, not blindly retried. Rotate keys/secrets through their runtime settings; signature verification accepts multiple h1 values during Paddle rotation. Future live activation requires separate authorization, new live credentials/price validation, complete sandbox acceptance, legal/email/monitoring work and launch QA.

Economic model remains historical and deterministic, not a provider benchmark: documented stress costs Starter $9.55 (36.33% contribution margin) and Pro $20.53 (54.38%). Owner review of commercial assumptions remains required. Models, Recovery Score v1.0 and plan allowances are unchanged.

## Release verification record

Deterministic gates: 51/51 targeted billing tests, 612/612 full TypeScript tests (including 13 UI checks), 2/2 rendered checks, lint, typecheck and production build pass. Production dependency audit reports 0 critical/high/moderate/low findings. Source, generated client and public assets pass credential-pattern scans. Provider API calls and paid OpenAI calls: zero; SDK HTTP behavior is mocked.

Database application sequencing incident: the canonical migration includes its own BEGIN/COMMIT. Combining that file with an outer rollback proof committed the authorized schema before migration-history registration. The later apply command rejected the already-present column without changing it. All seven applied function bodies were then compared byte-for-byte with the canonical migration, including SECURITY DEFINER and empty search paths; the production authority hash was intact and synthetic fixture rows/receipts were absent. The exact canonical SQL and version were registered in migration history without replaying DDL. The standalone self-wrapped rollback proof subsequently passed. The migration is applied; do not reapply it. Future pre-apply proofs must strip migration transaction boundaries or use an isolated database.

Supabase advisor results are not zero: two intentional RLS-without-policy notices for RPC-only billing tables; one new anonymous definer warning for the secret-authorized sync RPC; four new authenticated definer warnings for owner/authority-gated billing RPCs. Pre-existing rls_auto_enable exposure, other authenticated RPC notices and disabled leaked-password protection remain launch review items. No direct table grants or broad private-schema access were added.

References: [RLS policy notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous definer review](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated definer review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Authority rotation — phase 1, 17 September 2026

Owner-authorized temporary dual-verifier migration: `20260917144440_prompt16_authority_dual_verifier.sql`. Supabase recorded the connector application as version `20260917144725`, name `prompt16_authority_dual_verifier`. The connector-generated timestamp differs from the local CLI-generated filename; this is one applied migration, not two. Do not replay it.

Exactly four active direct checks accept the old and owner-supplied new SHA-256 digests: private.assert_analysis_runtime_authority, private.assert_billing_authority, public.reserve_organization_usage and public.commit_organization_usage. The migration reads existing definitions and changes exactly one comparison per function, aborting on unexpected verifier sets, security settings or comparison shape. It verifies unchanged function OIDs, ACLs, owner and configuration. No embedded transaction boundary can escape a rollback proof.

The raw new secret is unavailable to this implementation and was never requested, generated or stored. Old/new acceptance is verified deterministically by the deployed comparison and digest truth table; live invocation using the new secret is OWNER CUTOVER PENDING. No claim of a new-secret live call is made. Random, empty and null authority inputs were rejected by all four functions before and after application (12 checks); three authenticated-client mutation/fabrication checks passed. The existing billing rollback proof passed for owner/member/cross-org boundaries and lifecycle behavior. Before/after snapshots of all public/private function permissions, table RLS/policies and Internal subscription rows matched exactly.

Validation: authority 8/8, existing billing 51/51, combined targeted 59/59, full TypeScript 620/620 (including UI 13/13), rendered 2/2, lint/typecheck/build and credential-pattern scans PASS. All eleven previous migration files are byte-identical to release 39. No application, Edge code, environment value, provider model or checkout setting was changed. No OpenAI call, Paddle purchase or other Paddle business API request was made.

Next owner action: set BILLING_USAGE_AUTHORITY_SECRET to the SAME locally held new secret in both the private Site's secret configuration and Supabase Edge Function Secrets, then report completion without sending the value. The old verifier remains temporarily accepted so existing runtime remains compatible during configuration and Site redeployment. Keep PADDLE_CHECKOUT_ENABLED=false. Resume to apply/verify the new Site environment revision and the Edge-to-RPC path. Only after both are verified may a separately authorized phase remove old-digest acceptance. Prompt 17 and Live Paddle remain out of scope.

## Paddle Sandbox Simulator event-ID compatibility — 21 September 2026

The official Paddle Sandbox Simulator delivered a correctly signed `subscription.updated` event with an `ntfsimevt_<26 lowercase alphanumeric>` event ID. Signature verification passed, but the shared normalizer and database RPC both rejected the simulator-specific ID because they allowed only the normal platform form `evt_<26>`. The compatibility hotfix adds a dedicated Edge event-ID validator and the forward migration `20260921064300_prompt16_paddle_simulator_event_id_compat.sql`. Supabase recorded the connector application as version `20260921065049`, name `prompt16_paddle_simulator_event_id_compat`; this is the same migration. Both boundaries now accept exactly `^(?:evt|ntfsimevt)_[a-z0-9]{26}$` in TypeScript and the equivalent anchored PostgreSQL union. Other prefixes, wrong lengths, uppercase and illegal characters remain denied; subscription and customer ID validation is unchanged.

The migration reads the deployed `synchronize_paddle_subscription(text,jsonb,text)` definition, replaces exactly one platform-only predicate, and aborts unless the existing owner, ACL, `SECURITY DEFINER`, and empty `search_path` invariants remain identical. `billing_event_receipts.event_id` already stores bounded text up to 100 characters, so no table or constraint change is required. Exact provider IDs remain the receipt primary key for honest idempotency and auditability. No raw webhook is stored.

Authority rotation remains in the temporary dual-verifier state. The old digest must not be removed until one post-deployment replay returns HTTP 200 with `MISSING_CHECKOUT_INTENT`, proving the signed Edge path reaches the protected RPC with the newly configured authority secret. Checkout remains disabled, secrets remain unchanged, and no purchase or paid AI call is part of this hotfix.

Validation: simulator compatibility 17/17, existing billing 51/51, authority rotation 8/8, combined targeted 76/76, full TypeScript 637/637, UI 13/13, rendered 2/2, lint, typecheck, production build, hosted-artifact validation, dependency audit and credential-pattern scans PASS. The connected rollback proof and post-apply proof each accepted both legitimate event-ID classes, rejected ten malformed/null classes, and returned `MISSING_CHECKOUT_INTENT` without leaving a receipt. All twelve release-40 migration files remain byte-identical. Supabase security/performance advisor counts are unchanged.

## Authority rotation finalization — 21 September 2026

The owner proved the new authority live on both runtime paths before cleanup. The private Site imported synthetic deal `AUTH-ROTATION-QA-001`, committing one `IMPORTED_DEALS` unit through `reserve_organization_usage` and `commit_organization_usage`, then completed Refresh Scores without an OpenAI analysis. The signed Paddle Sandbox replay returned HTTP 200 with `MISSING_CHECKOUT_INTENT`; receipt `ntfsimevt_01m31djb4f769gny4w30ecbe3v` records safe execution through the Edge function and protected billing RPC without an organization binding or entitlement change. These legitimate QA records remain intact.

The final forward migration is `20260921073247_prompt16_authority_rotation_finalize.sql`. Supabase recorded its one connector application as remote version `20260921074120`, name `prompt16_authority_rotation_finalize`. It re-inspects the exact four direct verifiers, requires their temporary old/new predicate and existing security configuration, then replaces only that predicate with a new-digest-only comparison. It verifies unchanged OIDs, owners, ACLs, `SECURITY DEFINER`, empty `search_path`, and complete surrounding definitions, and aborts if any old digest remains active. All four deployed bodies contain only the new digest; old-digest references remain only in immutable migration history. No environment value, application/Edge code, RLS policy, grant, usage row, subscription, billing receipt, model, plan, or price changed in this phase.

Post-apply checks passed: 10/10 finalization tests; 86/86 combined authority, billing, and simulator tests; 647/647 full TypeScript tests; rendered 2/2; UI 13/13; lint, typecheck, production build, artifact validation, production dependency audit, credential scans, rollback billing lifecycle proof, and simulator SQL proof. Random, empty, null, authenticated-client, anonymous-client, and direct-table authority fabrication remain denied. RLS remains enabled, tenant boundaries remain intact, the Edge function remains version 6 with Paddle HMAC authentication, and GET/unsigned/bad-signature requests return 405/400/400. Site environment revision 12 is unchanged and checkout remains disabled.

The authority rotation is closed. Prompt 16 Sandbox commercial E2E is the next gate. Its first separately authorized action is deliberate checkout enablement followed by one dedicated Sandbox Starter purchase. Prompt 17 and Paddle Live remain out of scope.

## Re-upgrade rejection recovery — 22 September 2026

The owner completed one Starter checkout, one Starter-to-Pro upgrade, and one Pro-to-Starter downgrade. The downgrade was applied by Paddle and synchronized locally, including its credit. A later Starter-to-Pro re-upgrade returned from the application as HTTP 503 in under one second, produced no provider email or webhook, and left the subscription correctly at Starter. The request used the approved Pro price, `prorated_immediately`, and `prevent_change`. Paddle's immediate-charge rate limits fit this sequence, but the exact historical provider error code, status, body, and request ID cannot be reconstructed: Paddle Node SDK 3.10.0 converts the raw response to `ApiError` without retaining response status or metadata, and the old route discarded that error. Do not invent a historical provider response.

The recovery hardening classifies only a bounded `ApiError` `request_error` as a definitive pre-mutation rejection. It records only safe provider type/code and retry timing, returns actionable bounded UI guidance, and invokes `abort_billing_operation` with the exact opaque token returned by `begin_billing_operation`. The new forward migration is `20260922083319_prompt16_billing_operation_rejection_recovery.sql`. Its owner- and authority-gated RPC clears only a matching operation token; a wrong/stale token is a no-op. Provider/API errors, timeouts, transport failures, malformed metadata, and cleanup failures remain locked for provider-backed reconciliation. No plan, entitlement, provider ID, usage period, usage event, checkout intent, or Internal workspace data is changed by this RPC.

The migration intentionally does not clear the historical Northstar marker. Release 43 originally asked the owner to use **Refresh billing status** once. That instruction exposed a UI ambiguity because the billing card also contained a separate **Refresh status** control that only re-read local state. The owner used the local-only path, so no provider read, reconciliation RPC, receipt, or marker cleanup occurred. Do not ask for another upgrade as part of this checkpoint.

## Reconciliation UI and observability — 22 September 2026

The billing card now exposes one owner-facing provider verification action: **Verify billing status**. The competing manual local-status refresh control is removed. Page load and post-action polling may still read local status internally, but no second control can be mistaken for reconciliation. Owner status responses expose only a safe `operationPending` boolean derived through the existing owner-authorized billing RPC; no operation token, provider identifier, raw error, or database identifier reaches the browser. A pending operation disables plan changes and cancellation while keeping verification available.

The reconciliation route remains read-only toward Paddle: it performs one subscription GET, validates the stored subscription/customer binding, normalizes the bounded state, and invokes the existing protected reconciliation RPC. Server diagnostics now record only four bounded stages—request started, provider read succeeded, RPC invoked, and a predefined outcome. They contain no credentials, authorization headers, organization/subscription identifiers, request IDs, raw tokens, provider payloads, or provider error bodies.

No migration, RLS policy, grant, authority secret, webhook behavior, pricing, plan limit, usage rule, or Paddle mutation path changed. The rollback-only database proof now also verifies that an eligible stale operation is cleared by owner reconciliation, a non-owner reconciliation is denied, and the valid Starter subscription plus usage anchors remain unchanged.
