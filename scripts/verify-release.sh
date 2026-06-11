#!/bin/bash
# Validate a Dotplane release bundle (staging directory or .tar.gz).
# Fails fast when required runtime artifacts are missing.
#
# Usage:
#   bash scripts/verify-release.sh dist-releases/dotplane-v1.0.0-linux-amd64
#   bash scripts/verify-release.sh dist-releases/dotplane-v1.0.0-linux-amd64.tar.gz

set -euo pipefail

TARGET="${1:?Usage: verify-release.sh <staging-dir-or-tarball>}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_DIR=""
TMP_DIR=""
failures=0

cleanup() {
  [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]] && rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require_file() {
  local rel="$1"
  if [[ ! -f "$CHECK_DIR/$rel" ]]; then
    echo "missing: $rel" >&2
    failures=$((failures + 1))
  fi
}

if [[ -f "$TARGET" && "$TARGET" == *.tar.gz ]]; then
  TMP_DIR="$(mktemp -d)"
  tar -xzf "$TARGET" -C "$TMP_DIR"
  CHECK_DIR="$(find "$TMP_DIR" -maxdepth 1 -type d -name 'dotplane-*' | head -1)"
  [[ -z "$CHECK_DIR" ]] && { echo "tarball has no dotplane-* root directory" >&2; exit 1; }
elif [[ -d "$TARGET" ]]; then
  CHECK_DIR="$(cd "$TARGET" && pwd)"
else
  echo "not a directory or .tar.gz: $TARGET" >&2
  exit 1
fi

echo "Verifying release bundle: $CHECK_DIR"

# Workspace install metadata
require_file "package.json"
require_file "pnpm-workspace.yaml"
require_file "pnpm-lock.yaml"

# Platform runtime
require_file "packages/platform/package.json"
require_file "packages/platform/dist/server/index.js"
require_file "packages/platform/dist/server/cli.js"

# Agent runtime
require_file "packages/agent/package.json"
require_file "packages/agent/dist/index.js"

# Shared workspace dependency (required at runtime — not bundled into dist)
require_file "packages/shared/package.json"
require_file "packages/shared/dist/index.js"

# Install/bootstrap
require_file "scripts/install.sh"
require_file "scripts/bootstrap-install.sh"
require_file "scripts/generate-certs.sh"
require_file "systemd/dotnet-app@.service"
require_file "VERSION"

if [[ "$failures" -gt 0 ]]; then
  echo "Release verification failed ($failures missing file(s))" >&2
  exit 1
fi

echo "Release bundle OK"
