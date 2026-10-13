# Release 49 — Technical V1 status

**Status:** GO for the bounded private technical release. **Not yet approved** for public paid subscriptions.

| Identifier | Recorded value |
| --- | --- |
| Production Site | [LostDeal AI](https://lostdeal-ai.equal-dune-2306.chatgpt.site) (owner access may be required) |
| Published Sites Version | **49** |
| Source commit | `d5db733f0253669dc9d25bad444a133f1d155927` |
| Git tree | `03b1cd663dda618d9e72faab8d0c4e511bd0d88a` |
| Source files | 372 |
| Technical QA milestone | Prompt 17 = GO |
| TypeScript/isolated PostgreSQL suite | 751 PASS |
| Rendered Worker checks | 9 PASS |
| Existing migrations | 16 unchanged from earlier release baseline |
| Policy publication date | 2026-10-07 |

## Important history

- **Release 47:** prior successful internal production-hardening baseline.
- **Release 48:** premium UI release candidate, later found to have a real login action-state rendering exception.
- **Version 49:** corrected the authentication presentation error. The fix was restricted to AuthScreen's safe state fallback and its focused regression test.
- The final checkpoint and checksums were independently verified during the owner QA review. The complete checkpoint is **not included in this repository yet**.

## Safe and honest scope

The private release covers stored-data UI flows, responsive layout evidence, security/RLS proof, Supabase data preservation, and signed sandbox-billing regressions. It does **not** establish an unrestricted public user launch, production SMTP/recovery deliverability, Paddle Live processing, 200% browser zoom certification, screen-reader certification, load testing, or executed paid AI/provider workflows on production.

## Commercial readiness dependencies

1. **Public access:** verify audience policy, supported public origin and safe signup isolation.
2. **Business identity & communications:** own a working domain, verify support/privacy mailbox receipt, and configure transactional email.
3. **Payments:** complete Paddle Live seller/domain/payout approval and exact live-catalog/webhook verification.
4. **Operations & privacy:** production alerts and budgets, backup restore drill, identity-checked data rights process and relevant obligations.
5. **Go to market:** recruit beta users, validate recovery value and willingness to pay.

Remain private until these gates are deliberately closed. No real-money payment is claimed active.

## Code synchronisation status

The root repository's `current/` tree is **historical Prompt 16 code**. Do not describe it as the current Version 49 application. The complete Version 49 source is available in the owner-provided, integrity-verified final release checkpoint and must be synced with a controlled **full source comparison**, not a patch guessed from this status document.

**Source integrity verification target:** commit `d5db733f0253669dc9d25bad444a133f1d155927`, tree `03b1cd663dda618d9e72faab8d0c4e511bd0d88a`, 372 files.

## Historical security exception

A narrow development/build-tooling `braces` advisory exception was recorded with a **2026-11-04 UTC** expiry (or earlier upon a compatible patched release). Production dependency audit was clean in the final release receipt. This is not permission to ignore future advisories; recheck before public paid launch.
