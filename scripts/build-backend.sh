#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Activate virtual environment
if [ -f "$ROOT_DIR/.venv/bin/activate" ]; then
  source "$ROOT_DIR/.venv/bin/activate"
fi

if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "pyinstaller is not available in PATH" >&2
  exit 1
fi

rm -rf dist/pluto-duck-backend build/pluto-duck-backend

pyinstaller pluto-duck-backend.spec --distpath dist --workpath build --clean

# # Copy .env file if it exists
# if [ -f .env ]; then
#   echo "Copying .env to backend distribution..."
#   cp .env dist/pluto-duck-backend/.env
# fi

