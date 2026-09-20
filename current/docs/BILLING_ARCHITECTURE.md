# LostDeal AI billing and entitlement architecture

Prompt 15.3 adds server-gated Deep Recovery Analysis on top of Prompt 15.2 Auto Convert and the Prompt 15.1 packaging. There is still no payment SDK, checkout, payment webhook, provider secret, card storage, or paid-plan activation.

## Server-authoritative flow

```text
CUSTOMER → FUTURE PROVIDER CHECKOUT → PADDLE
         → VERIFIED IDEMPOTENT WEBHOOK
         → ORGANIZATION SUBSCRIPTION STATE
         → CENTRAL PLAN CATALOG
         → SERVER USAGE RESERVATION / FEATURE GATE
```

- Paddle is the preferred future Merchant of Record, subject to approval; Lemon Squeezy is the fallback.
- A successful redirect never grants access. Only a verified provider API result/webhook may synchronize paid state.
- The browser cannot choose a plan, price, usage limit, period, enforcement mode, or usage authority.
- Provider events must be raw-body signature verified, time-window checked, and atomically deduplicated before effects.
- LostDeal AI stores no card number, CVV, or raw payment credential. Checkout and payment-method changes remain provider-hosted.

## Central catalog

`lib/billing/plans.ts` is the shared application entitlement source of truth. It defines:

- `INTERNAL`: hidden, non-purchasable, unlimited, owner/internal only.
- `TRIAL`: $0 / 14 days; 50 imports, 10 total AI Analyses, 3 AI Mapping requests, a future 25-row Auto Convert preview, and a future two-Deep-operation subset without live commercial access today.
- `STARTER`: $15/month; 250 imports, 30 Standard Analyses, 3 AI Mapping requests, no Deep Analysis, and 0 Auto Convert rows; complete Smart Mapping remains usable.
- `PRO`: $45/month; 1,500 imports, 250 total Standard/Deep Analysis operations, 30 AI Mapping requests, and 1,500 Auto Convert rows; commercial provider execution waits for Prompt 16.
- `BUSINESS`: Coming Soon, non-purchasable, no active usage schedule, and connected data false. It remains only for architecture compatibility.

Feature flags cover Standard Analysis, Smart Import, AI Smart Mapping, Auto Convert, Deep Analysis, normalized CSV export, Deal Intelligence, current batch analysis, and future connected data. Auto Convert and Deep Analysis are implemented with independent server gates; Deep provider execution is active only for `INTERNAL` while billing remains `SHADOW`.

## Database limit mirror

The already-applied Prompt 15 migration remains immutable. It created organization subscriptions, usage events, RLS/grants, trial bootstrap, owner `INTERNAL` backfill, and reservation/commit RPCs.

Because that migration hard-coded preliminary numeric limits in `private.plan_usage_limit`, Prompt 15.1 adds the smallest possible forward migration:

`supabase/migrations/20260902000000_prompt15_1_plan_limits.sql`

It only replaces the private limit function and reasserts its revokes. It creates no table, policy, trigger, grant, or public RPC. Business returns the existing invalid-plan sentinel so it cannot behave like a sellable tier. Apply it after Prompt 15 and run `supabase/tests/prompt15_commercial_checks.sql`.

Prompt 15.2 adds `supabase/migrations/20260902010000_prompt15_2_auto_convert_limit.sql`. It minimally extends the existing metric constraint and generic functions for `AUTO_CONVERT_ROWS`; no table or policy is added. Apply it after Prompt 15.1 and run the same commercial checks.

Prompt 15.3 adds `supabase/migrations/20260902020000_prompt15_3_deep_analysis.sql`. It adds bounded Standard/Deep mode, schema-version, Deep JSON, and timestamp columns plus the future Trial two-Deep-operation check inside the existing `AI_ANALYSES` reservation function. It creates no table, policy, usage metric, or service-role path. Apply it once after Prompt 15.2 and run the updated commercial checks.

The owner reports Prompt 15.3 applied and those checks passed. Prompt 15.3.1 added one forward-only runtime hardening migration, `supabase/migrations/20260905070000_prompt15_3_1_runtime_hardening.sql`, which is also owner-confirmed as applied. It added no table, metric, plan, price, payment object, or environment variable. It records an analysis-bound pending/committed usage marker, adds a narrow idempotent finalizer, moves AI-result and score writes behind membership plus the existing server-authority verifier, removes direct authenticated analysis DML, and adds tenant-checked global Recovery Score ordering.

