#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend/pluto_duck_frontend"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "${GREEN}Pluto Duck Development Server${NC}"
echo "=================================="

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but not found in PATH"
  exit 1
fi

# Open browser after a short delay (give frontend time to start)
(sleep 3 && open "http://127.0.0.1:3100" 2>/dev/null || true) &

echo "${GREEN}Starting frontend (Next.js + Node API routes) on http://127.0.0.1:3100...${NC}"
echo ""
echo "${GREEN}Opening browser...${NC}"
echo "=================================="
echo ""
cd "$FRONTEND_DIR"
pnpm dev --hostname 127.0.0.1 --port 3100
