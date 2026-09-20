# LostDeal AI Deep Recovery Analysis

Deep Recovery Analysis is a strict, evidence-grounded superset of Standard Analysis. It is implemented for owner `INTERNAL` use during the current `SHADOW` rollout. Starter remains on full Standard Analysis. Commercial Trial/Pro execution stays inactive until verified billing is implemented and enforcement is intentionally enabled.

## Product contract

One explicit **Run Deep Analysis** action can produce all Standard-compatible core fields plus:

- primary blocker and up to three distinct secondary blockers;
- recovery thesis and qualitative customer readiness;
- bounded objection hierarchy and decision dynamics;
- timing, price/value, and competitor interpretation;
- recovery strategy and recovery risk;
- margin/discount caution;
- a bounded follow-up strategy and one customer-facing draft for human review.

Deep is decision support, not hidden reasoning. It does not store chain-of-thought, calculate Recovery Score, estimate conversion probability, send outreach, or change Prompt 8 weights and thresholds.

## Explicit operations and usage

- Direct Deep on an unanalyzed deal: one provider operation and one `AI_ANALYSES` unit.
- Standard then explicit Deep: two operations and two total units.
- Reusing a valid stored Deep result: zero provider calls and zero new units.
- Explicit Deep re-run: one new operation and one unit.
- Import, Auto Convert, dashboard load, deal-list/detail load, account load, score calculation, plan state change, and downgrade: zero Deep calls.

The existing generic usage ledger remains authoritative. There is no Deep credit, point, token, table, or second metering system. Trial's future preview is capped atomically at two Deep operations inside its existing 10-unit `AI_ANALYSES` allowance.

## Access policy

| Plan/state | Standard | Deep provider execution now |
|---|---|---|
| `INTERNAL`, `SHADOW` | Active | Active |
| Starter | Active | Denied before provider |
| Trial/Pro, `SHADOW` | Entitlements can render | Inactive before provider |
| Verified Trial/Pro, future `ENFORCED` | Active | Eligible according to plan/status/usage |
| Business | Inactive commercial schedule | Inactive |

The server resolves organization identity, same-origin status, deal authorization, rate limit, plan/subscription state, schema readiness, and usage reservation before the provider runner can execute. Browser plan/model input is ignored. Rapid duplicate operations use a UUID idempotency key plus the existing database reservation and deal-processing claim.

Historical Deep output remains stored and viewable after a future downgrade. New Deep runs require eligible access. Paddle downgrade synchronization is intentionally deferred to Prompt 16.

## Validation and safety

- Responses API Structured Outputs with a strict Zod schema.
- `store: false`, low reasoning effort, 4,000-token output ceiling.
- At most eight exact core evidence excerpts; all Deep evidence links reference those excerpts by bounded index.
- Notes/transcript source limit: 60,000 characters, with no silent truncation.
- Unknown keys/enums, oversized arrays, invalid evidence indices, duplicate blocker categories, unsupported numeric claims, malformed output, and ungrounded core evidence are rejected.
- Weak evidence requires `OTHER`, low confidence, no invented blocker hierarchy, and cautious human review.
- Imported prompt injection remains untrusted deal data.
- No organization/user/subscription IDs, auth cookies, API keys, unrelated deals, or Recovery Score are sent.
- Suggested follow-up is never sent automatically and cannot add unsupported guarantees, terms, discounts, APR, reservations, or numeric claims.

Provider failure leaves no corrupted Deep object, marks the explicit attempt retryable through the existing state machine, and leaves any prior validated Standard result stored and visible. A successful validated Deep result replaces compatible core fields, stores its versioned Deep object, then invokes the unchanged deterministic scorer. A scoring failure never invalidates the completed AI analysis.

## Persistence and compatibility

Apply exactly once after Prompt 15.2:

`supabase/migrations/20260902020000_prompt15_3_deep_analysis.sql`

It adds one requested mode to `deals`; mode/schema/deep JSON/timestamp fields to `deal_analyses`; bounded constraints and authenticated column grants; and the two-operation Trial Deep check inside the existing reservation function. It creates no table, policy, service-role path, or payment object.

The original Prompt 15.3 release kept Standard functional before its Deep-only migration. That migration and the Prompt 15.3.1 runtime-hardening migration are now owner-confirmed as applied. The Deep route verifies column readiness. Deal detail still uses compatibility queries for stored results, while every new Standard/Deep analysis or Recovery Score write requires the protected runtime contract and otherwise returns `MIGRATION_REQUIRED` before a provider call or protected mutation.

