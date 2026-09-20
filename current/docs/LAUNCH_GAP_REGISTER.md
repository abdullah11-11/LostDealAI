# LostDeal AI commercial launch gap register

Updated: **2026-09-14**
States: `DONE`, `PENDING`, `OWNER ACTION REQUIRED`, `POST-V1`.

LostDeal AI is **not commercially launch-ready** while required items remain pending.

## Core product and packaging

| Item | State | Evidence / next step |
|---|---|---|
| Prompt 14 automated QA | DONE | Comprehensive pre-commercial QA checkpoint completed |
| Owner core-product live QA | DONE | Owner approved the V1 behavior before commercial work |
| Frozen core behavior preserved | DONE | Prompt 15.3 adds a versioned Deep superset without changing Standard semantics, Recovery Score, dashboard metrics, or prior source data |
| Pricing direction | DONE | Trial $0/14 days, Starter $15/month, Pro $45/month, Business Coming Soon |
| Final entitlement packaging | DONE | Central catalog differentiates current core, future Pro gates, and inactive Business |
| Seller structure decision | DONE | Pakistan-based individual / sole trader |
| Preferred MoR decision | DONE | Paddle preferred; Lemon Squeezy fallback |
| Paddle account approval | PENDING | Provider must approve seller, identity, product/domain, risk, and payout setup |

## Monetization and billing

| Item | State | Evidence / next step |
|---|---|---|
| Prompt 15 subscription/usage schema | DONE | Owner reports the Prompt 15 migration applied |
| Prompt 15.1 limit mirror | DONE | Owner reports the Prompt 15.1 migration applied and its commercial checks passed |
| Usage reservations/idempotency/concurrency | DONE | Prompt 15.3.1/15.3.2 are applied; owner Standard and Deep successes each committed exactly one unit, duplicate reservations remained zero, and fresh runtime logs were clean |
| Auto Convert | DONE | Deterministic-first Pro/Internal preparation, evidence validation, partial retry, canonical download/import, and Starter teaser implemented |
| Prompt 15.2 usage mirror | DONE | Owner reports `20260902010000_prompt15_2_auto_convert_limit.sql` applied and commercial checks passed |
| Prompt 15.3 migration | DONE | Owner reports `20260902020000_prompt15_3_deep_analysis.sql` applied and commercial checks passed |
| Deep Recovery Analysis | DONE | Synthetic Juniper completed live as Deep with `NO_RESPONSE`, exactly one committed unit, and a later read-only reload with `+0`; a separate later Deep action used its own distinct unit as designed |
| Checkout | PENDING | Prompt 16 only after Paddle approval and prerequisite feature milestones |
| Subscription synchronization | PENDING | Verified provider webhooks; redirects never grant access |
| Webhook signature/replay protection | PENDING | Prompt 16 raw-body verification and idempotency matrix |
| Billing portal, invoices, cancellations | PENDING | Provider-hosted lifecycle flow and policy approval |
| Upgrade/downgrade and past-due behavior | PENDING | Prompt 16 design and sandbox QA |
| Business connected plan | POST-V1 | Not purchasable; no active usage schedule or connected-data capability |

## Account and communications

| Item | State | Evidence / next step |
|---|---|---|
| Plan & Usage UI | DONE | Read-only catalog-derived price/status plus four metrics; Starter shows a truthful Pro feature state rather than 0/0 |
| Forgot/reset password code | DONE | Enumeration-safe recovery and server-side throttling |
| Production SMTP | PENDING | Configure verified sender, templates, SPF/DKIM/DMARC, redirects, and live test |
| Production email confirmation | PENDING | Same SMTP/domain requirement |
| Workspace/account deletion | PENDING | Define retention/cascade/legal policy and implement |

## Production operations

| Item | State | Evidence / next step |
|---|---|---|
| Custom domain | PENDING | Select and configure domain/TLS and callbacks |
| Monitoring and structured alerts | PENDING | Choose service and test alerts without sensitive payloads |
| Uptime checks | PENDING | Public, auth, and critical runtime health checks |
| OpenAI budget alerts | PENDING | Configure provider budgets and usage alerts |
| Backup/restore procedure | PENDING | Define retention and execute a restore drill |
| Support process | PENDING | Publish customer-facing channel and response expectations |
| Product analytics | PENDING | Approve privacy-respecting events and consent posture |
| Database/security advisor review | PENDING | Prompt 15.3.7 confirmed the pre-existing public `rls_auto_enable()` execution warning, leaked-password protection setting, four unindexed foreign keys, and one unused index; schedule deliberate remediation before commercial launch rather than adding an unreviewed omnibus migration |
| Build-tool dependency review | PENDING | Production dependencies audit clean; evaluate the semver-major Vinext/`image-size` and Babel 8 upgrade paths in a dedicated compatibility milestone for the remaining development-only findings |

## Legal

| Item | State | Evidence / next step |
|---|---|---|
| Seller legal structure decision | DONE | Pakistan-based individual / sole trader; obtain appropriate local advice |
| Privacy Policy | PENDING | Legal review for customer data, Supabase, OpenAI, hosting, email, retention, and rights |
| Terms of Service | PENDING | Legal review before accepting payment |
| Cancellation/refund policy | PENDING | Align provider settings and applicable customer rules |
| Subprocessor disclosures | PENDING | Document Supabase, OpenAI, hosting, email, and future Paddle |

## Final commercial QA

| Item | State | Evidence / next step |
|---|---|---|
| Prompt 15.1 packaging QA | DONE | Targeted catalog, escalation, SHADOW, regression, build, audit, and scan gates |
| Prompt 15.2 Auto Convert QA | DONE | 25/100/500/1,500-row mock tests, trust/security coverage, regressions, build, audit, and scans completed with zero paid calls |
| Prompt 15.3.x Analysis QA | DONE | Standard, Deep, usage accounting, zero-charge reload, global Recovery Score sorting, Auto Convert regression, semantic safety, migration immutability, RLS, protected RPCs, full automated gates, and owner production evidence pass |
| Paddle sandbox QA | PENDING | Checkout/webhook/lifecycle/security matrix in Prompt 16 |
| Production SMTP recovery test | PENDING | Owner receives and uses a real reset email |
| Commercial production smoke test | PENDING | Domain, legal, billing, email, monitoring, backup, support |
| Final commercial release archive | PENDING | Separate final archive after all commercial QA |

## Post-V1 boundary

Connected CRM/service-system ingestion, continuous synchronization, scheduled processing, weekly Recovery Briefs, multi-member/team packaging, and other connected Business capabilities are `POST-V1`. They must not be sold as current capabilities.

### Prompt 16 checkpoint

Paddle sandbox implementation is present; signing-secret/API configuration and signed simulator/checkout/upgrade/portal acceptance remain owner-required. Checkout stays disabled until configuration is verified. Prompt 17, live Paddle and commercial launch remain NO-GO. Follow docs/PROMPT_16_PADDLE_BILLING.md; preserve the private Site and use only its separate signed public Edge webhook.
