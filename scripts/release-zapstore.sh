#!/usr/bin/env bash
#
# Release to Zapstore (https://zapstore.dev) with the `zsp` CLI.
#
# Builds a production-signed APK and publishes it non-interactively. All
# credentials are pulled in automatically, so the CLI never prompts:
#
#   SIGN_WITH          NIP-46 bunker URL (signs the Nostr release event)  <- .env
#   KEYSTORE_PASSWORD  APK signing keystore password                      <- ~/.gradle/gradle.properties
#   keystore file      android/app/my-upload-key.keystore
#
# Usage:
#   ./scripts/release-zapstore.sh         build signed APK + publish to Zapstore
#   ./scripts/release-zapstore.sh link    one-time: link the signing key to your
#                                         Nostr identity (NIP-C1 proof)
#   DRY_RUN=1 ./scripts/release-zapstore.sh   sign events but do NOT upload (zsp --offline)
#
set -euo pipefail
cd "$(dirname "$0")/.."

KEYSTORE="android/app/my-upload-key.keystore"
APK="android/app/build/outputs/apk/release/app-release.apk"
CONFIG="zapstore.yaml"
GRADLE_PROPS="$HOME/.gradle/gradle.properties"

command -v zsp >/dev/null 2>&1 || {
  echo "✗ zsp not installed — run: go install github.com/zapstore/zsp@latest"; exit 1; }

# --- credentials (filled in automatically) ---------------------------------
# Bunker URL (NIP-46) that signs the Zapstore/Nostr events.
export SIGN_WITH="${SIGN_WITH:-$(grep -E '^SIGN_WITH=' .env 2>/dev/null | head -1 | cut -d= -f2-)}"
[ -n "${SIGN_WITH:-}" ] || { echo "✗ SIGN_WITH (bunker:// URL) not set in .env"; exit 1; }
# Upload keystore password — consumed by 'zsp identity --link-key'.
export KEYSTORE_PASSWORD="${KEYSTORE_PASSWORD:-$(grep -E '^MYAPP_UPLOAD_STORE_PASSWORD=' "$GRADLE_PROPS" 2>/dev/null | head -1 | cut -d= -f2-)}"

# --- one-time: link the signing key to the Nostr identity ------------------
if [ "${1:-}" = "link" ]; then
  [ -f "$KEYSTORE" ] || { echo "✗ keystore not found: $KEYSTORE"; exit 1; }
  [ -n "${KEYSTORE_PASSWORD:-}" ] || { echo "✗ KEYSTORE_PASSWORD not found in $GRADLE_PROPS"; exit 1; }
  # zsp picks the keystore format from the file extension (.keystore => JKS),
  # but ours is PKCS12 — give it a .p12 copy in a temp dir (cleaned on exit).
  TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
  cp "$KEYSTORE" "$TMPD/upload.p12"
  echo "→ Linking signing key to your Nostr identity (one-time)…"
  zsp identity --link-key "$TMPD/upload.p12"
fi

# --- build a production-signed release APK ---------------------------------
echo "→ Building signed release APK…"
./scripts/build release
[ -f "$APK" ] || { echo "✗ APK not found: $APK"; exit 1; }

# Refuse to publish a debug-signed APK to the store.
if keytool -printcert -jarfile "$APK" 2>/dev/null | grep -q "Owner:.*Android Debug"; then
  echo "✗ APK is debug-signed. Put the upload keystore + MYAPP_UPLOAD_* creds in ~/.gradle/gradle.properties."
  exit 1
fi

# --- publish to Zapstore ---------------------------------------------------
DRY=""
if [ "${DRY_RUN:-}" = "1" ]; then DRY="--offline"; echo "(dry run: signing events but not uploading)"; fi
echo "→ Publishing to Zapstore via zsp…"
zsp publish "$CONFIG" --quiet $DRY
echo "✓ Zapstore publish complete."
