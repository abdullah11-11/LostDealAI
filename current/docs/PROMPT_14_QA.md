# Prompt 14 QA ledger

Prompt 14 freezes the LostDeal AI V1 feature set. Every source change below is
a minimal correction for a reproduced defect; no product capability, database
object, dependency, AI field, dashboard metric, or scoring rule was added.

| ID | Severity | Area | Reproduction / actual result | Expected result | Root cause | Fix and regression | Retest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P14-001 | LOW | Smart Import date review | `00/12/2026` and `12/00/2026` were classified as ambiguous instead of invalid. | Impossible zero date parts should be rejected immediately. | Ambiguity detection ran before the minimum date-part check. | Reject zero numeric date parts before ambiguity handling; `tests/prompt14-qa.test.ts`. | PASS |
| P14-002 | LOW | Deals pagination | `?page=2junk` was interpreted as page 2. | Malformed page values should safely fall back to page 1. | `Number.parseInt` accepted a numeric prefix. | Require a complete positive-integer string before conversion; `tests/prompt14-qa.test.ts`. | PASS |

## Known V1 limitation reviewed

Multi-batch imports are not database-transactional. If a later insert batch
fails, prior successful batches remain, the upload is marked failed, and the
response reports the inserted count. External deal IDs protect retry rows from
duplication. Rows without external IDs cannot receive equivalent retry
protection, so the owner should review a failed import before retrying. A fully
atomic cross-table import would require a larger database/RPC change and is not
a safe Prompt 14 patch; it is not a release blocker because failure is explicit
and successful rows are auditable.

## Automated evidence

- Existing Prompt 4–13.3 regression tests remain the baseline.
- Prompt 14 adds focused fuzz, boundary, security, side-effect, Unicode,
  retention, migration, and 2,000-row performance coverage.
- Provider behavior is mocked; Prompt 14 automated QA makes zero paid OpenAI
  calls.
- Browser/device visual checks remain owner-required when the authenticated
  preview cannot be reached from the QA browser.
