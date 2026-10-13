# LostDeal AI — recovery workflow

This explanation describes the genuine application. The accompanying showcase is a separate offline illustration with four fictional deals and manually authored, precomputed analysis. It neither reads tenant data nor performs a live import, model call, subscription action or follow-up.

## 1. Prepare the source

Start with an authorized CSV export of lost quotes or opportunities that contains useful sales notes or a transcript. Supported import is UTF-8 CSV, up to 5 MB and 2,000 data rows. It is not an XLSX/PDF/document importer or a CRM connector.

Smart Import maps to ten canonical fields: external deal ID, customer name, deal value, quote date, status, salesperson, service type, lead source, sales notes and transcript. Strong header aliases map without AI. Weak matches require confirmation and every mapping remains editable. Optional AI mapping is an explicit convenience; it is not a prerequisite for manual mapping.

Review ambiguous dates and statuses rather than silently guessing. Won/sold records are excluded or rejected as inappropriate lost-deal source. At least one usable source text field is required. An external ID protects against duplicate import within the organization. Downloading a normalized, formula-safe CSV is separate from importing it or analyzing its deals.

## 2. Use Auto Convert only when eligible and useful

AI Auto Convert applies deterministic mappings first, then uses bounded structured mapping/extraction where necessary. Extracted facts need supporting source columns and evidence. It prepares supported structured fields, not rewritten sales notes or transcripts. Unresolved or conflicting information remains reviewable; absent names, dates, amounts and terms are not invented.

Auto Convert reuses the same validator, review, export and explicit import boundary. It has its own row allowance and does not start Standard or Deep Analysis, calculate Recovery Score or contact a customer. The showcase switches between explanations of these paths; it does not accept a file.

## 3. Analyse deliberately

Standard Analysis interprets the source into a bounded loss reason, Buying Intent, confidence, exact evidence excerpts, positive/negative signals and a recommended action, timing, channel and optional draft. An explicit eligible Deep action adds strategic depth, recovery risks, decision dynamics and caution while retaining the same core analysis contract.

The analysis is decision support. Confidence is a product output quality signal, not an independently calibrated probability. A suggested follow-up does not send an email, text or message. The human must assess the record and actual circumstances before acting.

Opening stored analysis or a saved Deep result makes no new model call. A new explicit analysis operation reserves usage before provider work and uses controlled finalization. Failures surface safely rather than exposing raw provider data. The operation/usage rules and isolated test limits are documented in the engineering packet.

## 4. Calculate an explainable review priority

The unchanged Recovery Scoring v1.0 formula is:

`base = 0.5 × Buying Intent + 0.3 × reason recoverability + 0.2 × recency`

`confidence multiplier = 0.7 + 0.3 × confidence / 100`

Apply the minimum relevant safety cap, then round and bound the adjusted result to 0–100. High starts at 70; Medium starts at 45; otherwise Low. Low confidence, no grounded evidence, not-qualified leads and No Action recommendations apply explicit caps. Quote recency follows fixed date bands; the as-of date is part of the score record.

The four fictional showcase scores were computed offline by the actual unchanged scorer as of **12 October 2026**: 82, 73, 57 and 21. Their underlying analysis was manually authored for explanation, not produced live. A score ranks review priority. It is not sale probability, a forecast or recovered revenue.

## 5. Review the queue and decide what to do

Recovery Queue orders stored opportunities by score and supported filters, while keeping the recommended action, channel and timing visible. It does not invent a calendar due date from free-form timing text. Deal Detail lets a user inspect the evidence and caution before leaving the product to take a human action.

For the fictional Aster Works example, the source explicitly says the plan is a fit and asks for a follow-up around the October budget review. A reasonable next step is to check whether that review has happened. The note does not justify asserting approved funds, promising a discount or predicting a sale.

Overview and Insights describe stored data coverage and distributions with denominators. Quoted deal value stays quoted value. Recovered revenue is not inferred from an analysis or a high score.

## Starter and Pro

| Current catalog | Starter | Pro |
| --- | ---: | ---: |
| Monthly catalog price, USD | $15 | $45 |
| Imported deals per usage period | 250 | 1,500 |
| AI analyses per usage period | 30 | 250 |
| AI mapping requests per usage period | 3 | 30 |
| AI Auto Convert rows per usage period | 0 | 1,500 |
| Standard Analysis | Included | Included |
| Deep Recovery Analysis | Not included | Within the shared AI analysis allowance |
| Smart Import / normalized CSV export | Included | Included |

The designed 14-day trial has 50 imported deals, 10 shared analyses, 3 mapping requests, 25 Auto Convert rows and up to 2 Deep previews **within** the 10 analyses. Real new-operation eligibility depends on server-owned plan, status, enforcement and remaining allowance. Historical read access does not grant eligibility for new provider work. Commercial paid activation and applicable tax/payment acceptance remain pending; the showcase has no purchasing route.
