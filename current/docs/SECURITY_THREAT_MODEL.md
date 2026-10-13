# LostDeal AI V1 security threat model

This is a practical V1 threat model, not a claim of absolute security. LostDeal
AI assumes browser input, identifiers, uploads, imported text, and provider
errors are hostile. Verified identity, server-resolved workspace membership,
authoritative records, strict input validation, and Supabase RLS form the trust
boundary.

| Threat | Existing protection | Prompt 12 hardening | Remaining limitation |
| --- | --- | --- | --- |
| Cross-tenant access / IDOR | RLS and organization-scoped reads | Central verified route context, tenant-scoped resource preflight, uniform unavailable response, route-matrix tests | Authorization still depends on correct Supabase membership administration |
| Broken authentication assumptions | Supabase SSR cookies and signed JWT claims | Protected routes use fresh `getClaims()`; no browser session or organization ID is authority | Compromised user credentials remain valid until revoked/expired |
| CSRF on mutations | SameSite auth cookies and framework Server Action handling | API POSTs validate `Origin`/Fetch Metadata and expected content type | Missing-Origin compatibility is allowed when no cross-site Fetch Metadata signal exists |
| XSS from imported text | React escapes text by default | Raw-HTML audit, hostile source fixtures, CSP, filename normalization | CSP retains inline script/style compatibility for the current Vinext runtime |
| PostgREST/filter injection | Fixed query shape and allowlisted sort/filter keys | Bounded query strings and injection regression tests | Future filters must reuse the same allowlist/escaping pattern |
| Oversized request / CSV abuse | 5 MB file, 2,000-row, and field-length limits | Early `Content-Length` rejection with multipart overhead, long-header tests, server reparse | Missing/false `Content-Length` still requires post-parse file-size validation |
| OpenAI credit abuse | Explicit analysis only, batch cap, source cap, bounded retry | Shared D1 rate limits on single/batch analysis; authorization remains before paid calls | Provider-side budgets and alerts are still operational requirements |
| Duplicate AI execution | Atomic pending/failed → processing claim; completed-result reuse | Duplicate and inconsistent-status regressions retained | A provider call that succeeds immediately before an unrecoverable persistence outage may still require review |
| Prompt injection in notes/transcript | Source is delimited and labeled data; strict output schema | Expanded injection fixtures for secrets, scoring, tenancy, and system-prompt requests | Model behavior is probabilistic; server authorization and deterministic scoring never depend on source instructions |
| Provider error leakage | Errors map to safe application codes/messages | Routes never return raw provider responses, request IDs, stack traces, or key fragments | Operational debugging needs provider-console access outside customer UI |
| Secret exposure | OpenAI key is server-only and ignored local config is untracked | Client-bundle, tracked-source, public-directory, docs, and backup scans | Secret rotation remains an operator responsibility |
| Malicious filenames | Filename is metadata only, never a filesystem path | Unicode/control/path/markup normalization and 180-character cap | The original user-selected name may still appear locally in the browser before upload |
| Stale/inconsistent authorization | Every query is organization scoped and RLS enforced | Identity and active organization are resolved on each protected request | Membership changes during an already-running provider call cannot cancel that external request |
| Unsafe deletion | Analysis FK already cascades; no broad delete grant existed | Explicit two-step confirmation plus tenant-scoped deal DELETE policy/grant | Account/workspace deletion is deliberately out of Prompt 12 scope |
| Dependency / supply chain | Lockfile and bounded CI installation | `npm audit`, production finding review, no forced major upgrade | Package registries and upstream maintainers remain external dependencies |
| Dashboard/query leakage | Prompt 9.1 derives top opportunities from tenant core records | Private/no-store response policy and cross-tenant/read-only regressions | Browser/device compromise can expose data visible to that signed-in user |

## Data and provider boundary

Normal page loads do not contact OpenAI. On an explicit Analyze action, the
server sends only deal value, quote date, service type, status, sales notes, and
transcript. It does not intentionally send organization UUIDs, user UUIDs,
Supabase deal UUIDs, auth tokens, cookies, or unrelated workspace data.

Sales notes and transcripts are user-provided free text and may themselves
contain personal information. LostDeal AI cannot guarantee that free text is
PII-free. A naive redaction layer is intentionally not used because it can
silently change business meaning and break exact evidence grounding. Users
should import only authorized information and avoid unnecessary sensitive data.

## Data lifecycle

CSV bytes are parsed in the request and are not persisted. LostDeal AI stores
normalized deal fields plus upload metadata (safe filename, counts, status,
creator, and timestamps). Deleting one deal removes that deal and its cascaded
analysis; it leaves its upload metadata, other deals, users, and organization
untouched.

## Prompt 17A update

Sensitive APIs also obtain a fresh Auth user, refreshed SSR cookies forward
downstream, and auth pages are no-store. Actual streamed-byte bounds replace
header-only request-size assumptions. Imports and usage are one protected
transaction; direct deal/upload INSERT/UPDATE grants are revoked. Tenant-RLS
provider results persist with metering for replay. Expiring token/mode claims
fence analysis completion/failure. Saved PENDING analysis keeps quota until
finalization. Safe application request IDs correlate failures without raw
provider/auth identifiers or sensitive payloads.

Normalized conversion output/provenance is retained for retry; original CSV
bytes are not stored. Commercial retention/deletion policy must cover these
copies. See PROMPT_17A_HARDENING.md for verified controls, measured boundaries,
known lower-severity issues and deployment/restore limits.
