# LostDeal AI

**AI-powered lost-deal intelligence and recovery prioritization for B2B sales teams.**

LostDeal AI helps teams understand why opportunities were lost, review evidence from sales records, prioritize potential recoveries, and prepare human-reviewed follow-ups.

**Status:** Premium SaaS development complete · Commercial activation pending.

## Features

- **Smart Import:** CSV mapping, normalization, provenance and review.
- **AI Auto Convert:** Assisted conversion of non-standard CRM exports.
- **Deal Intelligence:** Standard and Deep analysis with grounded reasons, signals and recommended actions.
- **Recovery Score:** Deterministic scoring, priority ranking and Recovery Queue.
- **Insights:** Deal overview, recovery trends and analysis coverage.
- **Account & Billing:** Organization-scoped access, usage controls, Starter/Pro plans and Paddle integration.

## Technology

Next.js App Router · React · TypeScript · Tailwind CSS · Supabase PostgreSQL/Auth/RLS · OpenAI · Paddle · Cloudflare Workers/Vinext.

## Repository

| Directory | Contents |
| --- | --- |
| [`current/`](current/) | Verified 391-file final application source |
| [`docs/`](docs/) | Architecture, source status, setup and launch runbook |
| [`portfolio/`](portfolio/) | Product case study, walkthrough and synthetic showcase |
| [`history/`](history/) | Verified application Git history bundle |
| [`archives/`](archives/) | Preserved development milestone snapshots |

## Engineering validation

The final development checkpoint (13 October 2026) recorded **947/947 TypeScript/PostgreSQL tests** and **9/9 Worker tests** passing, plus lint, typecheck, build, migration-integrity and secret-scan checks. The 16 existing database migrations are unchanged. These are recorded checkpoint results, not GitHub Actions checks.

**Important:** The live Site remains **private, on Version 49**. The final development source in `current/` has **not been deployed to production**. Paddle Live, public onboarding, production email, operational acceptance and real payments remain pending.

## Documentation

- [Architecture](current/docs/ARCHITECTURE_CURRENT.md)
- [Development setup and restore](current/docs/RESTORE_AND_SETUP.md)
- [Commercial activation runbook](current/docs/COMMERCIAL_ACTIVATION_RUNBOOK.md)
- [Verified source status](docs/CURRENT_SOURCE_STATUS.md)
- [Product case study](portfolio/Product-Case-Study.md)

---

**Private proprietary repository.** Source, historic archives and customer-facing deployment are not public. The [portfolio showcase](portfolio/showcase/) uses fictional records and does not contact the live SaaS or payment providers.