Old Standard rows remain valid through database defaults and application normalization (`STANDARD`, `standard-1.0`). Deep core fields use the same existing columns, so the locked Recovery Score input contract stays compatible.

## Prompt 15.3.1 runtime hardening

The owner applied `20260902020000_prompt15_3_deep_analysis.sql` and reported the Prompt 15 commercial checks passing. The first real Internal Deep attempt then reached the provider but returned the safe public failure code `AI_RESPONSE_INVALID`; no invalid or partial Deep result was persisted.

The exact defect class was a contract mismatch after Structured Output parsing. The strict schema legitimately allowed harmless representation variants—most notably semantically equivalent no-decision-maker wording and duplicate exact evidence entries—but the post-validator required one byte-exact sentence and treated evidence deduplication as corruption without remapping Deep evidence indexes. Structurally valid, grounded provider output could therefore fail after parsing. The provider's raw customer-bearing response was correctly not retained, so the precise branch taken by that one historical response cannot be reconstructed; both contradictory rejection paths were present deterministically in the shipped code.

Prompt 15.3.1 fixes that boundary without making unsafe output permissive:

- exact source grounding occurs before canonicalization;
- bounded text is Unicode/whitespace normalized and safe unsupported-decision wording is canonicalized to the single stored sentence;
- duplicate exact evidence is deterministically deduplicated while every Deep evidence index is remapped and deduplicated;
- the normalized object is parsed through the strict Zod schema again;
- blocker consistency, evidence bounds, decision-maker, competitor, numeric, sensitive factual, psychological, and prompt-injection protections remain rejecting;
- safe diagnostic categories identify parsing, normalization, grounding, semantic, provider, persistence, and usage-finalization failure classes without storing raw responses, notes, transcripts, provider errors, or secrets.

Standard and Deep remain intentionally different: Standard stores the bounded core contract, while Deep returns the same core plus the versioned strategy object. Both remain on `gpt-5.6-terra`; Auto Convert remains on `gpt-5.6-luna`. Prompt 15.3.1 made no model, prompt-token-limit, price, plan-limit, scoring-formula, or provider-benchmark change, and repeated **zero** paid benchmark calls.

Runtime durability is also hardened. A validated result that requires metering is atomically stored with `analysis_usage_status = 'PENDING'`; an idempotent, analysis-bound finalizer then moves the existing `AI_ANALYSES` reservation and result to committed state. A bounded immediate retry is followed by an explicit customer-visible pending-reconciliation state. Retrying that state commits at most one unit and performs zero additional provider calls. OFF-mode rows remain explicitly legacy/unmetered.

Recovery Score ordering no longer constructs the known PostgREST relationship order. A tenant-checked SQL function applies the same search and filters, globally orders score ascending or descending with nulls last and deal ID tie-breaking, then paginates IDs. The application fetches only those IDs and restores the database order. The Prompt 8 formula remains unchanged, page loads still perform zero score writes, and scoring still performs zero provider calls.

Authenticated Data API clients now retain tenant-scoped read access but no direct insert/update access to AI-derived analysis fields or protected deal analysis state. Narrow RPCs require the existing server-only authority secret, authenticated membership, target organization/deal ownership, an allowlisted operation, and valid state/payload checks. No normal-runtime `service_role` path was added.

The owner has applied this migration exactly once after Prompt 15.3:

`supabase/migrations/20260905070000_prompt15_3_1_runtime_hardening.sql`

Its catalog contract and the updated `supabase/tests/prompt15_commercial_checks.sql` remain the verification source. Existing stored Standard/Deep output remains readable through the compatibility query.

## Prompt 15.3.2 usage reservation runtime hotfix

After Prompt 15.3.1 was applied, owner Standard and Deep attempts both failed before OpenAI. PostgreSQL logged `function date_trunc(unknown, time with time zone) does not exist` inside `public.reserve_organization_usage(text,uuid,text,integer,text)`. The function declared a local `current_time timestamptz := clock_timestamp()` and used `date_trunc('month', current_time)` for `INTERNAL`; PL/pgSQL resolved the ambiguous identifier against SQL `CURRENT_TIME` semantics, producing `time with time zone` instead of `timestamptz`.

Prompt 15.3.2 adds exactly one forward migration:

`supabase/migrations/20260905083511_prompt15_3_2_usage_reservation_runtime_hotfix.sql`

It replaces only that existing function and renames all 11 uses of the local clock to the explicit `runtime_now timestamptz := clock_timestamp()`. The exact signature, table return shape, `SECURITY DEFINER`, empty `search_path`, authority digest, membership check, metric and plan behavior, Trial two-Deep limit, advisory lock, idempotency, expiration, 15-minute reservation, and authenticated-only execution grant remain unchanged. It adds no table, policy, metric, model, plan, price, payment object, service-role path, or private-schema grant.

