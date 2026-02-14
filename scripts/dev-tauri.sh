#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$ROOT_DIR/tauri-shell"

echo "Killing frontend processes on 3100 (if any)..."
if pids=$(lsof -ti tcp:3100 2>/dev/null); then
  echo "$pids" | xargs -r kill
else
  echo "No frontend process detected on 3100"
fi

if [ -f "$HOME/.cargo/env" ]; then
  echo "Sourcing $HOME/.cargo/env"
  source "$HOME/.cargo/env"
fi

cd "$TAURI_DIR"

echo "Starting cargo tauri dev"
cargo tauri dev
