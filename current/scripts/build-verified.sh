#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

command -v timeout || {
  echo "build-verified.sh requires GNU timeout." >&2
  exit 69
}

vinext="${SITES_PROJECT_ROOT}/node_modules/.bin/vinext"
if [[ ! -x "${vinext}" ]]; then
  echo "vinext is unavailable. Run npm run install:ci and wait for it to finish before building." >&2
  exit 69
fi

# Vinext can retain hashed assets from earlier builds. Package only this build.
# SITES_PROJECT_ROOT is canonicalized by sites-env.sh; dist is generated output.
node --input-type=module - "${SITES_PROJECT_ROOT}" <<'NODE'
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
await rm(resolve(process.argv[2], "dist"), { recursive: true, force: true });
NODE

echo "Running bounded vinext build..."
cleanup_font_cache() {
  node --import tsx --input-type=module -e 'import {makeFontCacheRelative} from "./build/font-cache-portability.ts"; await makeFontCacheRelative(".vinext/fonts");'
}
trap cleanup_font_cache EXIT
timeout \
  --signal=TERM \
  --kill-after="${SITES_BUILD_KILL_AFTER:-10s}" \
  "${SITES_BUILD_TIMEOUT:-3m}" \
  "${vinext}" build

"${script_dir}/validate-artifact.sh"