The earlier automated suites did not catch the defect because they inspected the migration contract and exercised application workflows with deterministic stores; they did not execute the PL/pgSQL function in PostgreSQL. Prompt 15.3.2 adds an exact function-body equivalence guard plus explicit timestamp, signature, security, quota, expiration, duplicate-reservation, and Standard/Deep wiring coverage. Automated implementation made zero live OpenAI calls and zero paid benchmark calls.

Older `permission denied for schema private` log entries were not produced by the intended reservation application calls. Those calls entered the `SECURITY DEFINER` function and reached both `private.is_org_member` and `private.plan_usage_limit` before failing at `date_trunc`. No broad `private` schema permission is required or granted.

The hotfix migration still requires owner/ChatGPT database application, followed by the read-only commercial checks and one owner Standard and one owner Deep test. Fresh logs must be free of both the `date_trunc` runtime error and any private-schema permission error on those exact application paths; usage must show exactly one `AI_ANALYSES` unit per successful operation. Prompt 16 remains NO-GO until that validation passes.

## Prompt 15.3.3 Recovery Score sort authorization hotfix

Prompt 15.3.3 changed only the existing tenant-checked Recovery Score ordering
function from `SECURITY INVOKER` to `SECURITY DEFINER`. Its empty search path,
fully qualified references, private membership check, exact signature, filters,
global ordering, nulls-last behavior, pagination, and client grants remain
unchanged. The owner has confirmed both sort directions pass live without
granting clients access to the private schema. Deep validation does not modify
this path or the Prompt 8 scoring formula.

## Prompt 15.3.4 Deep semantic validator hotfix

The next owner Deep attempt reached Structured Output parsing but failed with
`AI_RESPONSE_INVALID / semantic_validation_failure`. The failed candidate was
correctly not stored and committed zero customer-facing `AI_ANALYSES` units.
Provider output uses `store: false` and raw output is never persisted. Retained
version-34 structured runtime logs later identified the latest owner failure as
the bounded class `timing_category_evidence_mismatch`; the customer-bearing
provider wording itself remains unavailable by design.

Prompt 15.3.4 aligns the strict provider contract, deterministic normalization,
and semantic validator without accepting unsupported claims:

- single-clause, source-scoped absence language is recognized through a bounded
  allowlist and is canonicalized before post-validation when its evidence list
  is empty;
- timing and price/value canonicalize to `INSUFFICIENT_EVIDENCE`, competitor to
  `NO_MEANINGFUL_EVIDENCE`, and discount caution to
  `UNSUPPORTED_BY_EVIDENCE`;
- absence categories may retain a grounded evidence reference when the source
  explicitly records the absence; positive categories still require evidence;
- exact duplicate secondary blockers or objections collapse by first
  occurrence, preserve order and the first explanation, and union/deduplicate
  at most three evidence indexes;
- different explanations for the same reason remain contradictory and fail;
  the primary blocker repeated as a secondary always fails;
- the weak-source, decision-maker, competitor-name, numeric, sensitive-fact,
  psychological, prompt-injection, evidence-grounding, and evidence-index
  protections remain rejecting.

The eight former generic semantic branches now have safe internal classes:
`duplicate_secondary_blocker`, `primary_secondary_overlap`,
`duplicate_objection_reason`, `weak_evidence_contract`,
`timing_category_evidence_mismatch`,
`price_value_category_evidence_mismatch`,
`competitor_category_evidence_mismatch`, and
`discount_category_evidence_mismatch`. Persistence intentionally retains the
existing high-level `semantic_validation_failure` value. On a failure, the
server writes only the event name and bounded class to its structured log—never
provider JSON, notes, transcripts, hidden reasoning, or credentials.

This application-only hotfix requires **no new migration**. It advances the
Deep prompt version to `deep-1.1`, retains schema version `deep-1.0`, and keeps
Auto Convert on `gpt-5.6-luna` plus Standard and Deep on `gpt-5.6-terra`.
Implementation and tests make zero live provider or paid benchmark calls. After
deployment, the owner should make exactly one live Deep attempt, verify one
committed unit only on success, reload to confirm stored reuse with no new unit,
and then run the final small Auto Convert smoke. Prompt 16 remains blocked until
those owner checks pass.

## Prompt 15.3.5 final Deep semantic reliability

