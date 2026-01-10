#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend/pluto_duck_frontend"
BACKEND_DIR="$ROOT_DIR/backend"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "${GREEN}🦆 Pluto Duck Development Server${NC}"
echo "=================================="

# Activate Python virtual environment
if [ -f "$ROOT_DIR/.venv/bin/activate" ]; then
  echo "${YELLOW}Activating Python virtual environment...${NC}"
  source "$ROOT_DIR/.venv/bin/activate"
elif [ -f "$BACKEND_DIR/.venv/bin/activate" ]; then
  source "$BACKEND_DIR/.venv/bin/activate"
fi

# Function to cleanup on exit
cleanup() {
  echo ""
  echo "${YELLOW}Stopping services...${NC}"
  if [ -n "${BACKEND_PID:-}" ]; then
    kill $BACKEND_PID 2>/dev/null || true
  fi
  exit 0
}
trap cleanup EXIT INT TERM

# Start backend in background with hot-reload
echo "${GREEN}Starting backend on http://127.0.0.1:8123 (hot-reload enabled)...${NC}"
cd "$BACKEND_DIR"
uvicorn pluto_duck_backend.app.main:app --host 127.0.0.1 --port 8123 --reload --reload-dir pluto_duck_backend &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait for backend to be ready
echo "${YELLOW}Waiting for backend to be ready...${NC}"
MAX_WAIT=30
WAITED=0
while ! curl -s http://127.0.0.1:8123/health > /dev/null 2>&1; do
  sleep 1
  WAITED=$((WAITED + 1))
  if [ $WAITED -ge $MAX_WAIT ]; then
    echo "Backend failed to start within ${MAX_WAIT}s"
    exit 1
  fi
  echo -n "."
done
echo ""
echo "${GREEN}✓ Backend is ready!${NC}"

# Open browser after a short delay (give frontend time to start)
(sleep 3 && open "http://127.0.0.1:3100" 2>/dev/null || true) &

# Start frontend in foreground
echo "${GREEN}Starting frontend on http://127.0.0.1:3100 ...${NC}"
echo ""
echo "${GREEN}Opening browser...${NC}"
echo "=================================="
echo ""
cd "$FRONTEND_DIR"
pnpm dev --hostname 127.0.0.1 --port 3100
