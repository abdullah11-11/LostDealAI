# Prompt 17B — product architecture and implementation record

Baseline: Release 47, `2245135eb6c57358b06841c4f265c9beaf66527c`. Prompt 17A is complete. This milestone changes the product experience while retaining its authorization, tenant isolation, accounting, analysis and provider safeguards.

## Research, 6 October 2026

Current ChatGPT public web UI was inspected in Chrome, including its sidebar and General/Data Controls settings. It uses quiet surfaces, short navigation labels and grouped setting rows. Authenticated billing could not be observed because the reference session is signed out; official OpenAI billing documentation supplies that part of the reference. No reference account changes were made.

Current Rizer home, product and monthly pricing pages were inspected in Chrome. The product connects loss evidence, prioritization and a subsequent human workflow; pricing explains who each option serves before providing a detailed comparison. Its HubSpot integrations, automatic outreach, agents, figures, pricing and protected material are not LostDeal capabilities and will not be copied.

Reference URLs: https://chatgpt.com/, https://help.openai.com/en/articles/9039756-managing-billing-settings-on-chatgpt-web-and-platform, https://rizer.io/, https://rizer.io/product/, https://rizer.io/pricing/.

## Direction

A revenue recovery workspace: neutral white and graphite surfaces, restrained LostDeal orange, clear type, compact data views and a visible distinction between source evidence and AI interpretation. A user's next step takes priority over decorative dashboards. Quoted deal value is never described as recovered revenue or a forecast.

## Audit decisions

| Area | Decision | Reason |
| --- | --- | --- |
| Authorization, RLS, tenant queries, usage, AI, scoring, billing server | KEEP | Hardened Release 47 contracts remain authoritative. |
| Existing routes and deep links | KEEP | Preserve `/dashboard`, `/deals`, `/upload`, `/account` and safe return paths. |
| Application shell | REDESIGN | Add collapsible navigation, workspace/plan identity and accessible mobile navigation. |
| Overview | REDESIGN | Put ranked opportunities, coverage and meaningful next steps ahead of oversized metric cards. |
| Deals | REDESIGN | Reduce horizontal sprawl; keep bounded pagination, search, filters and sorting. |
| Deal intelligence | REDESIGN | Improve report hierarchy and evidence treatment without changing validated analysis. |
| Import flow | REDESIGN | Keep mapping, review, provenance, validation and atomic commit; improve step hierarchy. |
| Account/usage | MERGE | A coherent settings center links to the existing server-authoritative billing surface. |
| Recovery Queue / Insights | ADD | Use stored scores and actual aggregates; never invent readiness dates or recovered revenue. |
| Appearance / account / privacy settings | ADD | Only working device preferences, actual account facts and supported controls. |
| Fake notifications / integrations / AI-rule toggles | REMOVE | A control must persist and have real effects or not appear. |
| Billing diagnostics in product copy | REMOVE | Customers need price, access, timing and confirmation rather than operation identifiers. |
| Public capabilities and trust | ADD | Specific pages describe implemented behavior and limitations. |
| Legal facts and support addresses | OWNER-APPROVED / PREPARED | Final continuation supplies truthful sole proprietor identity, public locality, contacts, qualified jurisdiction and refund position. Inbox routing remains a separate unverified commercial prerequisite. |

## Information architecture

Workspace: Overview, Deals, Recovery Queue, Insights, Imports. Settings: General, Account, Analysis & data, Privacy & security, Billing & plan. Current account route remains the billing entry. No integration catalog is shown because CSV is the supported connection method.

Public: Home, Product, Lost-deal intelligence, Deal recovery, AI analysis, Pricing, Security, Contact, Privacy, Terms, Refund/cancellation. The owner-approved final legal text passes the complete publication guard. No production publication is authorized until the remaining product QA gates pass.

## Release gates

All baseline tests plus targeted new behavior tests, rendered checks, clean install, lint, typecheck, verified build, artifact checks, full and production audits, secret scan, unchanged historical migrations, Git/deployment identity, responsive/accessibility visual review and unchanged tenant fingerprints are required. No reconciliation, Paddle mutation, billing replay, usage reset or paid AI run is authorized by this UX milestone. Final commercial readiness depends on truthful, complete business/legal details.


