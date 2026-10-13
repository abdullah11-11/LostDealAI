# Historical archive verification

The preserved private repository has30 stored ZIPs. All30 match the actual byte counts/SHA256/container counts in `MANIFEST.csv` and `SHA256SUMS.txt`, and all decoded ZIP contents/CRC checks passed. The `ORIGINAL_MANIFEST.csv` and `ORIGINAL_SHA256SUMS.txt` files record alternate container identities; none match the actual stored container bytes.

An older README description that stored containers had been regenerated is therefore superseded by this measured note. Neither the stored containers nor either manifest set is rewritten. Original archives tree identity: `d31e968228f06a973354a87c953020854509237f`. The pre-change main commit and complete local recovery bundle remain available; this review branch preserves the original parent/history.

This is integrity evidence, not authorization for public exposure. The full relevant upstream history and recursively decoded archives passed private-pattern and separate actual in-memory secret-value scans before synchronization. The diagnostic raw history-scan archive, signed download URLs and inspection caches are intentionally excluded from this branch.
