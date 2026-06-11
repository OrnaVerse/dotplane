#!/bin/bash
# Dotplane one-line bootstrap installer.
#
# Install latest release (auto-generates admin username + password; override optionally):
#   curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/dotplane/main/scripts/bootstrap-install.sh | \
#     sudo DOTPLANE_GITHUB_REPO=YOUR_ORG/dotplane bash
#
# Install specific version:
#   curl -fsSL ... | sudo DOTPLANE_GITHUB_REPO=YOUR_ORG/dotplane DOTPLANE_VERSION=v1.0.0 bash
#
# Install from a custom release URL (private mirror, air-gapped):
#   curl -fsSL ... | sudo DOTPLANE_RELEASE_URL=https://mirror/dotplane.tar.gz bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[dotplane-bootstrap]${NC} $1"; }
fail() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && fail "Run as root (use: curl ... | sudo bash)"
[[ "$(uname -s)" != "Linux" ]] && fail "Linux only"

# ── Resolve architecture ───────────────────────────────────────────────────────
ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  x86_64)  DOTPLANE_ARCH="amd64" ;;
  aarch64) DOTPLANE_ARCH="arm64" ;;
  *)       fail "Unsupported architecture: $ARCH_RAW (supported: x86_64, aarch64)" ;;
esac

# ── Resolve release URL ────────────────────────────────────────────────────────
if [[ -z "${DOTPLANE_RELEASE_URL:-}" ]]; then
  REPO="${DOTPLANE_GITHUB_REPO:-}"
  [[ -z "$REPO" ]] && fail "Set DOTPLANE_GITHUB_REPO=owner/repo (e.g. acme/dotplane)"

  VERSION="${DOTPLANE_VERSION:-latest}"
  if [[ "$VERSION" == "latest" ]]; then
    log "Resolving latest release for ${REPO}..."
    RELEASE_JSON="$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest")"
    if command -v jq >/dev/null 2>&1; then
      VERSION="$(echo "$RELEASE_JSON" | jq -r '.tag_name // empty')"
    else
      VERSION="$(echo "$RELEASE_JSON" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
    fi
    [[ -z "$VERSION" || "$VERSION" == "null" ]] && \
      fail "Could not resolve latest release — set DOTPLANE_VERSION=vX.Y.Z explicitly"
    log "Latest release: ${VERSION}"
  fi

  DOTPLANE_RELEASE_URL="https://github.com/${REPO}/releases/download/${VERSION}/dotplane-${VERSION}-linux-${DOTPLANE_ARCH}.tar.gz"
fi

export DOTPLANE_RELEASE_URL
export DOTPLANE_SKIP_BUILD=1

log "Release URL: ${DOTPLANE_RELEASE_URL}"

# ── Download and run install.sh from the same release ────────────────────────
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

log "Downloading release tarball..."
curl -fsSL "$DOTPLANE_RELEASE_URL" -o "${TMP_DIR}/release.tar.gz"
tar -xzf "${TMP_DIR}/release.tar.gz" -C "${TMP_DIR}"

# Tarball root is dotplane-{version}-linux-{arch}/
EXTRACTED="$(find "$TMP_DIR" -maxdepth 1 -type d -name 'dotplane-*' | head -1)"
[[ -z "$EXTRACTED" || ! -f "${EXTRACTED}/scripts/install.sh" ]] && \
  fail "Invalid release tarball — scripts/install.sh not found"

log "Starting install..."
# Piped curl|bash has no usable stdin — attach the controlling terminal so prompts
# and the final access summary are always visible.
if [[ -r /dev/tty && -w /dev/tty ]]; then
  exec bash "${EXTRACTED}/scripts/install.sh" --from-release "${EXTRACTED}" </dev/tty >/dev/tty 2>&1
else
  exec bash "${EXTRACTED}/scripts/install.sh" --from-release "${EXTRACTED}"
fi
