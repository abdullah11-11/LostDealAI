# LostDeal AI V1 pricing and packaging

Decision date: **2026-09-02**

## OWNER-APPROVED CURRENT DIRECTION

This is the current commercial direction for LostDeal AI. It replaces the preliminary Prompt 15 recommendation. Billing is not live yet, so these prices are internal product decisions rather than an available checkout.

| Plan | Price / status | Current usage | Positioning |
|---|---|---|---|
| Trial | $0 / 14 days | 50 imported deals, 10 total AI analyses including a future 2-Deep-operation preview, 3 AI Smart Mapping requests | Try the LostDeal experience before subscribing. |
| Starter | $15/month | 250 imported deals, 30 Standard AI analyses, 3 AI Smart Mapping requests per billing period | **Find the lost deals worth recovering.** |
| Pro | $45/month | 1,500 imported deals, 250 total Standard/Deep AI analyses, 30 AI Smart Mapping requests per billing period | **Let AI prepare and deeply analyze your lost sales data.** |
| Business | Coming Soon / Contact Us | No active commercial limits | **Connect your business and continuously identify recoverable lost revenue.** |

There are no crossed-out prices or launch-discount claims. Business is not purchasable, has no checkout, and must not be represented as an active subscription.

## Product ladder

- **Starter:** the customer prepares and maps more of the data. It includes the complete current manual/semi-automated workflow: CSV upload, deterministic Smart Mapping, manual mapping, safe normalization, normalized CSV download, Standard AI Deal Analysis, Recovery Score, Recovery Overview, Deal Intelligence, evidence, recommended action, suggested follow-up, and the existing bounded batch workflow.
- **Pro:** includes everything in Starter, higher current allowances, and the future entitlement to AI Auto Convert and Deep Recovery Analysis. Those two capabilities do not exist yet and must not appear as usable until Prompt 15.2 and Prompt 15.3 implement and server-gate them.
- **Business:** is a future connected-data product intended to remove CSV dependence through direct sales-system ingestion and continuous processing. Connectors, synchronization, weekly briefs, team functionality, and related capabilities are not current V1 features and must not be advertised as available.

Starter is not intentionally crippled. Its upgrade path is more automation, more intelligence, and higher capacity—not removal of the core LostDeal value proposition.

## Feature entitlement contract

| Capability | Trial | Starter | Pro | Business compatibility code |
|---|---|---|---|---|
| Standard AI Deal Analysis | Included | Included | Included | Future tier inherits Pro conceptually |
| Smart Import and manual mapping | Included | Included | Included | Future tier inherits Pro conceptually |
| AI Smart Mapping | Included within allowance | Included within allowance | Included within higher allowance | Not commercially active |
| Recovery Score / Dashboard / Deal Intelligence | Included | Included | Included | Not commercially active |
| Normalized CSV export | Included | Included | Included | Not commercially active |
| AI Auto Convert | Future bounded preview architecture only | Not entitled | Entitled once Prompt 15.2 implements it | Conceptually inherited; not live |
| Deep Recovery Analysis | Future bounded preview architecture only | Not entitled | Entitled once Prompt 15.3 implements it | Conceptually inherited; not live |
| Connected data source | Not available | Not available | Not available | False / not live |

`INTERNAL` remains hidden, non-purchasable, unlimited, and reserved for existing owner/test organizations.

## Trial and billing approach

- Trial duration is 14 days with one organization and the fixed total trial allowances above.
- Launch billing is monthly-first. Annual pricing is not approved yet.
- V1 uses hard allowances with an upgrade path, not surprise overage invoices or complex credits.
- `BILLING_ENFORCEMENT_MODE` stays `SHADOW` until provider checkout, verified subscription synchronization, customer messaging, upgrade handling, and commercial billing QA all pass.
- The authenticated Plan & Usage screen may display the approved plan price/status from the centralized catalog. No purchase action is available before billing integration.

## Future upgrade UX (documented, not implemented)

Prompt 15.2 may show Starter users a restrained **Auto Convert with AI** Pro option before manual mapping, with the truthful explanation “Let LostDeal AI automatically prepare this file.” Starter must always be able to continue with Smart Mapping/manual preparation.

Prompt 15.3 may show a restrained **Deep Recovery Analysis — Pro** explanation beside the real Standard Analysis. It must never fabricate locked insights or imply that results already exist.

## Provider direction

The seller is a Pakistan-based individual / sole trader. Paddle is the preferred Merchant of Record, subject to provider approval; Lemon Squeezy is the fallback. No payment SDK, checkout, webhook, provider secret, or paid subscription is part of Prompt 15.1.
