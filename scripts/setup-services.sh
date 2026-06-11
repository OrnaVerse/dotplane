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

[[ -f "$ENV_FILE" ]] || fail "Missing ${ENV_FILE} — run install.sh first"
[[ -f "${DOTPLANE_ROOT}/packages/platform/dist/server/index.js" ]] || \
  fail "Platform not installed at ${DOTPLANE_ROOT}"

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
PLATFORM_PORT="${PLATFORM_PORT:?PLATFORM_PORT missing in .env}"
URL_KEY="${PLATFORM_URL_KEY:?PLATFORM_URL_KEY missing in .env}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install-fnm.sh
source "${SCRIPT_DIR}/install-fnm.sh"
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
  useradd -r -s /bin/false caddy 2>/dev/null || true
fi
chown -R caddy:caddy /var/lib/caddy 2>/dev/null || true

cat > /etc/caddy/Caddyfile << EOF
{
    admin localhost:2019
    persist_config on
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

log "Starting services..."
systemctl daemon-reload
systemctl enable dotplane
systemctl enable caddy
systemctl restart dotplane
systemctl restart caddy

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