Prompt 15.3.2 adds `supabase/migrations/20260905083511_prompt15_3_2_usage_reservation_runtime_hotfix.sql`. Owner QA exposed a PostgreSQL identifier-resolution defect in the current `INTERNAL` period branch: the local name `current_time` resolved as SQL `CURRENT_TIME`, so `date_trunc` received `time with time zone` and reservation stopped before the provider. The forward replacement renames the local clock and all uses to explicit `runtime_now timestamptz`, while preserving the function body and commercial/security contract otherwise byte-for-byte. It creates no overload, table, policy, plan, metric, grant on `private`, or data change. Apply it once after Prompt 15.3.1 and rerun the read-only commercial checks.

The owner subsequently applied and verified Prompt 15.3.2, the Prompt 15.3.3
Recovery Score sort authorization hotfix, and the Prompt 15.3.5 bounded Deep
diagnostic migration. Prompt 15.3.6 is application-only and adds no migration.
Its optional-field normalization cannot reserve, commit, refund, or otherwise
mutate usage. The existing analysis workflow remains the sole authority: a
failed Deep attempt commits zero, one validated and persisted Deep attempt
commits exactly one existing reservation, and stored reuse commits zero.

## Metered usage

- `IMPORTED_DEALS`: actual successfully inserted rows, including partial-batch success.
- `AI_ANALYSES`: one unit for each fresh explicit Standard or Deep provider-backed analysis that validates and persists. Standard then Deep is two operations; stored reuse and page loads are zero.
- `AI_MAPPING_REQUESTS`: one unit for a fresh explicit AI Smart Mapping result that validates.
- `AUTO_CONVERT_ROWS`: rows actually submitted through completed provider-backed Auto Convert batches, with a one-unit minimum for a successful schema-only provider job.

Trial's future Deep preview is a two-operation subset of its existing 10 `AI_ANALYSES` allowance; it is not a second credit. Auto Convert does not also consume AI Mapping or Deal Analysis units. Deterministic/manual mapping, normalization/download, Recovery Score, dashboard/detail/account/page loads, themes, and outreach consume no usage and make no automatic OpenAI call.

Reservation and commit RPCs remain organization-scoped, idempotent, advisory-lock protected, and authorized by membership plus the 256-bit server-only usage authority. Standard/Deep persistence now first records the exact reservation key as `PENDING`, then an analysis-bound finalizer commits that existing reservation and marks the result `COMMITTED`. If finalization remains transiently unavailable after two bounded attempts, the stored analysis is preserved with an explicit pending-reconciliation state; a retry finalizes it without another provider call. The browser has read-only approved subscription/aggregate usage and AI-result access, with no direct plan, usage, analysis, model-metadata, or score DML grant. No `service_role` secret is used in normal runtime.

## Enforcement mode

- `OFF`: no database metering requirement.
- `SHADOW` (required now): records usage when the current limit mirror is available, calculates would-deny results, and preserves existing access while billing is unavailable.
- `ENFORCED`: future fail-closed behavior after provider and customer lifecycle QA.

Keep `BILLING_ENFORCEMENT_MODE=SHADOW`. Only `INTERNAL` may execute provider-backed Auto Convert or Deep Analysis in this mode; Trial/Pro feature access additionally requires future `ENFORCED` mode and a verified compatible subscription. The final Prompt 15.3.6 owner Deep runtime gate now passes, but do not enable `ENFORCED` until Paddle is approved, verified subscription synchronization and upgrade paths exist, customer messaging is ready, and billing sandbox/owner QA passes.

## Future implementation checklist

1. Keep the verified Prompt 15.3.x database migrations immutable and remain in `SHADOW`.
2. Owner Prompt 15.3.6 Synthetic Juniper Deep run is complete: success `+1`, reload `+0`, and privacy-safe fresh logs verified.
3. Confirm Paddle approval and exact product/price configuration.
4. Prompt 16 adds authenticated checkout creation, signed idempotent webhooks, safe status mapping, hosted portal, cancellation/upgrade flows, and lifecycle tests.
5. No Business checkout or connected-data entitlement is enabled until the post-V1 connected product actually exists.

## Prompt 16 sandbox implementation

The sandbox Paddle foundation is implemented with a public, signed Supabase Edge webhook while the application remains private. See [Prompt 16 architecture and owner runbook](PROMPT_16_PADDLE_BILLING.md) for trust boundaries, exact prices, usage preservation, configuration and the mandatory owner webhook checkpoint. This supersedes earlier statements that billing integration is unimplemented; it does not represent completed sandbox end-to-end acceptance or live billing authorization.
