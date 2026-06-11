#!/bin/bash
# Build a production release tarball for GitHub Releases.
# Run from repo root after: pnpm install && pnpm -r build
#
# Output: dist-releases/dotplane-{version}-linux-{arch}.tar.gz

set -euo pipefail

VERSION="${1:-$(node -p "require('./package.json').version" 2>/dev/null || echo '0.0.0')}"
ARCH="${ARCH:-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')}"
OUT_DIR="dist-releases"
STAGING="${OUT_DIR}/dotplane-${VERSION}-linux-${ARCH}"
TARBALL="${OUT_DIR}/dotplane-${VERSION}-linux-${ARCH}.tar.gz"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[[ -f packages/platform/dist/server/index.js ]] || {
  echo "Run 'pnpm -r build' first" >&2
  exit 1
}

echo "Packaging dotplane ${VERSION} (${ARCH})..."

rm -rf "$STAGING"
mkdir -p "$STAGING"

# Root workspace files (production install on target server)
cp package.json pnpm-workspace.yaml pnpm-lock.yaml "$STAGING/"

# Platform — dist + runtime files only (no TypeScript source)
mkdir -p "$STAGING/packages/platform"
cp packages/platform/package.json "$STAGING/packages/platform/"
cp -r packages/platform/dist "$STAGING/packages/platform/"
cp -r packages/platform/drizzle "$STAGING/packages/platform/"
cp packages/platform/drizzle.config.ts "$STAGING/packages/platform/" 2>/dev/null || true

# Agent — dist only
mkdir -p "$STAGING/packages/agent"
cp packages/agent/package.json "$STAGING/packages/agent/"
cp -r packages/agent/dist "$STAGING/packages/agent/"

# Install scripts & systemd
mkdir -p "$STAGING/scripts" "$STAGING/systemd"
cp scripts/install.sh scripts/install-agent.sh scripts/generate-certs.sh \
   scripts/bootstrap-install.sh scripts/dotplane-agent.sudoers "$STAGING/scripts/"
chmod +x "$STAGING/scripts/"*.sh
cp systemd/dotnet-app@.service "$STAGING/systemd/"

# Version marker
echo "$VERSION" > "$STAGING/VERSION"
echo "linux-${ARCH}" >> "$STAGING/VERSION"

mkdir -p "$OUT_DIR"
tar -czf "$TARBALL" -C "$OUT_DIR" "dotplane-${VERSION}-linux-${ARCH}"

echo "Created ${TARBALL} ($(du -h "$TARBALL" | cut -f1))"
