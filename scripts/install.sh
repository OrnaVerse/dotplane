#!/bin/bash
# Dotplane — full platform + agent install (single server)
#
# Installs: fnm/Node 20, prebuilt Caddy, .NET 8 SDK, SQLite-backed Platform,
# UFW, fail2ban, mTLS certs, systemd units, daily backup cron.
#
# Run as root on Ubuntu 22.04+ / Debian 12+.
#
# Install methods:
#   1. bootstrap-install.sh  — curl one-liner from GitHub Release (recommended)
#   2. git clone + install.sh — builds from source on server
#   3. install.sh --from-release /path — pre-extracted release tarball
#   4. DOTPLANE_RELEASE_URL=... install.sh — download tarball URL

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${BLUE}[dotplane]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

SUMMARY_PRINTED=0
INSTALL_COMPLETE=0
ACCESS_FILE=""

print_install_summary() {
  [[ "${SUMMARY_PRINTED}" == "1" ]] && return
  # Skip entirely if secrets were never generated (very early failure)
  [[ -z "${URL_KEY:-}" ]] && return
  [[ -z "${PLATFORM_PORT:-}" ]] && return

  if [[ "${INSTALL_COMPLETE}" != "1" ]]; then
    echo ""
    echo -e "${RED}[✗] Install did not complete — check the errors above.${NC}"
    echo "    To finish wiring up services after fixing any issue, run:"
    echo "      sudo bash /opt/dotplane/scripts/setup-services.sh"
    SUMMARY_PRINTED=1
    return
  fi

  local ip="${SERVER_IP:-}"
  if [[ -z "$ip" ]]; then
    ip="$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  fi

  local port="${PLATFORM_PORT:-}"
  local panel_url="http://${ip}:${port}/${URL_KEY}"
  local https_url="https://${ip}/${URL_KEY}"
  ACCESS_FILE="${DOTPLANE_ROOT}/access.txt"
  if mkdir -p "${DOTPLANE_ROOT}" 2>/dev/null; then
    cat > "${ACCESS_FILE}" << EOF
Dotplane access — save this file securely
Panel URL: ${panel_url}
HTTPS URL (Caddy): ${https_url}
Port: ${port}
URL key: ${URL_KEY}
Username: ${ADMIN_USER:-unknown}
Password: ${ADMIN_PASS:-unknown}
EOF
    chmod 600 "${ACCESS_FILE}"
  else
    ACCESS_FILE="(unavailable — ${DOTPLANE_ROOT} not yet created)"
  fi

  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║           Dotplane Installed Successfully            ║${NC}"
  echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
  echo -e "${GREEN}║${NC}  Panel URL  : ${panel_url}"
  echo -e "${GREEN}║${NC}  HTTPS URL   : ${https_url} (Caddy, port 443)"
  echo -e "${GREEN}║${NC}  Port        : ${port}"
  echo -e "${GREEN}║${NC}  URL key     : ${URL_KEY}"
  echo -e "${GREEN}║${NC}  Username   : ${ADMIN_USER}"
  echo -e "${GREEN}║${NC}  Password   : ${ADMIN_PASS}"
  echo -e "${GREEN}║${NC}  Database   : ${DATA_DIR}/dotplane.db (SQLite)"
  echo -e "${GREEN}║${NC}  Backups    : ${BACKUP_DIR}"
  echo -e "${GREEN}║${NC}  Access file: ${ACCESS_FILE}"
  echo -e "${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}  Cloud VM? Open TCP ${port} in your provider firewall"
  echo -e "${GREEN}║${NC}  Save the URL — it won't be shown again"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
  SUMMARY_PRINTED=1
}

trap print_install_summary EXIT

[[ $EUID -ne 0 ]] && fail "Run as root"
[[ "$(uname -s)" != "Linux" ]] && fail "Linux only"

DOTPLANE_ROOT="${DOTPLANE_ROOT:-/opt/dotplane}"
DATA_DIR="${DOTPLANE_ROOT}/data"
BACKUP_DIR="${DATA_DIR}/backups"
ARTIFACTS_DIR="/var/dotplane/artifacts"
INSTANCES_DIR="/var/dotplane/instances"
LOG_DIR="/var/log/dotplane"
NODE_VERSION="${NODE_VERSION:-20}"
FROM_RELEASE=""
DOTPLANE_SKIP_BUILD="${DOTPLANE_SKIP_BUILD:-0}"

# bootstrap-install.sh passes: install.sh --from-release /tmp/.../dotplane-v1.0.0-linux-amd64
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-release) FROM_RELEASE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# ── 1. System dependencies ───────────────────────────────────────────────────
log "Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl wget unzip rsync openssl ca-certificates \
  ufw fail2ban sqlite3 \
  systemd jq

