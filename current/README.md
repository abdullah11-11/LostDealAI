# LostDeal AI

LostDeal AI helps businesses understand why sales opportunities were lost and
identify which deals may be worth recovering.

The current V1 application includes authenticated organization workspaces,
Supabase RLS, CSV import, real deal browsing, grounded OpenAI deal analysis,
deterministic Recovery Scoring v1.0, and a real organization-scoped recovery
dashboard.

Smart Import accepts canonical or common CRM-style CSV exports, suggests
deterministic mappings, supports explicit name/notes/transcript merges, and uses
one shared server-authoritative normalization pipeline for review, canonical CSV
download, and import. An optional user-triggered Structured Outputs request can
suggest mappings from bounded column profiles; normal mapping, normalization,
download, and import make zero OpenAI calls. See
[`docs/SMART_IMPORT.md`](docs/SMART_IMPORT.md).

Prompt 15.2 adds Pro **AI Auto Convert** as a deterministic-first automation
layer over that same pipeline. It maps strange schemas, normalizes supported
values, extracts only evidence-backed facts from bounded source text, preserves
the supporting notes/transcript, and returns the same canonical review,
download, and explicit import flow. Starter keeps the complete Smart Mapping
workflow and sees a truthful Pro teaser; commercial Trial/Pro execution remains
inactive while billing is in `SHADOW`. See
[`docs/AUTO_CONVERT.md`](docs/AUTO_CONVERT.md).

Prompt 15.3 adds explicit **Deep Recovery Analysis** as an evidence-grounded
superset of the existing Standard result. Internal workspaces can run it in
`SHADOW`; Starter remains on complete Standard Analysis, while commercial
Trial/Pro execution waits for verified billing. Standard and Deep each use one
existing `AI_ANALYSES` unit, and normal page loads make no provider call. See
[`docs/DEEP_RECOVERY_ANALYSIS.md`](docs/DEEP_RECOVERY_ANALYSIS.md) and the
[`analysis model benchmark`](docs/ANALYSIS_MODEL_BENCHMARK.md).

Prompt 12 adds centralized mutation guards, production security headers,
worker-shared rate limiting, privacy guidance, safe per-deal deletion, and a
documented launch checklist without changing AI semantics, Recovery Score v1.0,
dashboard KPI definitions, or the Deal Intelligence hierarchy.

Prompt 13.1 applies the final warm LostDeal AI identity through one semantic
Light/Dark/System theme system. Light is the intentional default; a validated
`lostdeal-theme` browser preference can select Light, Dark, or live system
appearance without a database write. The exact approved orange/gold logo is
used for light and dark wordmarks, favicon, and social identity. Overview,
Deals, Deal Intelligence, and Upload use compact decision-first layouts and
accessible local disclosures or tabs to reduce page scrolling without removing
data or actions. It adds no database migration and changes no AI, scoring,
tenant, rate-limit, privacy, import, dashboard-query, or deletion behavior.

## Stack

- Next.js App Router
- TypeScript in strict mode
- Tailwind CSS
- ESLint
- npm

The OpenAI Sites runtime uses Vinext while preserving the standard App Router
file structure and Next.js APIs.

## Routes

- `/`
- `/login`
- `/signup`
- `/dashboard`
- `/deals`
- `/deals/[id]`
- `/upload`
- `/account`
- `/forgot-password`
- `/reset-password`

