# LostDeal AI — from lost sales notes to a considered next step

**Owner-led, AI-assisted B2B SaaS product project. Commercial activation pending.**

LostDeal AI is a genuine multi-tenant sales recovery application. It helps a business review closed-lost deals, distinguish source evidence from interpretation, and prioritize the conversations worth revisiting. The companion showcase uses fictional, precomputed examples; it does not replace the application or pretend to execute its live services.

## The business problem

A lost quote often leaves useful information scattered across a CRM export, call notes and a sales representative's memory. A timing objection is different from a poor product fit, and a requested proposal that received no follow-up is different from a clear rejection. A list of lost deals alone does not explain which record deserves attention or what a responsible next step would be.

The product's value proposition is specific: **turn authorized lost-deal source data into evidence-backed recovery intelligence and a transparent review order, while leaving the final business judgment and outreach with a person.** The intended initial fit is a service business with exportable lost quotes and usable sales context. Market demand, customer conversion and recovered revenue still require actual customer validation.

## The product approach

The workflow starts with supported CSV data. Smart Import matches strong aliases deterministically, allows manual mapping, normalizes common USD values and dates, and separates Ready, Needs Review and Invalid rows. The user reviews the result before an explicit duplicate-aware import. AI Auto Convert is an eligible higher-automation path into the same pipeline: it can propose unresolved structured fields with source provenance, while preserving the original notes and transcripts.

An explicit Standard Analysis classifies the recorded loss reason and buying intent, retains bounded evidence excerpts, and suggests an action, timing, channel and draft follow-up. Deep Recovery Analysis adds a bounded recovery strategy, blocker hierarchy, decision dynamics, caution and evidence-linked interpretation for eligible access. Structured output is validated before it is accepted; unsupported or ambiguous claims do not silently become business facts.

Recovery Score is a separate deterministic function. It combines Buying Intent, reason recoverability and quote recency using fixed weights, applies a confidence adjustment and safety caps, and produces a High, Medium or Low review priority. It does not use a model to calculate the score, estimate calibrated sale probability, forecast revenue or claim money has been recovered.

The application connects those results through Overview, Deals, Deal Detail, Recovery Queue and Insights. Stored results remain viewable without another model call. The interface keeps source notes, analysis and recommended action distinct so that a user can assess why a suggestion is reasonable.

## Engineering choices

The interface uses React and TypeScript with an existing Next-compatible application structure implemented through Vinext on a Cloudflare Worker. Supabase supplies Auth and PostgreSQL persistence. Workspace membership, tenant ownership and Row Level Security determine data access. Server validation and narrow authorized RPCs protect analysis persistence and usage accounting; browser-supplied organization, plan, allowance or model values cannot grant authority.

Explicit AI operations use bounded source inputs, strict schemas, evidence checks, reservations and operation identities. A retry of a stored valid result does not call the provider again. Recovery scoring is independent of the model. The supported billing foundation uses Paddle Sandbox with signed raw-body webhook verification, provider-backed state, lifecycle controls and idempotent event handling. Real Paddle Live acceptance and payments remain a separate activation gate.

The premium interface uses restrained orange, graphite and neutral surfaces, a compact application shell, responsive deal summaries, evidence-focused reports and accessible disclosures. The goal is a coherent work environment with usable next actions, rather than decorative charts or unsupported integrations.

## What has been demonstrated

The accepted private development baseline includes focused authentication redirect regressions, isolated trial and metering tests, full application/PostgreSQL and rendered Worker checks, lint, typecheck, native builds, artifact checks, secret scanning, immutable-migration comparisons and protected-state preservation. Browser evidence covers specific responsive and keyboard paths. Final Batch 2 source identity, test totals and exceptions belong to the accompanying development acceptance report; this public narrative does not substitute for that evidence.

The security claim is a set of verified controls, not a certification. The application is not represented as SOC 2 certified, penetration-tested by an independent firm, invulnerable or already commercially operated. A time-bounded build/lint dependency exception and unresolved hosted/provider acceptance items are documented in the private engineering record.

## What is still separate

Commercial activation needs actual domain/email control, transactional Auth delivery, security/provider acceptance, cost limits and alert delivery, backup/restore acceptance, Paddle Live approval and real authorized payment/lifecycle testing. Customer-value validation must use authorized customer data and observed outcomes. No testimonial, recovered-revenue figure, customer count, uptime SLA or conversion improvement is claimed.

This project demonstrates product design, typed application development, multi-tenant authorization, evidence-grounded AI workflows, deterministic scoring, usage durability, billing lifecycle engineering and auditable preservation. It remains a commercially intended SaaS whose funding and provider activation are pending.

## Presentation assets

- [Interactive synthetic showcase](showcase/index.html)
- [Recovery workflow and product explanations](Product-Walkthrough.md)
- [Public-safe architecture overview](Technical-Architecture.md)
- [Marketplace and recruiter copy](Marketplace-and-Recruiter-Copy.md)
- [Short demonstration script](Demo-Script.md)
- [Asset origin and publication boundaries](Presentation-README.md)

No part of this packet has been published or submitted to a marketplace. Public publication requires the owner's explicit approval after review.