# ── 2. Node.js via fnm ───────────────────────────────────────────────────────
log "Installing Node.js ${NODE_VERSION} via fnm..."
# shellcheck source=install-fnm.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-fnm.sh"
install_dotplane_node "$NODE_VERSION"
ok "Node $($NODE_BIN --version) via fnm"
NPM_BIN="$(dirname "$NODE_BIN")/npm"
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:${PATH}"

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi
  log "Enabling pnpm for workspace install..."
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@9 --activate
  else
    "$NPM_BIN" install -g pnpm@9
  fi
  export PATH="$(dirname "$NODE_BIN"):$PATH"
}

install_release_dependencies() {
  ensure_pnpm
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod
    return
  fi
  warn "pnpm unavailable — installing per-package with npm"
  for pkg in platform agent; do
    "$NODE_BIN" -e "
      const fs = require('fs');
      const p = process.argv[1];
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j.dependencies?.['@dotplane/shared']?.startsWith('workspace:')) {
        j.dependencies['@dotplane/shared'] = 'file:../shared';
        fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
      }
    " "${DOTPLANE_ROOT}/packages/${pkg}/package.json"
  done
  (cd "${DOTPLANE_ROOT}/packages/shared" && "$NPM_BIN" install --omit=dev)
  (cd "${DOTPLANE_ROOT}/packages/platform" && "$NPM_BIN" install --omit=dev)
  (cd "${DOTPLANE_ROOT}/packages/agent" && "$NPM_BIN" install --omit=dev)
}

# ── 3. Caddy (prebuilt binary) ─────────────────────────────────────────────────
# NOTE: For custom Caddy modules (e.g. cloudflare DNS), build with xcaddy instead:
#   go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
#   xcaddy build --with github.com/caddy-dns/cloudflare
# The prebuilt binary from caddyserver.com is sufficient for standard reverse proxy use.
log "Installing Caddy (prebuilt)..."
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  CADDY_ARCH="amd64" ;;
  aarch64) CADDY_ARCH="arm64" ;;
  *)       fail "Unsupported architecture: $ARCH" ;;
esac
if ! curl -fsSL --max-time 60 "https://caddyserver.com/api/download?os=linux&arch=${CADDY_ARCH}" \
  -o /usr/local/bin/caddy; then
  warn "Caddy download failed — retrying..."
  curl -fsSL --max-time 120 "https://caddyserver.com/api/download?os=linux&arch=${CADDY_ARCH}" \
    -o /usr/local/bin/caddy || fail "Caddy download failed after retry"
fi
chmod +x /usr/local/bin/caddy

cat > /etc/systemd/system/caddy.service << 'EOF'
[Unit]
Description=Caddy
After=network.target

[Service]
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --resume
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile
Restart=on-failure
User=caddy
Group=caddy
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF

useradd -r -s /bin/false caddy 2>/dev/null || true
mkdir -p /etc/caddy /var/lib/caddy
chown -R caddy:caddy /var/lib/caddy
ok "Caddy $(caddy version | head -1)"

# ── 4. .NET SDK ────────────────────────────────────────────────────────────────
log "Installing .NET 8 SDK..."
if ! curl -fsSL --max-time 120 https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh; then
  warn ".NET install script download failed — skipping .NET install"
else
  chmod +x /tmp/dotnet-install.sh
  /tmp/dotnet-install.sh --channel 8.0 --install-dir /usr/share/dotnet --no-path \
    || warn ".NET install failed — .NET apps will not run until manually installed"
  ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet 2>/dev/null || true
  ok ".NET $(/usr/share/dotnet/dotnet --version 2>/dev/null || echo '(version check failed)')"
fi

# ── 5. Firewall (UFW) ────────────────────────────────────────────────────────
log "Configuring UFW..."
ufw --force reset >/dev/null 2>&1 || true
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ok "UFW enabled (22, 80, 443)"

# ── 6. fail2ban ──────────────────────────────────────────────────────────────
log "Configuring fail2ban..."
mkdir -p /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/dotplane.conf << 'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port    = ssh
filter  = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime  = 1h
EOF
systemctl enable fail2ban 2>/dev/null || true
systemctl restart fail2ban 2>/dev/null || warn "fail2ban failed to restart — continuing"
ok "fail2ban configured for SSH"

# ── 7. Generate secrets + admin credentials ────────────────────────────────────
log "Generating secrets..."
PLATFORM_PORT=$(shuf -i 49152-65535 -n 1)
ufw allow "${PLATFORM_PORT}/tcp" >/dev/null 2>&1 || true
URL_KEY="ov_$(openssl rand -hex 3)"
JWT_SECRET=$(openssl rand -hex 64)
REFRESH_SECRET=$(openssl rand -hex 64)
CSRF_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

