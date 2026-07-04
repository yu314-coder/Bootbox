#!/usr/bin/env bash
#
# build.sh — archive MiniOS and export a signed .ipa for App Store Connect.
#
# Usage:
#   ./build.sh                # archive + export IPA (needs TEAM_ID set below or via env)
#   ./build.sh archive        # archive only
#   ./build.sh export         # export from an existing archive
#   ./build.sh upload         # upload the exported IPA via altool (needs App Store Connect creds)
#
# Prereqs: Xcode 16+, a paid Apple Developer account, and your Team ID.
# Set your Team ID in ExportOptions.plist (teamID) and optionally export TEAM_ID here.

set -euo pipefail

SCHEME="MiniOS"
PROJECT="MiniOS.xcodeproj"
CONFIG="Release"
BUILD_DIR="build"
ARCHIVE="$BUILD_DIR/MiniOS.xcarchive"
EXPORT_DIR="$BUILD_DIR/ipa"
EXPORT_OPTS="ExportOptions.plist"
TEAM_ID="${TEAM_ID:-}"          # optional: overrides nothing, just a reminder

cmd="${1:-all}"

archive() {
  echo "▶ Archiving $SCHEME ($CONFIG)…"
  xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIG" \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE" \
    clean archive \
    CODE_SIGN_STYLE=Automatic \
    ${TEAM_ID:+DEVELOPMENT_TEAM=$TEAM_ID}
  echo "✓ Archive at $ARCHIVE"
}

export_ipa() {
  echo "▶ Exporting IPA…"
  [ -d "$ARCHIVE" ] || { echo "✗ No archive at $ARCHIVE — run ./build.sh archive first"; exit 1; }
  grep -q "YOUR_TEAM_ID" "$EXPORT_OPTS" && {
    echo "✗ Edit $EXPORT_OPTS and set your real teamID first."; exit 1; }
  xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportOptionsPlist "$EXPORT_OPTS" \
    -exportPath "$EXPORT_DIR"
  echo "✓ IPA exported to $EXPORT_DIR"
}

upload() {
  IPA=$(ls "$EXPORT_DIR"/*.ipa 2>/dev/null | head -n1 || true)
  [ -n "$IPA" ] || { echo "✗ No .ipa in $EXPORT_DIR — run ./build.sh export first"; exit 1; }
  echo "▶ Uploading $IPA to App Store Connect…"
  echo "  (Requires: export ASC_API_KEY_ID / ASC_API_ISSUER_ID and an App Store Connect API key,"
  echo "   or use Xcode → Organizer → Distribute App for an interactive upload.)"
  xcrun altool --upload-app -f "$IPA" -t ios \
    --apiKey "${ASC_API_KEY_ID:?set ASC_API_KEY_ID}" \
    --apiIssuer "${ASC_API_ISSUER_ID:?set ASC_API_ISSUER_ID}"
}

case "$cmd" in
  archive) archive ;;
  export)  export_ipa ;;
  upload)  upload ;;
  all)     archive && export_ipa ;;
  *) echo "usage: ./build.sh [archive|export|upload|all]"; exit 1 ;;
esac
