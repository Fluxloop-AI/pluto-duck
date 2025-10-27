#!/bin/zsh
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <path-to-app>"
  echo "Example: $0 './target/release/bundle/macos/Pluto Duck.app'"
  exit 1
fi

APP_PATH="$1"
KEYCHAIN_PROFILE="${NOTARIZE_PROFILE:-pluto-duck-notarize}"

if [ ! -d "$APP_PATH" ]; then
  echo "Error: App not found at $APP_PATH" >&2
  exit 1
fi

echo "========================================="
echo "Notarizing: $(basename "$APP_PATH")"
echo "========================================="
echo ""

# Create zip for submission
ZIP_PATH="${APP_PATH}.zip"
echo "Creating zip archive..."
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

# Submit for notarization
echo "Submitting to Apple for notarization..."
echo "(This may take 5-10 minutes)"
echo ""

SUBMISSION_OUTPUT=$(xcrun notarytool submit "$ZIP_PATH" \
  --keychain-profile "$KEYCHAIN_PROFILE" \
  --wait 2>&1)

echo "$SUBMISSION_OUTPUT"

# Check if successful
if echo "$SUBMISSION_OUTPUT" | grep -q "status: Accepted"; then
  echo ""
  echo "✓ Notarization accepted!"
  
  # Staple the ticket
  echo "Stapling notarization ticket..."
  xcrun stapler staple "$APP_PATH"
  
  # Verify
  echo "Verifying stapled app..."
  xcrun stapler validate "$APP_PATH"
  
  echo ""
  echo "✅ Notarization complete!"
  echo "Your app is ready for distribution."
else
  echo ""
  echo "❌ Notarization failed!"
  echo "Check the output above for details."
  
  # Extract submission ID for log retrieval
  if SUBMISSION_ID=$(echo "$SUBMISSION_OUTPUT" | grep "id:" | head -1 | awk '{print $2}'); then
    echo ""
    echo "To view detailed logs:"
    echo "  xcrun notarytool log $SUBMISSION_ID --keychain-profile $KEYCHAIN_PROFILE"
  fi
  
  rm -f "$ZIP_PATH"
  exit 1
fi

# Clean up
rm -f "$ZIP_PATH"

echo ""
echo "App location: $APP_PATH"

