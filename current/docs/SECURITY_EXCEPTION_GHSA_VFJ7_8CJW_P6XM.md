# Temporary Prompt 16 security exception: braces

## Approval and expiration

- Owner approved this exception on **2026-10-05** in the Prompt 16 final
  security-exception instruction (2026-10-05 16:38:50 UTC).
- Advisory: **GHSA-vfj7-8cjw-p6xm**; CVE: **CVE-2026-93687**.
- Severity: **HIGH**; affected leaf: **braces@3.0.3**.
- Expiration date: **2026-11-04**. Treat the exception as invalid on or after
  2026-11-04 00:00 UTC; no automatic extension is authorized.
- The exception expires immediately when any installable patched braces
  release becomes available, even before the calendar expiration.

References: [advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
and [upstream report](https://github.com/micromatch/braces/issues/70).

## Exact authorized dependency paths

1. `eslint-config-next@16.3.8` → `@next/eslint-plugin-next@16.3.8` →
   `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`.
2. `vinext@0.0.50` → `vite-plugin-commonjs@0.10.4` →
   `vite-plugin-dynamic-import@1.6.0` → `fast-glob@3.3.3` →
   `micromatch@4.0.8` → `braces@3.0.3`.

Only this advisory through these exact paths is approved. The eight HIGH
package entries propagated from this one advisory are covered only while
their versions, paths and build-only exposure match this scope. No other
advisory, changed path, broader dependency range, or runtime HIGH/CRITICAL
finding is approved. Do not suppress the raw audit results or weaken audit,
signature, tenant, entitlement, or regression checks.

## Exposure and no-fix status

Deeply nested brace patterns can exhaust the stack in braces' recursive
walkers. The affected paths process lint/build patterns. Source inspection and
the generated Worker/client artifact scan found no request-time import of the
affected glob/build packages. This is the basis for the build-only exposure
classification, not a claim that devDependencies are automatically absent
from runtime: vinext also provides runtime code, which must be checked
separately from its vulnerable build-plugin dependency path.

The 2026-10-05 npm registry recheck lists 3.0.3 as the latest published braces
version and no installable patched release. The prepared production audit has
zero findings. Unsafe framework churn, incompatible downgrades and an
unreviewed local fork are not accepted substitutes for a compatible fix.

## Compensating controls and release gates

- Preserve the reviewed dependency remediation commit
  `7d799c2f2b886f43418b283380e70ca765806c37`; use its integrity-pinned lockfile
  and a clean `npm ci` installation.
- Build only reviewed project source and configuration. Customer uploads and
  request data must not become lint/build glob patterns or build inputs.
- Deploy the validated Worker/client artifact, without node_modules or lint
  and Vite build tooling. Check the assembled artifact for runtime exposure.
- Require `npm audit --omit=dev` to report **zero findings**. Inspect the full
  audit without filtering it; accept only this advisory and these exact paths
  under this exception. Any runtime HIGH/CRITICAL finding blocks release.
- Require all regression, billing/security, rendered, RLS/tenant, lint,
  typecheck, build, artifact, secret-scan, migration-immutability and provenance
  checks to pass. Preserve tenant subscriptions, usage, history and isolation.

## Recheck requirement and remediation trigger

The release owner must recheck at least daily while this exception is open,
at the start of each release task, and immediately before every deployment:

```sh
npm view braces version versions dist-tags --json
npm audit --json
npm audit --omit=dev --json
```

Review the advisory and published package versions together; a registry error
is not evidence that no fix exists. Record the results in the release
checkpoint. If a patched release is installable, the date expires, either
path changes, or runtime exposure is identified, invalidate this exception
and stop release work. Apply the compatible upstream fix, rerun all release
gates, and remove this exception after verified remediation. Any renewed or
different exception requires a separate explicit owner approval.
