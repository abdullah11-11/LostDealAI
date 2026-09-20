# AI Auto Convert

AI Auto Convert is LostDeal AI's higher-automation entry point into the existing Smart Import pipeline. It prepares supported messy CSV data for review, canonical download, and explicit import; it does not create a second parser, schema, normalization engine, duplicate system, or import path.

## Product availability

| Plan | Allowance | Current behavior |
|---|---:|---|
| Internal | Unlimited | Provider execution is available to the owner workspace in `SHADOW` mode. |
| Trial | 25 rows | Future verified-billing preview; provider execution is inactive before Prompt 16. |
| Starter | 0 rows | Auto Convert is locked; complete deterministic/manual Smart Mapping remains available. |
| Pro | 1,500 rows | Entitlement and future enforcement are implemented; provider execution is inactive before Prompt 16. |
| Business | None | Coming Soon, non-purchasable, and not exposed as a connected product. |

The Upload page shows a restrained Pro teaser to Starter users only after a messy/non-canonical file is selected. There is no checkout, payment provider, fake upgrade flow, or browser-controlled entitlement. Pro/Internal users can always choose **Use Smart Mapping instead**.

## One authoritative pipeline

Both Smart Mapping and Auto Convert reuse:

- Papa Parse and the existing 5 MB / 2,000-row UTF-8 CSV contract;
- the ten canonical LostDeal fields;
- deterministic aliases, column profiles, mapping recipes, and merge strategies;
- value normalization and row validation;
- formula-safe canonical CSV export;
- the existing explicit duplicate-aware import route.

Auto Convert adds automation before the same authoritative validation and import boundary.

## Deterministic-first orchestration

1. Authenticate the user and resolve the organization on the server.
2. Resolve the server-owned plan and current rollout state.
3. Enforce same-origin, multipart shape, the D1 start limit, and a tenant-scoped operation identifier.
4. Parse the file with the shared CSV parser.
5. Apply deterministic mappings, merges, and normalization first.
6. Reserve `AUTO_CONVERT_ROWS` before any provider request.
7. If needed, run one bounded Structured Outputs schema-mapping request.
8. Send only unresolved fields and selected relevant source columns through dynamically sized extraction batches.
9. Validate every proposed extraction against its supplied source evidence.
10. Commit only rows whose provider batch completed, validate the canonical result through the existing validator, and return it to the current browser session.

Complete deterministic rows make zero provider calls. A successful provider-backed schema-only job has a one-unit minimum. Auto Convert never decrements `AI_MAPPING_REQUESTS` or `AI_ANALYSES`.

## Extraction and trust policy

Provider extraction is limited to:

- `external_deal_id`
- `customer_name`
- `deal_value`
- `quote_date`
- `status`
- `salesperson`
- `service_type`
- `lead_source`

`sales_notes` and `transcript` remain customer-provided source data. They may be deterministically merged or source-labelled, but the model is not allowed to rewrite or summarize them.

The provider response is strict Structured Output. Every extracted value includes a source column and contiguous evidence excerpt. The server then enforces target-specific checks: values and dates must match safe source expressions, statuses need supported loss meaning, and identity/service/source fields need explicit contextual attribution. Unsupported, ambiguous, low-confidence, or conflicting output is rejected and surfaced as review rather than invented.

Won, Sold, Completed, accepted-proposal, and paid-deposit evidence cannot be converted to Lost. A blank status remains reviewable rather than inheriting a silent Lost decision. Deterministic mapped critical values win over contradictory text extraction.

## Provenance and source preservation

Temporary review provenance includes row reference, target, normalized value, confidence, source column, and evidence. It stays in the browser workflow and is not added to a new database model. Source text used for extraction remains in `sales_notes` or `transcript` under existing storage limits so future Deal Analysis can remain grounded.

If source text cannot be preserved safely, the extraction is not silently applied. Details returned to the browser are bounded, collapsed by default, and rendered as text rather than executable HTML.

## Privacy and security

- Raw and normalized CSV files are not persisted by Auto Convert.
- Responses API calls explicitly set `store: false`.
- Headers and row values are treated as untrusted data, including prompt-like text.
- No customer-data web search or external enrichment is performed.
- No raw rows, notes, transcripts, source snippets, provider payloads, secrets, cookies, or sessions are logged.
- The client cannot provide an organization, plan, allowance, model, or enforcement mode.
- Normal page loads make zero OpenAI calls and zero Recovery Score writes.
- Auto Convert does not analyze deals, calculate Recovery Scores, or contact customers.

The dedicated start limit is three Auto Convert starts per authenticated user per 15 minutes. A second D1 key protects each tenant-scoped operation identifier. The generic usage ledger remains advisory-lock protected and idempotent.

## Batching, failure, and retry

Row extraction uses at most 25 rows, eight source columns, 8,000 aggregate source characters per row, 6,000 characters per source value, and 24,000 serialized request characters per batch. Up to four provider batches run concurrently inside the same reserved job; this is not exposed as extra user starts. Important over-limit source values are omitted with an explicit review issue rather than truncated silently.

If a later provider batch fails, successful rows remain in the browser session, only completed batch rows are committed as usage, and unresolved row references can be retried with the same server-validated mapping recipe and a new operation. The original selected file remains unchanged and Smart Mapping stays available as the fallback.

## Model and cost configuration

`OPENAI_AUTO_CONVERT_MODEL` is optional and server-only. If absent, the runtime falls back to `OPENAI_MODEL`. The customer UI never displays a provider or model name.

The deterministic benchmark (`npm run benchmark:auto-convert`) makes zero paid calls. Its heavy 1,500-row synthetic case measured 125 bounded requests, about 800,000 estimated input tokens, 90,000–270,000 estimated output tokens, and approximately $0.27–$0.48 at the configured cost-efficient model's current standard rates. These are planning ranges; real production telemetry is required.

## Rollout and migration

Keep `BILLING_ENFORCEMENT_MODE=SHADOW`. In this mode, only `INTERNAL` may execute provider-backed Auto Convert. Trial/Pro behavior is implemented for future `ENFORCED` mode but remains inactive until verified Paddle billing and Prompt 16 lifecycle controls exist.

Apply exactly once:

`supabase/migrations/20260902010000_prompt15_2_auto_convert_limit.sql`

Then run `supabase/tests/prompt15_commercial_checks.sql`. The migration only extends the existing usage metric allowlist and generic reservation/read/commit functions; it creates no table, policy, service-role path, or customer-data store.

## Known limitations

- Auto Convert prepares only the supported canonical fields and deliberately leaves absent or ambiguous facts unresolved.
- It does not perform Deep Recovery Analysis, billing, CRM connections, background synchronization, or Business ingestion.
- Large files depend on provider/runtime latency even though payloads and the UI remain bounded.
- One owner-run synthetic Internal smoke test is recommended after the migration is applied; automated tests intentionally make zero paid calls.