## Implementation checkpoint — 2026-10-06 UTC

The shared neutral theme, collapsible workspace navigation, real Recovery Queue/Insights, mobile deal summaries, grouped Settings, own-profile editing, bounded source-data export, explicit plan-change/cancel dialogs, genuine first-value progress and public feature/trust pages are prepared. Inactive workspace notices are presentational; server authorization is preserved. Billing uses document links to retain the account-specific checkout CSP. Sensitive headers cover every new workspace route.

Public contact/policy routes fail closed unless a complete, validated owner-approved record exists. The final continuation explicitly approves the three prepared drafts subject to the supplied narrow corrections. The historical review packet and current approval receipt are in `docs/PROMPT_17B_OWNER_REVIEW.md`. No release is deployed while any required browser QA gate remains open.

Production output is cleaned before building to avoid retaining old hashed assets. Client profile validation uses a tiny convenience helper rather than shipping Zod; strict API validation remains server-side. Insights reuses existing metrics and tenant reads while skipping Overview's recent-import query. Aggregated package sizes are measured against a clean Release 47 worktree; no unmeasured speed claim is made.

## Final continuation — owner/legal corrections, 6 October 2026

Operator: Abdullah Waheed, trading as LostDeal AI. Structure: Individual / Sole Proprietor — Pakistan. Public location: Gujranwala, Punjab, Pakistan. Support: support@lostdeal.ai. Privacy: privacy@lostdeal.ai. Governing law: laws of the Islamic Republic of Pakistan, with courts of competent jurisdiction in Gujranwala, Punjab, Pakistan, qualified by mandatory rights and jurisdiction rules. No invented street address, office, incorporation or tax registration is required or claimed.

The existing policy drafts retain their data-processing, AI-review, billing, history and usage limitations. The refund position adds no blanket voluntary guarantee, no automatic cancellation/downgrade refund and preserves mandatory rights, provider obligations and case-by-case discretion. The three policies share a prepared effective date which must equal the actual Release 48 publication date before deployment; this preparation is not publication.

The publication validator now rejects unresolved placeholders, dummy text and example/reserved email domains. Focused regression exposed an invalid-email refinement exception; the email domain check now handles missing separators safely and the existing malformed-email case passes. Two older documentation assertions were updated narrowly to allow only the two explicitly approved business contacts and to require the current exact tooling exception and completed Prompt 16 sandbox status. Synthetic examples still reject contact data, and unsupported social-proof/certification assertions remain prohibited.

SUPPORT ROUTING VERIFICATION = OPEN COMMERCIAL-LAUNCH PREREQUISITE. Deliverability and monitoring have not been verified. This external prerequisite does not itself block a private technical product release; real commercial sales require a working monitored channel. Browser QA status and final validation belong to the final-continuation evidence checkpoint, not the historical restored checkpoint.

## Sign-in follow-up — 6 October 2026

The owner reported that preview sign-in failed despite using the expected credentials. Actual browser inspection found the generic invalid-email/password message; credential values were not inspected or replayed. The existing action mapped every provider error to that message, so it did not prove a rejected password.

The configured project is healthy, and a read-only Node request to Auth settings returned HTTP 200. A separate read-only reproduction in the installed Cloudflare Worker runtime failed DNS resolution for the same Supabase hostname before contacting Auth. Recent provider logs contained successful token requests and no credential rejection in the inspected window; these aggregates do not independently identify the failed browser attempt. This supports a preview connectivity limitation, not a proven production authentication failure or proof of any particular password's validity.

The narrow product correction classifies provider errors by stable codes. Actual credential/account-state rejection keeps the same generic message, rate limiting has a safe retry message, and network, service or unknown failure displays temporary sign-in unavailability. No raw diagnostic, email, password, token or provider detail is shown. Seven regression cases cover the classification and preserve fail-closed provider authentication, verified identity, membership and safe redirect ordering.

No authentication bypass, user reset, QA credential recreation, DNS/security weakening, alternate preview host, dependency patch, public tunnel, provider mutation or deployment was used. Actual authenticated QA remains OPEN until a supported preview connection is available and a positive signed-in product state is observed. Release 47 remains live; Release 48 remains uncreated and undeployed.
