# Prompt 17A — Release 45 audit and risk map

Starting commit: 175fe2a59dfd8d923c681cd0a8bfa514c90c8bc6. No provider lifecycle tests, reconciliation, paid benchmarks or tenant mutations are authorized by this work. Before-state evidence and source backup are retained separately.

| Area | Classification / severity | Evidence and disposition |
| --- | --- | --- |
| Import transaction and metering | DATA-INTEGRITY RISK / P1 | Upload/deal batches and usage commit are separate; final commit failure is ignored. Replace with one authority-checked transaction and stable request identity. |
| Direct database deal/upload writes | SECURITY RISK / P1 | Live column grants allow authenticated INSERT independent of quota/paid-state checks. Revoke these after introducing the protected import RPC; preserve SELECT and tenant-scoped DELETE. |
| Auto Convert / mapping usage | BUG / P1 | Commit boolean ignored; successful provider output has no durable replay record. Persist bounded operation results and metering atomically; replay the same request without a provider call. |
| Interrupted Standard/Deep claims | BUG / P1 | Processing state has no lease recovery or worker ownership fence. Add expiring, fenced claims; preserve successful prior analysis and usage-pending recovery. |
| SSR refresh propagation | BUG / P2 | Forwarded headers are copied before cookie refresh; downstream sees old Cookie header. Forward refreshed request cookies. |
| Revoked-session writes | NEEDS HARDENING / P2 | Signed claims verify identity but not server logout. Revalidate the user for sensitive API operations; fail closed on provider/auth failure. |
| Request bounds / API errors | NEEDS HARDENING / P2 | Header-only multipart limits and inconsistent exception boundaries. Enforce actual streamed bytes; add safe error correlation without payload logs. |
| Font assets | BUG / P2 | Cached CSS retains absolute paths from previous checkout. Normalize cache references for the current root and validate rendered URLs against packaged fonts. |
| Billing / tenant relationships / model semantics / deterministic scoring | SAFE / STRONG, verify regression | Signed raw-body webhook, cursor/idempotency guards, tenant FKs/RLS, protected analysis RPCs, strict semantic/evidence fixtures and centralized plan catalog retained. |
| Dashboard and deal queries | PERFORMANCE RISK / P2 | Dashboard transfers all rows; filter options sample 2,000. Establish measured fixture baseline, move bounded display metadata to database aggregation where justified. |
| Public trigger-helper privilege | NEEDS HARDENING / P2 | rls_auto_enable is an event-trigger function, not an ordinary RPC; restrict EXECUTE without disabling its trigger. |
| Supabase password protection | OPERATIONAL GAP / P2 | Existing disabled leaked-password protection; no claim that it is enabled. Document current setting and launch implications. |
| Dependency audit | SECURITY review | Production must remain zero findings; sole permitted full-tree exception is the exact approved braces advisory until patch/expiry. |
| Operations / backup / alerting | OPERATIONAL GAP | Source/release checkpoints verified; managed backup/PITR and external alerts need observed evidence, not assumed guarantees. Document recovery and deployment ordering. |
| Test coverage | TEST GAP | Add PostgreSQL transaction/RLS fixtures, lost-response replay, failure/lease/fencing/concurrency and streamed-body tests; preserve all valid previous assertions. |

This is an initial audit map, not a release verdict. Each launch-critical entry must be closed with executable evidence before GO. No broad UI redesign or framework migration is planned.

## Implemented resolutions

The map above was recorded before implementation. The candidate preserves
Release 45 and dependency-remediation commit 7d799c2f2b886f43418b283380e70ca765806c37.
The exact published identity and final verdict are retained in the release checkpoint.

