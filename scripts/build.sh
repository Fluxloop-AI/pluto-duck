#!/bin/zsh
set -euo pipefail

echo "========================================="
echo "Pluto Duck - Local Build Script"
echo "========================================="
echo ""

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Step 1: Build Next standalone server bundle
echo "Step 1/2: Building frontend standalone server..."
echo "-----------------------------------------"
./scripts/build-frontend-server.sh
echo "✓ Frontend server build complete"
echo ""

# Step 2: Build Tauri App
echo "Step 2/2: Building Tauri app..."
echo "-----------------------------------------"
cd "$ROOT_DIR/tauri-shell"
export TAURI_SKIP_BEFORE_BUILD=1
# Local build path should be reproducible without macOS signing/notarization preconditions.
# Build only the .app bundle and override signing identity for this path.
cargo tauri build --bundles app --config '{"bundle":{"macOS":{"signingIdentity":null}}}'
echo "✓ Tauri build complete"
echo ""

echo "========================================="
echo "Build Complete!"
echo "========================================="
echo ""
echo "Your .app file is located at:"
echo "$ROOT_DIR/tauri-shell/src-tauri/target/release/bundle/macos/Pluto Duck.app"
echo ""
echo "To run it:"
echo "  open '$ROOT_DIR/tauri-shell/src-tauri/target/release/bundle/macos/Pluto Duck.app'"
echo ""