Version 34 still treated punctuation and ordinary conjunctions as semantic
safety boundaries inside `isSafeDeepAbsenceExplanation(...)`. Consequently, a
safe multi-clause explanation such as “No competitor is mentioned, and nothing
in the record supports competitor pressure” could be rejected even though each
clause was evidence-scoped absence language. The latest retained v34 failure
was `timing_category_evidence_mismatch`.

Prompt 15.3.5 replaces that sentence-shape dependency with deterministic,
dimension-aware clause classification. Text is Unicode/whitespace normalized,
split on bounded punctuation and connectors, and accepted for absence
canonicalization only when every meaningful clause is an allowlisted
source/evidence-scoped absence or caution and at least one explicit clause
matches the requested timing, price/value, competitor, or discount dimension.
A mixed positive assertion, recovery prescription, certainty claim, or
unsupported numeric claim still fails closed. No additional model is called.

Same-reason secondary blockers and objections are now normalized by first
occurrence. The first explanation is retained unchanged, valid evidence indexes
are unioned in stable order within the existing bound, and later paraphrases are
discarded rather than concatenated. A redundant secondary entry matching the
primary reason is removed; primary blocker consistency remains mandatory.

Future semantic failures persist only one of these bounded diagnostic values:
`duplicate_secondary_blocker`, `primary_secondary_overlap`,
`duplicate_objection_reason`, `weak_evidence_contract`,
`timing_category_evidence_mismatch`,
`price_value_category_evidence_mismatch`,
`competitor_category_evidence_mismatch`, or
`discount_category_evidence_mismatch`. The protected authority-and-membership
checked transition RPC remains the only application write path. No raw provider
output, notes, transcript, evidence text, hidden reasoning, credential, or stack
trace is stored for diagnostics.

The single forward migration is:

`supabase/migrations/20260908055554_prompt15_3_5_deep_semantic_diagnostic_hardening.sql`

It expands the existing `analysis_error_detail` CHECK allowlist and the same
protected `transition_deal_analysis(...)` RPC allowlist. It adds no column,
table, policy, service-role runtime path, or broad private-schema permission.
All earlier migration files remain byte-for-byte unchanged.

Regression coverage includes the six required natural punctuation/connector
cases, unsafe mixed clauses, dimension boundaries, all four absence
canonicalizations, reason deduplication, exact diagnostic persistence, usage
finalization, Juniper, Maple, Orchard, weak-source behavior, and the existing
decision-maker, competitor, numeric, psychological, prompt-injection, evidence,
Standard, Auto Convert, Recovery Score, and migration-hardening contracts.

Deep prompt version advances to `deep-1.2`; Deep schema version remains
`deep-1.0`. Auto Convert remains `gpt-5.6-luna`; Standard and Deep remain
`gpt-5.6-terra`. Automated development makes zero live provider calls and
reruns zero paid benchmarks. After migration and private deployment, the owner
must run exactly one final Synthetic Juniper Deep test, verify usage increases
by one on success, then refresh and verify no additional usage. Prompt 16 stays
NO-GO until that owner QA passes.

## Prompt 15.3.6 final Deep runtime root-cause closure

The v35 owner run on Synthetic Juniper reached the configured Deep provider and
passed Structured Output parsing, then failed in the application validator with
`AI_RESPONSE_INVALID`. The durable class was
`price_value_category_evidence_mismatch`; no Deep result was stored and the
reserved `AI_ANALYSES` event was not committed. The exact throw site was
`assertCategoryEvidenceConsistency(...)` in `lib/ai/deep-analysis.ts`.

The deterministic reproduction uses the same bounded synthetic source and a
valid provider shape whose price/value field says price was not established as
the primary blocker while referencing generic no-response evidence. V35 only
canonicalized safe absence wording when `evidence_indices` was empty. A
nonempty but irrelevant evidence reference therefore turned one optional,
non-probative interpretation into a whole-operation failure.

Prompt 15.3.6 makes the safety policy explicit:

| Class | Fields | Failure behavior |
| --- | --- | --- |
| Critical | Core classification/evidence/scores, primary blocker, recovery thesis, customer readiness, decision dynamics, recovery strategy/risk, follow-up strategy | Any invalid evidence, fabrication, contradiction, unsupported number/name/sensitive fact, psychological claim, or prompt-injection output rejects the whole operation. |
| Optional repairable | Secondary blockers, objections, timing, price/value, competitor, discount | Unsupported or irrelevant optional interpretations are discarded at the field boundary and replaced with a fixed conservative fallback; unrelated evidence is never preserved. |