| Finding | Resolution and executable evidence |
| --- | --- |
| P1 partial import / unverified charge | persist_deal_import validates a field whitelist, reserves the exact ready-row count, saves all deals/upload and commits usage in one transaction. Fingerprint + stable upload UUID and a post-validation completion recheck replay the same result even when concurrent validation sees its own inserted IDs. PostgreSQL fixtures cover invalid-row/duplicate rollback, replay, mass assignment, terminal billing state and 2,000 rows. |
| P1 direct quota bypass | Revoke both table and historical column INSERT/UPDATE grants on deals/uploads; preserve reads and tenant-scoped deletion. PostgreSQL direct-write and tenant-spoof fixtures plus live ACL/RLS checks verify this. |
| P1 provider result / metering disagreement | Mapping and Auto Convert save bounded, tenant-RLS-protected results with usage atomically. Missing metering fails closed; response-loss retries read the saved result before a model call. PostgreSQL token, replay, zero-unit conversion and cross-tenant tests cover this. |
| P1 interrupted / competing analyses | Fifteen-minute UUID/mode claims fence persistence and failure. Expired claims recover on explicit subsequent requests. Active and fresh legacy processing cannot be stolen. SQL fixtures cover expiry, late failure, lost successful response and cutover. |
| P1 saved but unfinalized analysis | PENDING analysis holds quota after reservation expiry, cannot be refunded or assigned a replacement token, and finalizes exactly once without another model call. Executable SQL covers all three cases. |
| P2 unused reservations / retry lies | Known failures and lost claim races release only unused reservations. Committed/PENDING work is protected. The three-start D1 Auto Convert budget remains; SQL reservations replace the fixed operation lock that outlived failures. |
| P2 browser response-loss recovery | Request hashes and random operation UUIDs survive reload in sessionStorage without retaining source contents or credentials. Keys clear after the UI retains success. Concurrent, changed-input and restricted-storage tests pass. |
| P2 conversion duplicate-lookup outage | Persist supported conversion output with a visible warning when only the duplicate lookup fails. Import always repeats authoritative ID validation and has database uniqueness. Failed durable saves remain errors. |
| P2 auth / refresh / logout | APIs verify claims and a fresh Auth user before workspace access; refreshed cookies forward downstream; logout failure cannot pretend success. Auth and tenant responses are no-store. Existing auth/CSRF fixtures and the built Worker unauthorized API matrix remain. |
| P2 request bounds / diagnostics | Count actual bytes before parsing: JSON APIs 64 KiB, multipart 6 MiB, existing CSV file cap 5 MiB. Safe request UUID, route/category/status logs exclude payloads, SQL and credentials. Stream cancellation, lying-header and built Worker 413 tests pass. |
| P2 formula export | Neutralize formulas after whitespace/control characters while preserving ordinary text. Export tests pass. |
| P2 font assets | Relative cache source re-roots during build and returns to portable form on exit. Relocation/traversal tests and checks of packaged inline-font URLs pass. |
| P2 dashboard payload | Select scoring timestamp rather than complete model metadata, preserving legacy normalization and metrics. Projection equivalence and 20,000-record tenant/count fixtures pass. |
| P2 event-trigger helper | Revoke ordinary client EXECUTE on rls_auto_enable without disabling the owner-run trigger. Verify ACL after DDL. |

Browser state remains intent only. API workspace selection, query tenant predicates,
membership checks, RLS and composite foreign keys remain authoritative. New mutation
RPCs require runtime authority plus membership, empty search paths and explicit ACLs.
Provider results have member SELECT only; private claims have no client table grants.
Original CSV bytes are not stored. Normalized conversion output/provenance is stored
for retry and must be covered by commercial retention/deletion policy.

Standard/Deep model configuration, evidence and semantic validation, provider
timeouts/retries, deterministic scoring, score repair, plan catalog, webhook
signature verification, event cursors and billing idempotency are preserved.
Billing regression uses existing mocks/fixtures. This task makes no Paddle business
API or reconciliation call, purchase, or paid OpenAI benchmark.

## Validation and performance

Required gates: clean locked install; all 658 existing TypeScript tests plus 34
hardening/security tests (692 total); the two existing rendered tests plus three Worker/asset
tests (five total); auth, RLS, billing/security, import, AI semantics, scoring and
usage suites; lint; typecheck; production build/artifact; audits; secret scan;
migration immutability; clean source and deployment provenance.

The SQL fixture applies every unmodified migration to real PostgreSQL compiled to
WASM with real pgcrypto. Only isolated authority is substituted after migrations,
with membership checks retained. RPC bodies, constraints, locks and RLS are tested.
Administrator reads verify RPC-only metering tables without relaxing client grants.
Queued concurrency is a single-backend boundary test, not a production
multi-connection load guarantee.

