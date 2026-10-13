# Prompt 17A current-audit source-map patch

The refreshed audit on 2026-10-06 reported HIGH advisory
[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
CVE-2026-93749, for source-map-js 1.2.1. It was absent from the audit that
passed before Release 46 was deployed. The current production audit must
take precedence; the approved braces exception does not cover this finding.

The production-classified dependency path is Next 16.3.8 → PostCSS 8.5.23 →
source-map-js 1.2.1. The same deduplicated package also serves Vite and
Tailwind tooling. No application endpoint for processing uploaded source
maps was found; that does not waive the zero-production-findings gate.

The maintainer's 1.2.2 release fixes denial of service through malicious
indexed source-map offsets. npm confirms it is installable, requires
Node >=0.10.0, and all existing dependent ranges accept it. The lockfile-only
update changes exactly node_modules/source-map-js from 1.2.1 to 1.2.2.
No manifest dependency, framework version, override or security exception
is added or changed.

Two executable dependency tests verify ordinary generation/source round trips
and rejection of oversized, invalid and cumulatively oversized nested
section offsets before expensive serialization. The whole existing suite,
clean locked install, build, artifacts and current audits are rerun.
The final release/checkpoint records those results and deployment identity.
No database migration or tenant/provider operation is part of this update.