The four fixed fallbacks are `INSUFFICIENT_EVIDENCE` for timing and price/value,
`NO_MEANINGFUL_EVIDENCE` for competitor dynamics, and
`UNSUPPORTED_BY_EVIDENCE` for discount guidance. Every fallback has an empty
evidence array and fixed application-owned wording. Model text is never copied
into a repaired field. Directly supported positive interpretations remain
unchanged. Evidence deduplication and remapping remain stable and bounded.

Critical safety checks run before optional normalization and again after it.
This prevents a repair from erasing an invented competitor, unsupported numeric
or sensitive fact, psychological claim, fabricated evidence, or instruction-
following output. The Structured Output descriptions and Deep instructions now
tell the model that an estimate, generic engagement, or later silence does not
constitute direct price, competitor, or discount evidence.

Prompt 15.3.6 advances only the Deep prompt version to `deep-1.3`. The schema
shape/version remains `deep-1.0`; Standard stays on `gpt-5.6-terra`, Deep stays
on `gpt-5.6-terra`, and Auto Convert stays on `gpt-5.6-luna`. Recovery Score,
sorting, plan limits, usage semantics, billing mode, and customer-visible data
shapes do not change. No database migration is required, and all existing
migrations remain immutable.

The engineering canary ran only after every deterministic and security gate
passed. One direct `gpt-5.6-terra` call on the Synthetic Juniper fixture
succeeded with prompt `deep-1.3` and schema `deep-1.0`: the core result remained
`NO_RESPONSE`, directly supported timing remained `NEAR_TERM_FOLLOW_UP`, and
price/value, competitor, and discount safely resolved to their conservative
fallbacks. It used 3,041 input and 1,009 output tokens (4,050 total; estimated
cost `$0.018190`). The authorized second canary was not needed. The harness used
no customer deal, reservation, usage ledger, persistence write, or outreach.

The final owner production run is now verified. Synthetic Juniper completed as
Deep with `NO_RESPONSE`, persisted the bounded Deep sections, committed exactly
one `AI_ANALYSES` unit, and a later detail-page reload added zero units. A
separate explicit Deep operation on another deal occurred afterward and
correctly committed its own unit; it was not a retry or duplicate charge.

## Prompt 15.3.7 final omnibus QA

Prompt 15.3.7 re-audits the complete Prompt 15.3.x path without making a
provider call or changing application semantics. The current eight-table
Supabase catalog, RLS policies, column grants, protected RPCs, private-schema
boundary, usage ledger, global Recovery Score sort, and owner Deep evidence all
pass. Rollback-only impersonation proves same-organization reads and allowed
writes, cross-organization denial, anonymous denial, and rejection of direct
analysis, subscription, usage, and protected deal-state writes.

The omnibus cleanup removes the reproducible TypeScript build-info cache,
updates the canonical catalog check to the current protected-write model,
resolves the Vite native-loader warnings and deprecated Node loader invocation,
and advances compatible Cloudflare, Wrangler, browser-target, archive, YAML,
and URI build dependencies to their fixed patch lines. The production audit is
clean. The broader development audit retains two high findings through Vinext's
`image-size` dependency and one low finding through Babel; available fixes
require major toolchain upgrades and are deferred to a dedicated compatibility
milestone because neither dependency is in the hosted request path. The tracked
Vinext font cache is retained because a clean build without it exceeded the
bounded build timeout; it is a required offline-build input, not proven dead
weight. The release adds no migration, table, column, policy, function,
feature, plan, price, model, prompt, schema, score rule, or provider call.
Standard and Deep remain on
`gpt-5.6-terra`; Auto Convert remains on `gpt-5.6-luna`; billing remains
`SHADOW`.

Prompt 15.3.x is closed and Prompt 16 may begin. Commercial launch remains
blocked until billing, domain/email, legal, monitoring, backup/restore, and the
other launch controls in the gap register are completed.

## Server-only model configuration

```dotenv
OPENAI_AUTO_CONVERT_MODEL=gpt-5.6-luna
OPENAI_STANDARD_ANALYSIS_MODEL=gpt-5.6-terra
OPENAI_DEEP_ANALYSIS_MODEL=gpt-5.6-terra
```

`OPENAI_MODEL` retains its existing AI Mapping and Auto Convert fallback behavior. Standard and Deep use it as a compatibility fallback only when it equals the tested cost-safe Terra value; if either dedicated analysis variable is absent and the legacy value is another model, those two analysis modes fall back to Terra rather than silently escalating cost. All four OpenAI variables are server-only and must never use `NEXT_PUBLIC_` or appear in customer UI.