The sole new dependency is dev-only @electric-sql/pglite@0.5.8. The refreshed audit
also required the compatible source-map-js patch from 1.2.1 to 1.2.2; all other
previous locked packages remain unchanged. Its advisory/path/compatibility review
is in PROMPT_17A_SOURCE_MAP_SECURITY_UPDATE.md. Production audit must be zero findings. Eight affected
build/lint packages arise from the single approved braces advisory. The exact two
paths and expiry/patch trigger in SECURITY_EXCEPTION_GHSA_VFJ7_8CJW_P6XM.md remain;
no waiver is broadened. PGlite and affected build/lint libraries must be absent
from deployed runtime imports.

The compact Northstar dashboard SQL returned 39 rows in 5.314 ms execution and
16.701 ms planning, using existing indexes. This is a DB diagnostic, not an HTTP
latency promise. Current assets: approximately 499 kB JS / 164 kB individually
gzipped across 44 files; 58 kB CSS; framework 190 kB raw; import workflow 80 kB raw /
23 kB gzip; Worker approximately 2.0 MB. Exact fresh figures and HTTP measurements
belong to the checkpoint.

## Remaining lower-severity issues

| Issue | Severity | Assessment |
| --- | --- | --- |
| Dashboard aggregates paged rows in memory | P2 performance | Non-blocking for 17A at observed size and 20,000-record fixture. Move to DB aggregation as tenant volumes grow. |
| Deal filter menus sample 2,000 rows | P2 functional/scaling | Non-blocking for 17A; rare later service/salesperson options may be absent. Deals remain accessible by pagination/search. Distinct tenant aggregation is needed for large-workspace filter completeness. |
| Leaked-password protection disabled | P2 security/operations | Pre-existing; no claim it is enabled. Resolve account security settings before public commercial launch. |
| Managed backup/PITR retention and actual data-restore drill unverified | P2 operations | Non-blocking for this internal release; commercial launch needs verified RPO/RTO/retention. Source/schema checkpoint is not a full data backup. |
| External alert delivery/provider budget alerts unverified | P2 operations | Safe diagnostic logs exist; commercial launch requires operator/monitoring/budget setup. |
| Saved conversion-result retention has no automated purge | P2 operations | Non-blocking for owner-private 17A. Establish explicit retention and deletion policy before public sales-data collection. No destructive cleanup is performed. |
| SMTP/domain/legal/support/live Paddle prerequisites | P2 commercial launch | Commercial launch remains separate and blocked by the launch register. 17B is not started here. |
| CSP inline script/style compatibility | P2 defense in depth | Non-blocking for 17A; React escaping and origin/input guards remain. Nonce-only CSP requires framework compatibility work. |

## Deployment, backup and recovery

Before DDL retain Release 45 identity, old migration hashes, deployed function/ACL/RLS
definitions and read-only subscription/usage/history hashes. Check zero in-flight
analyses. Apply only the tested forward file
20261005185926_prompt17a_atomic_operations_and_authorization.sql, then immediately
deploy the matching Worker. Imports/provider writes fail closed during this brief
compatibility cutover. Verify authenticated-role read-only SQL, forged authority,
grants/RLS, advisors and unchanged state after apply/deploy.

The native Supabase apply tool records its own ledger timestamp. Record its returned
version/name alongside the source filename/checksum. Older migrations already have
different ledger timestamps; do not assume an unrestricted CLI db push is safe.
Migration-history reconciliation needs a separately reviewed workflow.

Publish a clean commit, verify remote main, package only verified Worker/client and
hosting manifest, preserve owner-only access, then verify native version identity,
fresh HTTP/UI and assets. Previous saved Site versions remain available. Release 45
writes are incompatible with new grant/claim protections: do not blindly roll its
application back or restore the quota bypass. Prefer a reviewed forward fix or a
compatible release with writes disabled and reads preserved. Do not drop recovery
tables, reset usage or automatically run destructive restoration.

The disposable PostgreSQL fixture reproduces the schema from migrations. Production
data restoration was not attempted. Managed retention, PITR, offsite data backup,
RPO/RTO and restore authority require real provider/owner evidence. The checkpoint
contains release/source references, hashes, schema/function snapshots and QA evidence
without keys. It does not claim a full database backup.

Final GO requires the deployed identity, unchanged Northstar STARTER/canceled with
20 imports / one analysis and preserved history, unchanged Internal, and all safe
required smoke checks. Unavailable live authenticated UI is OPEN, not PASS.
