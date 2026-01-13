#!/usr/bin/env bash
set -euo pipefail

# This command is invoked by Tauri (see `tauri-shell/src-tauri/tauri.conf.json`)
# before bundling the app.
#
# Problem we hit:
# - In CI we already build+codesign the backend and build the frontend.
# - But the default `beforeBuildCommand` rebuilt the backend again (unsigned),
#   which then got bundled into the app under `Contents/Resources/_up_/_up_/...`
#   and caused notarization failures ("valid Developer ID certificate" / "secure timestamp").
#
# Solution:
# - Allow CI to skip the pre-build step by setting `TAURI_SKIP_BEFORE_BUILD=1`.

if [ "${TAURI_SKIP_BEFORE_BUILD:-0}" = "1" ]; then
  echo "TAURI_SKIP_BEFORE_BUILD=1 -> skipping beforeBuildCommand"
  exit 0
fi

echo "Running beforeBuildCommand (backend + frontend build)..."
../scripts/build-backend.sh
pnpm --dir ../frontend/pluto_duck_frontend build

