#!/bin/bash
# Install/start Dotplane systemd + Caddy when a prior install stopped early.
# Does not change credentials or re-run migrations.
#
# Usage:
#   sudo bash /opt/dotplane/scripts/setup-services.sh
#   curl -fsSL .../setup-services.sh | sudo bash

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

[[ $EUID -ne 0 ]] && fail "Run as root"

DOTPLANE_ROOT="${DOTPLANE_ROOT:-/opt/dotplane}"
ENV_FILE="${DOTPLANE_ROOT}/.env"
DATA_DIR="${DOTPLANE_ROOT}/data"
BACKUP_DIR="${DATA_DIR}/backups"
LOG_DIR="/var/log/dotplane"

if [[ ! -f "$ENV_FILE" ]]; then
  echo ""
  warn "Dotplane is not fully installed — ${ENV_FILE} is missing."
  if [[ -d "$DOTPLANE_ROOT" ]]; then
    echo "  Found ${DOTPLANE_ROOT} but install stopped before secrets were written."
  else
    echo "  ${DOTPLANE_ROOT} does not exist yet."
  fi
  echo ""
  echo "  setup-services.sh only completes systemd/Caddy after a successful install."
  echo "  Run the full bootstrap installer instead:"
  echo ""
  echo "    curl -fsSL https://raw.githubusercontent.com/OrnaVerse/dotplane/main/scripts/bootstrap-install.sh | \\"
  echo "      sudo DOTPLANE_GITHUB_REPO=OrnaVerse/dotplane DOTPLANE_VERSION=v0.1.17 bash"
  echo ""
  exit 1
fi

[[ -f "${DOTPLANE_ROOT}/packages/platform/dist/server/index.js" ]] || {
  echo ""
  echo -e "${RED}[✗]${NC} Platform build artifacts not found at:"
  echo "      ${DOTPLANE_ROOT}/packages/platform/dist/server/index.js"
  echo ""
  echo "  This means the install completed dependency/config steps but the"
  echo "  source build (or release rsync) did not finish."
  echo ""
  echo "  Options:"
  echo "    A) Re-run the full bootstrap installer (recommended):"
  echo "         curl -fsSL https://raw.githubusercontent.com/OrnaVerse/dotplane/main/scripts/bootstrap-install.sh | \\"
  echo "           sudo DOTPLANE_GITHUB_REPO=OrnaVerse/dotplane bash"
  echo "    B) If running from a git checkout, build manually then retry:"
  echo "         cd ${DOTPLANE_ROOT} && pnpm install && pnpm --filter @dotplane/platform build && pnpm --filter @dotplane/agent build"
  echo "         sudo bash ${DOTPLANE_ROOT}/scripts/setup-services.sh"
  echo ""
  exit 1
}

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
PLATFORM_PORT="${PLATFORM_PORT:?PLATFORM_PORT missing in .env}"
URL_KEY="${PLATFORM_URL_KEY:?PLATFORM_URL_KEY missing in .env}"

FNM_SCRIPT="${DOTPLANE_ROOT}/scripts/install-fnm.sh"
if [[ ! -f "$FNM_SCRIPT" ]]; then
  FNM_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-fnm.sh"
fi
[[ -f "$FNM_SCRIPT" ]] || fail "install-fnm.sh not found — re-run the bootstrap installer"
# shellcheck source=install-fnm.sh
source "$FNM_SCRIPT"
install_dotplane_node "${NODE_VERSION:-20}" >/dev/null 2>&1 || true
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/share/dotnet:/usr/bin:/bin"

PLATFORM_ENTRY="${DOTPLANE_ROOT}/packages/platform/dist/server/index.js"

log "Installing dotplane.service..."
cat > /etc/systemd/system/dotplane.service << EOF
[Unit]
Description=Dotplane Platform
After=network.target

[Service]
Type=simple
WorkingDirectory=${DOTPLANE_ROOT}/packages/platform
ExecStart=${NODE_BIN} ${PLATFORM_ENTRY}
Restart=always
RestartSec=5
User=root
EnvironmentFile=${DOTPLANE_ROOT}/.env
Environment=PATH=/usr/local/bin:/usr/share/dotnet:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
EOF

if [[ -f "${DOTPLANE_ROOT}/systemd/dotnet-app@.service" ]]; then
  cp "${DOTPLANE_ROOT}/systemd/dotnet-app@.service" /etc/systemd/system/
fi
ok "systemd unit written"

log "Configuring Caddy..."
mkdir -p /etc/caddy /var/lib/caddy
if ! id caddy >/dev/null 2>&1; then
  useradd -r -s /bin/false -d /var/lib/caddy caddy 2>/dev/null || \
    usermod -d /var/lib/caddy caddy 2>/dev/null || true
fi
chown -R caddy:caddy /var/lib/caddy 2>/dev/null || true

cat > /etc/caddy/Caddyfile << EOF
{
    admin localhost:2019
}

:80 {
    reverse_proxy 127.0.0.1:${PLATFORM_PORT}
}

:443 {
    tls internal
    reverse_proxy 127.0.0.1:${PLATFORM_PORT}
}
EOF
ok "Caddyfile written for platform port ${PLATFORM_PORT}"

if [[ ! -f /etc/cron.d/dotplane-backup ]]; then
  log "Installing backup cron..."
  cat > /etc/cron.d/dotplane-backup << EOF
# Dotplane SQLite backup — daily at 02:00 UTC
0 2 * * * root ${NODE_BIN} -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const src = '${DATA_DIR}/dotplane.db';
const dir = '${BACKUP_DIR}';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
fs.mkdirSync(dir, { recursive: true });
Database(src).backup(path.join(dir, 'dotplane-' + ts + '.db'));
" >> ${LOG_DIR}/backup.log 2>&1
EOF
  chmod 644 /etc/cron.d/dotplane-backup
fi

cat > /etc/systemd/system/caddy.service << 'EOF'
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
ok "caddy.service unit written"

log "Starting services..."
systemctl daemon-reload
systemctl enable dotplane 2>/dev/null || warn "Failed to enable dotplane"
systemctl enable caddy 2>/dev/null || warn "Failed to enable caddy"
systemctl restart dotplane 2>/dev/null || warn "dotplane failed to start — journalctl -u dotplane -n 50"
systemctl restart caddy 2>/dev/null || warn "caddy failed to start — journalctl -u caddy -n 50"

sleep 2
if curl -fsS --max-time 3 "http://127.0.0.1:${PLATFORM_PORT}/${URL_KEY}/api/health" >/dev/null; then
  ok "Platform is responding on port ${PLATFORM_PORT}"
else
  warn "Platform health check failed — run: journalctl -u dotplane -n 100 --no-pager"
fi

if curl -fsS --max-time 3 "http://127.0.0.1:80/${URL_KEY}/api/health" >/dev/null; then
  ok "Caddy HTTP proxy is working"
else
  warn "Caddy proxy check failed — run: journalctl -u caddy -n 50 --no-pager"
fi

if [[ "${DOTPLANE_SETUP_QUIET:-0}" != "1" ]]; then
  echo ""
  if [[ -f "${DOTPLANE_ROOT}/access.txt" ]]; then
    ok "Credentials:"
    cat "${DOTPLANE_ROOT}/access.txt"
  else
    IP="$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
    echo "Panel URL: http://${IP}:${PLATFORM_PORT}/${URL_KEY}"
    echo "URL key: ${URL_KEY}"
    echo "Username: ${PLATFORM_ADMIN_USERNAME:-see .env}"
  fi
fi