## Commands

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run test:scoring
npm run test:dashboard
npm run test:intelligence
npm run test:demo
npm run test:security
npm run test:ui
npm run test:smart-import
npm run test:ai
npm run test:deals
npm run test:commercial
npm run test:commercial-packaging
npm run test:auto-convert
npm run test:deep-analysis
npm run test:deep-runtime
npm run test:usage-hotfix
npm run test:recovery-sort-hotfix
npm run test:deep-semantic-hotfix
npm run test:deep-semantic-final
npm run test:deep-runtime-final
npm run test:omnibus
npm run benchmark:auto-convert
npm run benchmark:analysis -- --stage=1 --max-calls=20
```

## Server configuration

Copy `.env.example` to `.env.local` and configure the Supabase values.
`OPENAI_API_KEY` is required as a server-only secret for LostDeal AI analysis;
never prefix it with `NEXT_PUBLIC_`, return it from an API route, or commit it.
`OPENAI_STANDARD_ANALYSIS_MODEL` and `OPENAI_DEEP_ANALYSIS_MODEL` select the
separate server-only analysis models. The tested production choice for both is
`gpt-5.6-terra`. `OPENAI_MODEL` retains its existing AI Mapping and Auto
Convert fallback behavior, but Standard/Deep accept it as a fallback only when
it is the tested Terra value; it cannot silently promote either mode to Sol.
`OPENAI_AUTO_CONVERT_MODEL=gpt-5.6-luna` remains a separate server-only
cost-control override. None may use a `NEXT_PUBLIC_` prefix or appear in
customer UI.

`APP_ORIGIN` is the strict same-origin base used for password-recovery callback
URLs. `BILLING_ENFORCEMENT_MODE` accepts only `OFF`, `SHADOW`, or `ENFORCED` and
defaults to `SHADOW`; it is server-controlled and must never use a
`NEXT_PUBLIC_` prefix. `BILLING_USAGE_AUTHORITY_SECRET` is a server-only
64-character random hex secret that authorizes reservation/commit RPCs; the
database migration contains only its SHA-256 verifier.

## Commercial foundation

Prompt 15 defines typed `INTERNAL`, `TRIAL`, `STARTER`, `PRO`, and `BUSINESS`
plans; organization-scoped subscription state; atomic idempotent usage
reservations; and a compact authenticated `/account` Plan & Usage surface.
Prompt 15.1 locks the owner-approved $15 Starter and $45 Pro packaging in the
same central catalog. Prompt 15.2 implements Auto Convert for Internal now and
future verified Trial/Pro subscriptions: Trial 25 rows, Starter 0, Pro 1,500,
and Internal unlimited. Prompt 15.3 implements Deep Recovery Analysis for
Internal now, a future two-operation Trial preview, no Starter access, and
future verified Pro access inside the existing 250-analysis allowance. Business
is Coming Soon, non-purchasable, and has no active commercial usage schedule.
Successfully inserted deals, explicit fresh AI analyses, explicit AI Smart
Mapping requests, and successfully provider-processed Auto Convert rows use
the existing generic-ledger metrics. Standard and Deep each count as one
`AI_ANALYSES` operation; running both explicitly counts as two. Auto Convert is
not double-charged as mapping or analysis. Scoring, deterministic/manual
mapping, normalization, downloads, page loads, and themes consume no allowance.

The Prompt 15 rollout mode is `SHADOW`: usage is measured when the migration is
available, while provider-backed Auto Convert and Deep Analysis stay limited to `INTERNAL` and
existing core access remains unchanged before checkout and subscription
synchronization exist. The browser cannot choose a plan, usage limit, period,
enforcement mode, or usage authority. There is no payment SDK, checkout, webhook, provider
secret, or card storage. Paddle is preferred subject to approval, Lemon Squeezy
is the fallback, and billing remains unavailable. See
[`docs/BILLING_ARCHITECTURE.md`](docs/BILLING_ARCHITECTURE.md),
[`docs/PRICING_RECOMMENDATION.md`](docs/PRICING_RECOMMENDATION.md), and
[`docs/LAUNCH_GAP_REGISTER.md`](docs/LAUNCH_GAP_REGISTER.md).

Password recovery uses Supabase Auth, a generic enumeration-safe response,
the existing D1 fixed-window limiter (5 requests per hashed normalized email
per 15 minutes), and a verified recovery session plus short-lived HttpOnly
marker before password update. Production email delivery still requires owner
SMTP/domain and redirect-URL validation.

Recovery Score is calculated only by deterministic TypeScript code from stored
analysis fields and quote recency. Score calculation, backfill, and refresh make
no OpenAI request. Scores are persisted under the authenticated user's normal
organization-scoped RLS access.

## Recovery dashboard

`/dashboard` reads lightweight persisted `deals`, `deal_analyses`, and `uploads`
fields for the authenticated user's active organization. Normal dashboard loads
are read-only: they do not call OpenAI and do not calculate or refresh Recovery
Scores. Totals are processed server-side across every tenant-accessible deal in
controlled pages; the browser does not aggregate workspace records.

Top Recovery Opportunities are derived server-side from that same lightweight
tenant deal set, so the ranking and KPI universes stay aligned without a second
relationship-ordering query. Recent Imports and Top Recovery Opportunities have
section-level failure handling; only a critical tenant deals/metrics failure can
produce the full Overview error state. Persisted analysis metadata is normalized
defensively, including older analyses without scoring timestamps.

- **Total Lost Deal Value** is the combined quoted value of every imported lost
  deal in the current workspace.
- **High Priority Deal Value** is the combined deal value of scored deals whose
  persisted priority is `HIGH`. High Priority Deal Value is not predicted
  recovered revenue.
- **Average Recovery Score** averages only valid persisted, non-null scores.
- **Analysis Coverage** counts completed deals that have a valid related
  analysis, divided by all workspace deals.
- **Scoring Coverage** distinguishes scored analyses from completed valid
  analyses whose Recovery Score is still null.

Recovery Score is a deterministic prioritization indicator, not a probability
or guarantee. Refreshing or backfilling scores remains an explicit user action.

## Deal intelligence experience

`/deals/[id]` is value-first and action-first: completed deals present the
persisted Recovery Summary, recommended next action, follow-up draft, loss
reason, signals, grounded evidence, and deterministic score breakdown before
the imported deal information, notes, and transcript. Source data, AI
interpretation, and deterministic scoring are labeled separately.

Normal detail-page loads are read-only. They do not call OpenAI, recalculate a
score, or contact a customer. Analysis and scoring remain explicit actions;
copying a persisted follow-up draft only writes that exact text to the browser
clipboard. Long transcripts expand and collapse locally.

The Data & Privacy control at the bottom of a deal requires an explicit second
confirmation. It deletes only the tenant-authorized deal; the existing foreign
key cascades its analysis while preserving other deals and upload metadata. The
forward-only Prompt 12 Supabase migration must be applied before using it.

## Security and privacy

Protected API mutations validate same-origin request metadata, content type,
strict body schemas, verified identity, and server-resolved workspace access.
Expensive/mutating actions use an atomic Cloudflare D1 fixed-window limiter
shared across workers. A blocked action returns `429` and `Retry-After`; normal
read-only pages are not rate-limited.

Normal page loads send nothing to OpenAI. An explicit analysis sends only the
relevant deal value/date/service/status plus sales notes and transcript. Free
text may itself contain personal data, so users should import only authorized
information and avoid unnecessary sensitive details. See
[`docs/SECURITY_THREAT_MODEL.md`](docs/SECURITY_THREAT_MODEL.md) and
[`docs/PRODUCTION_SECURITY_CHECKLIST.md`](docs/PRODUCTION_SECURITY_CHECKLIST.md).

## Synthetic CSVs and demos

- `public/sample-lost-deals.csv` contains 10 simple synthetic rows for quickly
  testing CSV selection, mapping, and validation.
- `public/lostdeal-demo-hvac.csv` contains 20 realistic but fully synthetic HVAC
  lost opportunities for demonstrating analysis, deterministic scoring, the
  recovery dashboard, and Deal Intelligence.
- `public/examples/smart-import-crm-example.csv` contains five synthetic,
  intentionally non-canonical CRM-style rows for testing Smart Mapping.

Synthetic records must be used only in an appropriate test workspace and must
not be treated as real customer opportunities. Neither download nor import
automatically runs analysis or spends OpenAI credits. The focused prospect flow
and recommended seven-deal analysis subset are documented in
[`docs/DEMO_WALKTHROUGH.md`](docs/DEMO_WALKTHROUGH.md).

The committed HVAC CSV uses dates relative to its 2026-08-30 release. Maintainers
can deterministically refresh those dates without network, Supabase, or OpenAI
access:

```bash
node scripts/generate-demo-data.mjs YYYY-MM-DD
```
