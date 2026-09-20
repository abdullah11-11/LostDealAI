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