if [[ -n "${DOTPLANE_ADMIN_USERNAME:-}" ]]; then
  ADMIN_USER="$DOTPLANE_ADMIN_USERNAME"
else
  ADMIN_USER="$(generate_dotplane_admin_username)"
fi

if [[ -n "${DOTPLANE_ADMIN_PASSWORD:-}" ]]; then
  ADMIN_PASS="$DOTPLANE_ADMIN_PASSWORD"
else
  ADMIN_PASS="$(generate_dotplane_admin_password)"
fi

# ── 8. Directories + write .env FIRST (before rsync/deps/certs) ────────────────
# .env must exist before any step that can fail, so that finish-install.sh and
# setup-services.sh can resume from a partial install without a full re-run.
log "Creating directories..."
mkdir -p "$DOTPLANE_ROOT" "$DATA_DIR" "$BACKUP_DIR" "$ARTIFACTS_DIR" "$INSTANCES_DIR" "$LOG_DIR"
mkdir -p "${DOTPLANE_ROOT}/certs" "${DOTPLANE_ROOT}/scripts"
chmod 700 "$DOTPLANE_ROOT" "${DOTPLANE_ROOT}/certs" "$DATA_DIR" "$BACKUP_DIR"

log "Writing .env..."
cat > "${DOTPLANE_ROOT}/.env" << EOF
NODE_ENV=production
PLATFORM_PORT=${PLATFORM_PORT}
PLATFORM_HOST=0.0.0.0
PLATFORM_URL_KEY=${URL_KEY}
PLATFORM_ADMIN_USERNAME=${ADMIN_USER}

