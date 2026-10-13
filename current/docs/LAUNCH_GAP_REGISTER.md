# LostDeal AI commercial launch gap register

Updated: **2026-10-06 UTC**
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
| Checkout | DONE (sandbox) | Prompt 16 complete at Release 45; live Paddle remains separate |
| Subscription synchronization | DONE (sandbox) | Prompt 16 signed lifecycle verification complete; redirects never grant access |
| Webhook signature/replay protection | DONE | Exact duplicate and strictly older stale-event rejection passed |
| Billing portal and cancellations | DONE (sandbox) | Portal/cancellation contracts passed; commercial policy and invoicing remain launch work |
| Upgrade/downgrade and lifecycle behavior | DONE (sandbox) | Upgrade/downgrade, past_due, paused, resumed and canceled passed |
| Business connected plan | POST-V1 | Not purchasable; no active usage schedule or connected-data capability |

## Account and communications

| Item | State | Evidence / next step |
|---|---|---|
| Plan & Usage UI | PREPARED (17B) | Grouped settings/billing, confirmed plan-change/cancellation dialogs and accurate sandbox/proration copy; release waits for the 17B gates |
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
| Support process | OWNER ACTION REQUIRED | Public support@lostdeal.ai and privacy@lostdeal.ai are owner-approved. SUPPORT ROUTING VERIFICATION = OPEN COMMERCIAL-LAUNCH PREREQUISITE; routing, receipt and monitoring were not verified |
| Product analytics | PENDING | Approve privacy-respecting events and consent posture |
| Database/security advisor review | PARTLY DONE | Prompt 17A revoked client execution of `rls_auto_enable()`; fresh 17B read-only proof confirms it. Leaked-password settings and performance-index review remain separate operational decisions; no 17B migration added |
| Build-tool dependency review | DONE with scoped exception | Fresh production audit: zero findings. Full tree: eight HIGH dependency nodes solely from braces advisory GHSA-vfj7-8cjw-p6xm on the two approved dev/build paths. Registry latest remains 3.0.3; the existing exception expires 2026-11-04 or immediately when a patched release appears. No major migration or broader waiver |

## Legal

| Item | State | Evidence / next step |
|---|---|---|
| Seller legal structure decision | DONE | Pakistan-based individual / sole trader; obtain appropriate local advice |
| Privacy Policy | OWNER-APPROVED / PREPARED | Prompt 17B final continuation approves the existing draft with Abdullah Waheed, trading as LostDeal AI, Gujranwala/Pakistan and privacy@lostdeal.ai. Not yet published; release browser gates remain open |
| Terms of Service | OWNER-APPROVED / PREPARED | Approved sole proprietor context, support contact and qualified Pakistan law/forum applied. Accurate conditional Paddle Merchant of Record wording; current payments remain sandbox |
| Cancellation/refund policy | OWNER-APPROVED / PREPARED | No additional blanket voluntary guarantee; mandatory rights, payment-provider obligations and discretionary requests preserved. Cancellation/downgrade alone creates no refund entitlement |
| Subprocessor disclosures | PREPARED | Existing approved disclosures cover Supabase, requested OpenAI processing, Cloudflare-backed Sites and Paddle; no unverified certification or zero-retention claim |

## Final commercial QA

| Item | State | Evidence / next step |
|---|---|---|
| Prompt 15.1 packaging QA | DONE | Targeted catalog, escalation, SHADOW, regression, build, audit, and scan gates |
| Prompt 15.2 Auto Convert QA | DONE | 25/100/500/1,500-row mock tests, trust/security coverage, regressions, build, audit, and scans completed with zero paid calls |
| Prompt 15.3.x Analysis QA | DONE | Standard, Deep, usage accounting, zero-charge reload, global Recovery Score sorting, Auto Convert regression, semantic safety, migration immutability, RLS, protected RPCs, full automated gates, and owner production evidence pass |
| Paddle sandbox QA | DONE (sandbox) | Prompt 16 GO / COMPLETE; preserve the verified lifecycle/security matrix. Live activation remains separate |
| Production SMTP recovery test | PENDING | Owner receives and uses a real reset email |
| Commercial production smoke test | PENDING | Domain, legal, billing, email, monitoring, backup, support |
| Final commercial release archive | PENDING | Separate final archive after all commercial QA |

## Post-V1 boundary

Connected CRM/service-system ingestion, continuous synchronization, scheduled processing, weekly Recovery Briefs, multi-member/team packaging, and other connected Business capabilities are `POST-V1`. They must not be sold as current capabilities.

### Prompt 16 / 17A checkpoint

Prompt 16 is GO / COMPLETE at Release 45, commit
175fe2a59dfd8d923c681cd0a8bfa514c90c8bc6. Its temporary simulation credential
was revoked and removed. Northstar intentionally remains locally
STARTER/canceled, 20 imports / one analysis; do not reconcile it against the
still-active sandbox provider subscription. Internal remains isolated.

Prompt 17A is GO / COMPLETE at Release 47,
`2245135eb6c57358b06841c4f265c9beaf66527c`. Its hardening and live-authentication
evidence remain authoritative. Prompt 17B continues from the verified prepared
source `c92c91774d81bf57b81d8c5cef462ea2b935f3e7`.
Public commercial launch remains separate from these internal milestones.


## Prompt 17B restored checkpoint and final continuation

The product shell, genuine queue/insights, settings controls, profile/source-data export, plan-review dialogs, derived onboarding progress and public feature/trust pages are prepared. The final continuation supplies and approves the complete legal/contact record; the publication guard rejects placeholders, reserved example contacts, dummy values and unapproved status while accepting the truthful public locality without a street address. The preview now loads in Chrome, clearing the historical preview-access blocker. Authenticated, representative responsive and full accessibility/interaction verification are still required; partial public browser inspection is not a passing release gate. Release 47 remains deployed. Do not create Release 48 until every required gate passes. The prepared policy date must be rechecked against the actual Release 48 publication date immediately before any future deployment.
