#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend/pluto_duck_frontend"
BACKEND_DIR="$ROOT_DIR/backend"

# Start backend in background
echo "Starting backend on port 8123..."
cd "$BACKEND_DIR"
python run_backend.py --port 8123 --host 127.0.0.1 &
BACKEND_PID=$!
echo "Backend started with PID $BACKEND_PID"

# Function to cleanup backend on exit
cleanup() {
  echo "Stopping backend (PID $BACKEND_PID)..."
  kill $BACKEND_PID 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Start frontend in foreground
echo "Starting frontend on port 3100..."
pnpm --dir "$FRONTEND_DIR" dev --hostname 127.0.0.1 --port 3100

