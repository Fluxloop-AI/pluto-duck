#!/bin/zsh
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: $0 <path-to-app>"
  echo "Example: $0 './target/release/bundle/macos/Pluto Duck.app'"
  exit 1
fi

APP_PATH="$1"
KEYCHAIN_PROFILE="${NOTARIZE_PROFILE:-pluto-duck-notarize}"
POLL_INTERVAL_SECONDS="${NOTARIZE_POLL_INTERVAL_SECONDS:-20}"
MAX_WAIT_SECONDS="${NOTARIZE_MAX_WAIT_SECONDS:-1800}" # 30 minutes

if [ ! -d "$APP_PATH" ]; then
  echo "Error: App not found at $APP_PATH" >&2
  exit 1
fi

echo "========================================="
echo "Notarizing: $(basename "$APP_PATH")"
echo "========================================="
echo ""

# Ensure notarytool is available
if ! command -v xcrun >/dev/null 2>&1; then
  echo "Error: xcrun not found. Install Xcode Command Line Tools." >&2
  exit 1
fi
if ! xcrun notarytool --help >/dev/null 2>&1; then
  echo "Error: notarytool not available. Ensure Xcode >= 13 installed." >&2
  exit 1
fi

# NOTE: notarytool does not provide a `list-profiles` subcommand.
# We simply attempt to submit with the keychain profile. If it doesn't exist,
# notarytool will error and we print a helpful message.
#
# If you want the script to auto-create the profile, export these env vars:
#   APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD
#
# Then run:
#   xcrun notarytool store-credentials "$KEYCHAIN_PROFILE" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD"

# Create zip for submission
ZIP_PATH="${APP_PATH}.zip"
echo "Creating zip archive..."
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

# Submit for notarization
echo "Submitting to Apple for notarization..."
echo "(This may take 5-15 minutes; we'll poll up to $((MAX_WAIT_SECONDS/60)) minutes)"
echo ""

# Submit without waiting, then poll. This avoids hanging forever in some cases.
SUBMIT_JSON=$(xcrun notarytool submit "$ZIP_PATH" \
  --keychain-profile "$KEYCHAIN_PROFILE" \
  --output-format json 2>&1) || {
    echo "$SUBMIT_JSON"
    echo ""
    echo "❌ Submit failed. If you see a keychain profile error, create it once with:" >&2
    echo "  xcrun notarytool store-credentials \"$KEYCHAIN_PROFILE\" --apple-id \"<APPLE_ID>\" --team-id \"<TEAM_ID>\" --password \"<APP_SPECIFIC_PASSWORD>\"" >&2
    echo "" >&2
    echo "Tip: The password must be an app-specific password from appleid.apple.com" >&2
    rm -f "$ZIP_PATH"
    exit 1
  }

echo "$SUBMIT_JSON"

# Extract submission id from json (no jq dependency)
SUBMISSION_ID=$(echo "$SUBMIT_JSON" | tr -d '\n' | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
if [ -z "$SUBMISSION_ID" ]; then
  echo ""
  echo "❌ Could not parse submission id from notarytool output." >&2
  rm -f "$ZIP_PATH"
  exit 1
fi

echo ""
echo "Submission ID: $SUBMISSION_ID"
echo "Polling status..."

START_TIME=$(date +%s)
STATUS="In Progress"

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START_TIME))
  if [ "$ELAPSED" -ge "$MAX_WAIT_SECONDS" ]; then
    echo ""
    echo "❌ Timed out after $((MAX_WAIT_SECONDS/60)) minutes." >&2
    echo "You can check later with:" >&2
    echo "  xcrun notarytool info $SUBMISSION_ID --keychain-profile $KEYCHAIN_PROFILE" >&2
    echo "  xcrun notarytool log  $SUBMISSION_ID --keychain-profile $KEYCHAIN_PROFILE" >&2
    rm -f "$ZIP_PATH"
    exit 1
  fi

  INFO_JSON=$(xcrun notarytool info "$SUBMISSION_ID" --keychain-profile "$KEYCHAIN_PROFILE" --output-format json 2>&1 || true)
  STATUS=$(echo "$INFO_JSON" | tr -d '\n' | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [ -z "$STATUS" ]; then
    STATUS="In Progress"
  fi
  echo "  status: $STATUS (elapsed ${ELAPSED}s)"

  if [ "$STATUS" = "Accepted" ]; then
    break
  fi
  if [ "$STATUS" = "Invalid" ] || [ "$STATUS" = "Rejected" ]; then
    echo ""
    echo "❌ Notarization failed (status: $STATUS)!"
    echo "Fetching logs..."
    xcrun notarytool log "$SUBMISSION_ID" --keychain-profile "$KEYCHAIN_PROFILE" || true
    rm -f "$ZIP_PATH"
    exit 1
  fi

  sleep "$POLL_INTERVAL_SECONDS"
done

# Check if successful
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

# Clean up
rm -f "$ZIP_PATH"

echo ""
echo "App location: $APP_PATH"

