#!/bin/bash
# Complete a partial Dotplane install (e.g. after curl|bash exited at password prompt).
# Safe to re-run — reads secrets from existing /opt/dotplane/.env.
#
# Usage:
#   sudo DOTPLANE_ADMIN_PASSWORD='your-secure-password' bash /opt/dotplane/scripts/finish-install.sh

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

print_install_summary() {
  [[ "${SUMMARY_PRINTED}" == "1" ]] && return
  [[ -z "${URL_KEY:-}" ]] && return

  local ip="${SERVER_IP:-}"
  if [[ -z "$ip" ]]; then
    ip="$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
  fi

  local port="${PLATFORM_PORT:-}"
  local panel_url="http://${ip}:${port}/${URL_KEY}"
  local https_url="https://${ip}/${URL_KEY}"
  local pass_line
  if [[ "${GENERATED_ADMIN_PASS:-0}" == "1" ]]; then
    pass_line="${ADMIN_PASS}"
  elif [[ -n "${DOTPLANE_ADMIN_PASSWORD:-}" ]]; then
    pass_line="(from DOTPLANE_ADMIN_PASSWORD)"
  else
    pass_line="(the one you just set)"
  fi

  local access_file="${DOTPLANE_ROOT}/access.txt"
  cat > "${access_file}" << EOF
Dotplane access — save this file securely
Panel URL: ${panel_url}
HTTPS URL (Caddy): ${https_url}
Port: ${port}
URL key: ${URL_KEY}
Username: admin
Password: ${pass_line}
EOF
  chmod 600 "${access_file}"

  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║           Dotplane Installed Successfully            ║${NC}"
  echo -e "${GREEN}╠══════════════════════════════════════════════════════╣${NC}"
  echo -e "${GREEN}║${NC}  Panel URL  : ${panel_url}"
  echo -e "${GREEN}║${NC}  HTTPS URL   : ${https_url} (Caddy, port 443)"
  echo -e "${GREEN}║${NC}  Port        : ${port}"
  echo -e "${GREEN}║${NC}  URL key     : ${URL_KEY}"
  echo -e "${GREEN}║${NC}  Username   : admin"
  echo -e "${GREEN}║${NC}  Password   : ${pass_line}"
  echo -e "${GREEN}║${NC}  Access file: ${access_file}"
  echo -e "${GREEN}║${NC}"
  echo -e "${GREEN}║${NC}  Save the URL — it won't be shown again"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
  SUMMARY_PRINTED=1
}

trap print_install_summary EXIT

[[ $EUID -ne 0 ]] && fail "Run as root"

DOTPLANE_ROOT="${DOTPLANE_ROOT:-/opt/dotplane}"
ENV_FILE="${DOTPLANE_ROOT}/.env"
DATA_DIR="${DOTPLANE_ROOT}/data"
BACKUP_DIR="${DATA_DIR}/backups"
LOG_DIR="/var/log/dotplane"

[[ -f "$ENV_FILE" ]] || fail "Missing ${ENV_FILE} — run install.sh first"

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
PLATFORM_PORT="${PLATFORM_PORT:?PLATFORM_PORT missing in .env}"
URL_KEY="${PLATFORM_URL_KEY:?PLATFORM_URL_KEY missing in .env}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install-fnm.sh
source "${SCRIPT_DIR}/install-fnm.sh"
install_dotplane_node "${NODE_VERSION:-20}" >/dev/null 2>&1 || true
export PATH="$(dirname "$NODE_BIN"):/usr/local/bin:/usr/share/dotnet:/usr/bin:/bin"

CLI="${DOTPLANE_ROOT}/packages/platform/dist/server/cli.js"
[[ -f "$CLI" ]] || fail "Platform CLI not found at ${CLI}"

prompt_admin_password() {
  if [[ -n "${DOTPLANE_ADMIN_PASSWORD:-}" ]]; then
    ADMIN_PASS="$DOTPLANE_ADMIN_PASSWORD"
    ok "Using admin password from DOTPLANE_ADMIN_PASSWORD"
    return
  fi

  echo ""
  if [[ -t 0 ]]; then
    read -r -s -p "Set admin password (min 12 chars): " ADMIN_PASS
    echo ""
  elif [[ -r /dev/tty ]]; then
    read -r -s -p "Set admin password (min 12 chars): " ADMIN_PASS < /dev/tty
    echo "" > /dev/tty
  else
    ADMIN_PASS="$(openssl rand -base64 24)"
    GENERATED_ADMIN_PASS=1
    warn "No TTY — generated a random admin password (shown in summary below)"
  fi

  [[ ${#ADMIN_PASS} -lt 12 ]] && fail "Password too short (minimum 12 characters)"
}

GENERATED_ADMIN_PASS=0

mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chmod 700 "$DATA_DIR" "$BACKUP_DIR"

log "Running database migrations..."
cd "${DOTPLANE_ROOT}/packages/platform"
export DOTPLANE_ENV_PATH="$ENV_FILE"
export DB_PATH="${DB_PATH:-${DATA_DIR}/dotplane.db}"
"$NODE_BIN" dist/server/db/migrate.js \
  || "$NODE_BIN" --input-type=module -e "import('./dist/server/db/migrate.js').then((m) => { m.runMigrations(); console.log('Migrations complete') })"
ok "Database migrations complete"

prompt_admin_password
if ! DOTPLANE_ENV_PATH="$ENV_FILE" DB_PATH="${DB_PATH}" \
  "$NODE_BIN" "$CLI" set-password admin "$ADMIN_PASS"; then
  warn "Failed to set admin password — run: node ${CLI} set-password admin '...'"
else
  ok "Admin credentials configured"
fi

print_install_summary

log "Installing systemd units..."
PLATFORM_ENTRY="${DOTPLANE_ROOT}/packages/platform/dist/server/index.js"
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

cp "${DOTPLANE_ROOT}/systemd/dotnet-app@.service" /etc/systemd/system/
ok "systemd units installed"

SERVER_IP="$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
cat > /etc/caddy/Caddyfile << EOF
{
    admin localhost:2019
    persist_config on
}

:443 {
    reverse_proxy 127.0.0.1:${PLATFORM_PORT}
}
EOF
ok "Caddy configured for port ${PLATFORM_PORT}"

log "Installing daily backup cron..."
cat > /etc/cron.d/dotplane-backup << EOF
# Dotplane SQLite backup — daily at 02:00 UTC
0 2 * * * root ${NODE_BIN} -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const src = '${DATA_DIR}/dotplane.db';
const dir = '${BACKUP_DIR}';
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(dir, 'dotplane-' + ts + '.db');
fs.mkdirSync(dir, { recursive: true });
Database(src).backup(dest);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.db')).sort().reverse();
files.slice(30).forEach(f => fs.unlinkSync(path.join(dir, f)));
" >> ${LOG_DIR}/backup.log 2>&1
EOF
chmod 644 /etc/cron.d/dotplane-backup

systemctl daemon-reload
systemctl enable dotplane 2>/dev/null || warn "Failed to enable dotplane service"
systemctl enable caddy 2>/dev/null || warn "Failed to enable caddy service"
systemctl restart dotplane 2>/dev/null || warn "dotplane failed to start — check: journalctl -u dotplane -n 50"
systemctl restart caddy 2>/dev/null || warn "caddy failed to start — check: journalctl -u caddy -n 50"
ok "Services started"

DOTPLANE_ENV_PATH="$ENV_FILE" DB_PATH="${DB_PATH}" \
  "$NODE_BIN" "$CLI" install-local-agent 2>/dev/null || warn "install-local-agent skipped"

print_install_summary
