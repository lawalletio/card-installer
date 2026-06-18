#!/usr/bin/env bash
# One-shot dev environment bootstrap for card-installer.
# Installs SDKMAN (Java manager), nvm (Node manager), the pinned JDK and Node,
# then yarn install. Idempotent — safe to re-run.
#
# Usage:
#   ./scripts/setup.sh
#
# Requirements:
#   - macOS or Linux
#   - curl, bash, git
#   - Android Studio + SDK installed separately (this script does NOT install Android SDK)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; }

# -----------------------------------------------------------------------------
# 1. SDKMAN — manages the Java toolchain via .sdkmanrc
# -----------------------------------------------------------------------------
if [ -d "${SDKMAN_DIR:-$HOME/.sdkman}" ]; then
  ok "SDKMAN already installed at ${SDKMAN_DIR:-$HOME/.sdkman}"
else
  log "Installing SDKMAN…"
  curl -s "https://get.sdkman.io?rcupdate=true" | bash
  ok "SDKMAN installed. Restart your shell or run: source \"\$HOME/.sdkman/bin/sdkman-init.sh\""
fi

# shellcheck disable=SC1091
source "${SDKMAN_DIR:-$HOME/.sdkman}/bin/sdkman-init.sh"

# Enable auto-env so `cd` into the project switches Java automatically
SDKMAN_CONFIG="${SDKMAN_DIR:-$HOME/.sdkman}/etc/config"
if [ -f "$SDKMAN_CONFIG" ] && ! grep -q '^sdkman_auto_env=true' "$SDKMAN_CONFIG"; then
  log "Enabling sdkman_auto_env in $SDKMAN_CONFIG"
  if grep -q '^sdkman_auto_env=' "$SDKMAN_CONFIG"; then
    sed -i.bak 's/^sdkman_auto_env=.*/sdkman_auto_env=true/' "$SDKMAN_CONFIG"
  else
    printf '\nsdkman_auto_env=true\n' >> "$SDKMAN_CONFIG"
  fi
fi

log "Installing Java from .sdkmanrc (idempotent)…"
sdk env install
sdk env
ok "Java: $(java -version 2>&1 | head -1)"

# -----------------------------------------------------------------------------
# 2. nvm — manages Node via .nvmrc
# -----------------------------------------------------------------------------
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  ok "nvm already installed at $NVM_DIR"
else
  log "Installing nvm…"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"

log "Installing Node from .nvmrc…"
nvm install
nvm use
ok "Node: $(node --version)"

# -----------------------------------------------------------------------------
# 3. Yarn — install if missing (Corepack-friendly)
# -----------------------------------------------------------------------------
if ! command -v yarn >/dev/null 2>&1; then
  log "Installing yarn…"
  npm install -g yarn
fi
ok "Yarn: $(yarn --version)"

# -----------------------------------------------------------------------------
# 4. JS dependencies
# -----------------------------------------------------------------------------
log "Installing JS dependencies (yarn install)…"
yarn install --frozen-lockfile
ok "node_modules ready"

# -----------------------------------------------------------------------------
# 5. .env scaffold
# -----------------------------------------------------------------------------
if [ ! -f ".env" ]; then
  if [ -f ".env-example" ]; then
    log "Creating .env from .env-example — edit before building"
    cp .env-example .env
    warn "Update .env with your MIFARE_KEY and other secrets before deploying"
  else
    warn ".env not found and no .env-example to scaffold from"
  fi
else
  ok ".env already present"
fi

# -----------------------------------------------------------------------------
# 6. Android SDK sanity check
# -----------------------------------------------------------------------------
ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [ ! -d "$ANDROID_SDK" ]; then
  warn "Android SDK not found at $ANDROID_SDK"
  warn "Install Android Studio and the SDK, then set ANDROID_HOME, or edit android/local.properties"
else
  ok "Android SDK: $ANDROID_SDK"
fi

if [ ! -f "android/local.properties" ]; then
  log "Creating android/local.properties pointing at $ANDROID_SDK"
  printf 'sdk.dir=%s\n' "$ANDROID_SDK" > android/local.properties
fi

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
ok "Setup complete."
echo
echo "Next steps:"
echo "  1. Edit .env if you haven't already"
echo "  2. yarn build:debug         # build debug APK"
echo "  3. yarn android             # install on connected device/emulator"
echo
echo "If your shell hasn't loaded SDKMAN auto-env, run \`sdk env\` in this directory before building."