JWT_SECRET=${JWT_SECRET}
REFRESH_SECRET=${REFRESH_SECRET}
CSRF_SECRET=${CSRF_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

DB_PATH=${DATA_DIR}/dotplane.db
BACKUP_DIR=${BACKUP_DIR}
ARTIFACTS_PATH=${ARTIFACTS_DIR}
ERROR_LOG_PATH=${LOG_DIR}/error.log
FNM_DIR=/usr/local/share/fnm

MTLS_CA_CERT_PATH=${DOTPLANE_ROOT}/certs/ca.crt
MTLS_CLIENT_CERT_PATH=${DOTPLANE_ROOT}/certs/platform.crt
MTLS_CLIENT_KEY_PATH=${DOTPLANE_ROOT}/certs/platform.key
EOF
chmod 600 "${DOTPLANE_ROOT}/.env"
ok ".env written"

# ── 9. Deploy application files ────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -n "$FROM_RELEASE" && -d "$FROM_RELEASE" ]]; then
  log "Installing from release bundle..."
  rsync -a --delete --exclude='.env' --exclude='data' --exclude='certs' \
    "$FROM_RELEASE/" "$DOTPLANE_ROOT/"
  DOTPLANE_SKIP_BUILD=1
elif [[ -n "${DOTPLANE_RELEASE_URL:-}" ]]; then
  log "Downloading release from ${DOTPLANE_RELEASE_URL}..."
  TMP_TAR="$(mktemp)"
  curl -fsSL "$DOTPLANE_RELEASE_URL" -o "$TMP_TAR"
  mkdir -p "$DOTPLANE_ROOT"
  tar -xzf "$TMP_TAR" -C "$(dirname "$DOTPLANE_ROOT")"
  rm -f "$TMP_TAR"
  BUNDLE="$(find "$(dirname "$DOTPLANE_ROOT")" -maxdepth 1 -type d -name 'dotplane-*-linux-*' | sort -r | head -1)"
  if [[ -n "$BUNDLE" && "$BUNDLE" != "$DOTPLANE_ROOT" ]]; then
    rsync -a --exclude='.env' --exclude='data' --exclude='certs' "$BUNDLE/" "$DOTPLANE_ROOT/"
    rm -rf "$BUNDLE"
  fi
  DOTPLANE_SKIP_BUILD=1
elif [[ -f "$REPO_ROOT/package.json" ]]; then
  log "Copying Dotplane source from checkout to ${DOTPLANE_ROOT}..."
  rsync -a --exclude node_modules --exclude dist --exclude .git \
    --exclude='.env' --exclude='data' --exclude='certs' \
    "$REPO_ROOT/" "$DOTPLANE_ROOT/"
else
  fail "No source found. Use bootstrap-install.sh, set DOTPLANE_RELEASE_URL, or run from a git checkout."
fi

# Ensure runtime dirs survive any rsync
mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chmod 700 "$DATA_DIR" "$BACKUP_DIR"

mkdir -p "${DOTPLANE_ROOT}/scripts"
cp "${DOTPLANE_ROOT}/scripts/generate-certs.sh" "${DOTPLANE_ROOT}/scripts/" 2>/dev/null \
  || cp "$SCRIPT_DIR/generate-certs.sh" "${DOTPLANE_ROOT}/scripts/"
chmod +x "${DOTPLANE_ROOT}/scripts/generate-certs.sh"

# ── 10. Generate mTLS certs ────────────────────────────────────────────────────
log "Generating mTLS certificates..."
if ! CERT_DIR="${DOTPLANE_ROOT}/certs" bash "${DOTPLANE_ROOT}/scripts/generate-certs.sh"; then
  warn "mTLS cert generation failed — agent connections will not work until certs are created"
else
  chmod 700 "${DOTPLANE_ROOT}/certs"
  chmod 600 "${DOTPLANE_ROOT}/certs"/*.key 2>/dev/null || true
  ok "mTLS certs generated"
fi

# ── 11. Install Platform dependencies & build ──────────────────────────────────
cd "$DOTPLANE_ROOT"
PLATFORM_ENTRY="${DOTPLANE_ROOT}/packages/platform/dist/server/index.js"
AGENT_ENTRY="${DOTPLANE_ROOT}/packages/agent/dist/index.js"

if [[ "$DOTPLANE_SKIP_BUILD" == "1" && -f "$PLATFORM_ENTRY" && -f "$AGENT_ENTRY" ]]; then
  log "Using pre-built release artifacts — installing production dependencies..."
  install_release_dependencies
  ok "Production dependencies installed"
else
  log "Building Dotplane Platform from source..."
  ensure_pnpm
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    pnpm --filter @dotplane/platform build
    pnpm --filter @dotplane/agent build
  else
    "$NPM_BIN" install
    "$NPM_BIN" run build --workspace=@dotplane/platform 2>/dev/null \
      || (cd packages/platform && "$NPM_BIN" install && "$NPM_BIN" run build)
    "$NPM_BIN" run build --workspace=@dotplane/agent 2>/dev/null \
      || (cd packages/agent && "$NPM_BIN" install && "$NPM_BIN" run build)
  fi
fi

# ── 12. Run database migrations ────────────────────────────────────────────────
log "Running database migrations..."
cd "$DOTPLANE_ROOT/packages/platform"
export DOTPLANE_ENV_PATH="${DOTPLANE_ROOT}/.env"
export DB_PATH="${DATA_DIR}/dotplane.db"
if "$NODE_BIN" dist/server/db/migrate.js 2>/dev/null \
  || "$NODE_BIN" --import tsx src/server/db/migrate.ts 2>/dev/null \
  || "$NODE_BIN" --input-type=module -e "import('./dist/server/db/migrate.js').then((m) => { m.runMigrations(); console.log('Migrations complete') })"; then
  ok "Database migrations complete"
else
  warn "Migration step failed — run manually from ${DOTPLANE_ROOT}/packages/platform"
fi
ok "SQLite database ready at ${DATA_DIR}/dotplane.db"

# ── 13. Start systemd + Caddy (before credentials — survives curl|bash SIGHUP) ─
log "Installing and starting services..."
DOTPLANE_SETUP_QUIET=1 bash "${DOTPLANE_ROOT}/scripts/setup-services.sh" \
  || warn "setup-services failed — run: bash ${DOTPLANE_ROOT}/scripts/setup-services.sh"

# ── 14. Set admin credentials ──────────────────────────────────────────────────
CLI="${DOTPLANE_ROOT}/packages/platform/dist/server/cli.js"
if [[ -f "$CLI" ]]; then
  if ! DOTPLANE_ENV_PATH="${DOTPLANE_ROOT}/.env" DB_PATH="${DATA_DIR}/dotplane.db" \
    "$NODE_BIN" "$CLI" set-password "$ADMIN_USER" "$ADMIN_PASS"; then
    warn "Failed to set admin credentials — run: node ${CLI} set-password '${ADMIN_USER}' '...'"
  else
    ok "Admin credentials configured"
  fi
else
  warn "Platform CLI not found — set admin credentials via UI on first login"
fi

# ── 15. Install local agent ────────────────────────────────────────────────────
log "Installing Agent on this server..."
if [[ -f "$CLI" ]]; then
  DOTPLANE_ENV_PATH="${DOTPLANE_ROOT}/.env" DB_PATH="${DATA_DIR}/dotplane.db" \
    "$NODE_BIN" "$CLI" install-local-agent 2>/dev/null || warn "install-local-agent skipped — register server via UI"
else
  warn "Register this server via the Platform UI after first login"
fi

# ── 16. Done ───────────────────────────────────────────────────────────────────
INSTALL_COMPLETE=1
print_install_summary
