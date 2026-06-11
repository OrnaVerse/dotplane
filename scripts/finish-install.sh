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
  local access_file="${DOTPLANE_ROOT}/access.txt"
  mkdir -p "${DOTPLANE_ROOT}" 2>/dev/null || true
  cat > "${access_file}" << EOF
Dotplane access — save this file securely
Panel URL: ${panel_url}
HTTPS URL (Caddy): ${https_url}
Port: ${port}
URL key: ${URL_KEY}
Username: ${ADMIN_USER:-unknown}
Password: ${ADMIN_PASS:-unknown}
EOF
  chmod 600 "${access_file}" 2>/dev/null || true

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

mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chmod 700 "$DATA_DIR" "$BACKUP_DIR"

log "Running database migrations..."
cd "${DOTPLANE_ROOT}/packages/platform"
export DOTPLANE_ENV_PATH="$ENV_FILE"
export DB_PATH="${DB_PATH:-${DATA_DIR}/dotplane.db}"
"$NODE_BIN" dist/server/db/migrate.js \
  || "$NODE_BIN" --input-type=module -e "import('./dist/server/db/migrate.js').then((m) => { m.runMigrations(); console.log('Migrations complete') })"
ok "Database migrations complete"

if [[ -n "${PLATFORM_ADMIN_USERNAME:-}" ]]; then
  ADMIN_USER="$PLATFORM_ADMIN_USERNAME"
elif [[ -n "${DOTPLANE_ADMIN_USERNAME:-}" ]]; then
  ADMIN_USER="$DOTPLANE_ADMIN_USERNAME"
else
  ADMIN_USER="$(generate_dotplane_admin_username)"
  echo "PLATFORM_ADMIN_USERNAME=${ADMIN_USER}" >> "$ENV_FILE"
  ok "Generated random admin username (shown in summary below)"
fi

if [[ -n "${DOTPLANE_ADMIN_PASSWORD:-}" ]]; then
  ADMIN_PASS="$DOTPLANE_ADMIN_PASSWORD"
  ok "Using admin password from DOTPLANE_ADMIN_PASSWORD"
else
  ADMIN_PASS="$(generate_dotplane_admin_password)"
  ok "Generated random 12-character admin password (shown in summary below)"
fi

if ! DOTPLANE_ENV_PATH="$ENV_FILE" DB_PATH="${DB_PATH}" \
  "$NODE_BIN" "$CLI" set-password "$ADMIN_USER" "$ADMIN_PASS"; then
  warn "Failed to set admin credentials — run: node ${CLI} set-password '${ADMIN_USER}' '...'"
else
  ok "Admin credentials configured"
fi

DOTPLANE_SETUP_QUIET=1 bash "${DOTPLANE_ROOT}/scripts/setup-services.sh" \
  || warn "setup-services failed — run: bash ${DOTPLANE_ROOT}/scripts/setup-services.sh"

DOTPLANE_ENV_PATH="$ENV_FILE" DB_PATH="${DB_PATH}" \
  "$NODE_BIN" "$CLI" install-local-agent 2>/dev/null || warn "install-local-agent skipped"

print_install_summary
