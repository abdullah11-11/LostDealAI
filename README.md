# LostDeal AI

**AI-powered lost-deal recovery platform that identifies why deals were lost, scores recovery opportunities, and generates evidence-grounded next actions and follow-ups.**

This private repository is the canonical code and milestone archive for LostDeal AI.

## Repository structure

- `current/` — browsable latest source snapshot, materialized from Prompt 16
- `archives/` — full-project ZIP snapshot for each available milestone
- `docs/ARCHIVE_INDEX.md` — historical archive coverage and recovery notes
- `docs/SECURITY.md` — archive safety notes
- `MANIFEST.csv` — hashes and metadata for the ZIPs stored in this repository
- `SHA256SUMS.txt` — SHA-256 integrity hashes for repository ZIPs
- `ORIGINAL_MANIFEST.csv` — metadata recorded from the original snapshot ZIPs
- `ORIGINAL_SHA256SUMS.txt` — hashes of the original snapshot ZIP byte streams

## Archive coverage

Available snapshot content covers Prompt 1 through Prompt 16, including Prompt 3.5, 9.1, 13.1–13.3, 15.1–15.3, 15.3.1–15.3.6, and Prompt 16.

Prompt 15.4 is documented by a recovery marker because the original Library record did not expose its raw contents to the archiving session.

## Archive integrity note

The ZIPs under `archives/` were deterministically regenerated inside GitHub from the verified extracted contents of the original milestone ZIPs. Their contained project files match the verified source snapshots, while ZIP-container byte hashes can differ from the original downloads because ZIP metadata/compression encoding can differ. The original ZIP identities are retained in `ORIGINAL_MANIFEST.csv` and `ORIGINAL_SHA256SUMS.txt`.

## Security

Runtime secrets are intentionally excluded. `.env.example` is retained as a configuration template. Keep this repository private while historical snapshots are stored here.
