#!/usr/bin/env bash
set -euo pipefail

# This command is invoked by Tauri (see `tauri-shell/src-tauri/tauri.conf.json`)
# before bundling the app.
#
# For remove-python refactor, this step prepares a standalone Next.js server
# bundle plus a tiny static shell used as Tauri frontendDist.

if [ "${TAURI_SKIP_BEFORE_BUILD:-0}" = "1" ]; then
  echo "TAURI_SKIP_BEFORE_BUILD=1 -> skipping beforeBuildCommand"
  exit 0
fi

echo "Running beforeBuildCommand (frontend server build)..."
bash ../scripts/build-frontend-server.sh
