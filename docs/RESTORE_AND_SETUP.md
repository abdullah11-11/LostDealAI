# Restore and reproduce the private application

The final source ZIP/file manifest and complete Git bundle are the source authority. The final preservation report identifies the exact accepted commit/tree, private GitHub branch/PR and the retained production Version 49. A private PR is preservation, not production release. Never substitute the historical Prompt 16 `current/` snapshot or assume an unmerged documentation PR changed production.

## Offline integrity restoration

1. Keep the original ZIP, external checksums and Git bundle read-only; work in a new directory outside synced `sources/`.
2. Verify the whole ZIP SHA-256/size against external checksums. Extract into an empty directory with a ZIP tool preserving Unix executable modes. Reject duplicate, absolute, traversal, symlink, credential and runtime-environment paths.
3. Verify every source file's exact bytes and recorded Git mode against the file manifest. Windows line-ending conversion is not permitted: set checkout-local `core.autocrlf=false` before materializing files. The four `scripts/*.sh` executable modes must remain 100755 in the canonical source.
4. Run `git bundle verify <bundle>` and inspect its exact branch/ref. Clone the local bundle into a separate checkout, select the recorded commit and confirm `git rev-parse HEAD^{tree}` equals the manifest tree. Do not connect to or push any remote during restoration.
5. Compare all historical migration hashes/modes. There are 16 accepted historical source migrations; do not rewrite their names/timestamps, run unrestricted `db push`, or infer the remote migration ledger from the source filenames.
6. Compare extracted source against the bundle checkout. A complete source bundle proves code history, not a customer database backup. Keep operational data backups separately encrypted and access-controlled.

## Reproducible local environment

Use the Node version required by `package.json` (at least 22.13) and the exact committed npm lockfile. Inspect the current `.npmrc`, scripts and pinned tool versions first. Use `npm ci`; never `audit fix --force`. An existing installed cache may be reused only when its package/lock identities and installed metadata match the validated inputs.

Copy `.env.example` to an ignored local file only when configuration is necessary. Enter real credentials privately through the provider's supported secret manager; never put them in screenshots, command arguments, transcripts, Git, example files or shared checkpoints. Begin with checkout disabled and Sandbox/SHADOW. The example's blank secrets are intentional, not a usable Live configuration. Do not reproduce temporary historical QA credentials.

The pinned application build is `npm run build`; it uses the verified build scripts, font-cache portability helper and artifact validator. For Windows, use the supported native Node/Sites build workflow and the recorded external helper/commands from the QA evidence rather than replacing dependencies to avoid shell restrictions. Build helpers must bind the source and lockfile before/after and restore tracked font-cache references after the build.

Run all `tests/*.test.ts` with `node --import tsx --test`, then the built Worker suite with `node --test tests/rendered-html.test.mjs`, full ESLint and TypeScript `--noEmit`. The final report records exact commands/counts and complete logs. These isolated checks must not load production credentials or call paid providers. Live DB proposal tests belong only in synthetic local PostgreSQL/PGlite fixtures.

## Configuration boundaries

`APP_ORIGIN` is the exact approved HTTPS application origin, not a wildcard or an arbitrary redirect supplied by a browser. Supabase project URL/publishable key are client-safe; usage authority, model keys, Paddle server/signing credentials and database credentials are server-only. Source declares the supported keys; do not invent provider configuration or treat secrets from one environment as valid in another.

Hosted Auth confirmation/templates/SMTP/rate/abuse/session settings are separately accepted configuration. Retain token-hash callbacks and verified recovery markers. Enabling CAPTCHA requires compatible source/token acceptance, not only a dashboard switch.

Do not change `.openai/hosting.json` to another deployment identity during restoration. A separate staging projection may differ in its staging project ID; preserve the production source and identity independently. Do not publish a restored candidate until its own gates and owner approval pass.

## Future changes and recovery

The Live SQL under `docs/live-activation/` is an UNAPPLIED REVIEW DRAFT. It is not part of the historical migration ledger. It must be reviewed, generated as a new forward-only migration through the installed supported CLI, tested in an isolated restore, and separately approved before application to a persistent environment. Original tenant IDs, associations, Sandbox records and Internal authority remain unchanged.

Retain the prior GitHub main SHA/complete repository history and the final source bundle. Roll back an application by redeploying a separately approved verified prior artifact; never force-push protected history, delete billing/usage history, restore a production database merely to reverse a UI change, or silently rewind payment events. Provider/DB recovery must follow the reviewed transaction/reconciliation strategy and owner-approved scope.
