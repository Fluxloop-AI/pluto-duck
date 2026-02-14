#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend/pluto_duck_frontend"
SERVER_DIST_DIR="$ROOT_DIR/dist/pluto-duck-frontend-server"
TAURI_SHELL_DIR="$ROOT_DIR/dist/tauri-ui-shell"

copy_tree_follow_links() {
  local src="$1"
  local dest="$2"
  local rc=0
  set +e
  rsync -aL "$src" "$dest"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 23 ]; then
    echo "rsync failed (code=$rc): $src -> $dest" >&2
    exit "$rc"
  fi
  if [ "$rc" -eq 23 ]; then
    echo "rsync completed with code 23 (partial transfer due to source link issues); continuing"
  fi
}

echo "Building Next.js standalone server..."
pnpm --dir "$FRONTEND_DIR" build

echo "Preparing standalone server bundle..."
rm -rf "$SERVER_DIST_DIR"
mkdir -p "$SERVER_DIST_DIR"

# Resolve symlinks while copying so Tauri resource packaging sees a fully materialized tree.
copy_tree_follow_links "$FRONTEND_DIR/.next/standalone/" "$SERVER_DIST_DIR/"
mkdir -p "$SERVER_DIST_DIR/.next"
copy_tree_follow_links "$FRONTEND_DIR/.next/static/" "$SERVER_DIST_DIR/.next/static/"

if [ -d "$FRONTEND_DIR/public" ]; then
  copy_tree_follow_links "$FRONTEND_DIR/public/" "$SERVER_DIST_DIR/public/"
fi

remaining_links="$(find "$SERVER_DIST_DIR" -type l | wc -l | tr -d ' ')"
if [ "$remaining_links" -ne 0 ]; then
  echo "Standalone bundle still contains symlinks ($remaining_links). Failing build." >&2
  exit 1
fi

echo "Preparing Tauri static shell..."
rm -rf "$TAURI_SHELL_DIR"
mkdir -p "$TAURI_SHELL_DIR"
cat > "$TAURI_SHELL_DIR/index.html" <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pluto Duck</title>
    <style>
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0b1220;
        color: #e2e8f0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .status {
        opacity: 0.8;
        font-size: 14px;
        letter-spacing: 0.02em;
      }
    </style>
  </head>
  <body>
    <div class="status">Starting Pluto Duck server...</div>
  </body>
</html>
EOF

echo "Frontend server bundle ready:"
echo "  - $SERVER_DIST_DIR"
echo "  - $TAURI_SHELL_DIR"
