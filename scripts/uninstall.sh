#!/bin/bash
# Remove Dotplane Platform (and optional system dependencies).
#
# Usage:
#   sudo bash scripts/uninstall.sh              # platform only — keeps Caddy, Node, .NET, UFW, fail2ban
#   sudo bash scripts/uninstall.sh --remove-caddy
#   sudo bash scripts/uninstall.sh --remove-system-deps   # also removes fnm/Node and .NET SDK
#   sudo bash scripts/uninstall.sh --purge-data           # delete database, backups, artifacts, instances

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

REMOVE_CADDY=0
REMOVE_SYSTEM_DEPS=0
PURGE_DATA=0

for arg in "$@"; do
  case "$arg" in
    --remove-caddy)       REMOVE_CADDY=1 ;;
    --remove-system-deps) REMOVE_SYSTEM_DEPS=1 ;;
    --purge-data)         PURGE_DATA=1 ;;
    -h|--help)
      sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "Unknown option: $arg (try --help)" ;;
  esac
done

DOTPLANE_ROOT="${DOTPLANE_ROOT:-/opt/dotplane}"
AGENT_ROOT="${AGENT_ROOT:-/opt/dotplane-agent}"
DATA_DIR="${DOTPLANE_ROOT}/data"
ARTIFACTS_DIR="/var/dotplane/artifacts"
INSTANCES_DIR="/var/dotplane/instances"
LOG_DIR="/var/log/dotplane"

stop_service() {
  local unit="$1"
  if systemctl list-unit-files "$unit" >/dev/null 2>&1; then
    systemctl stop "$unit" 2>/dev/null || true
    systemctl disable "$unit" 2>/dev/null || true
  fi
}

log "Stopping Dotplane services..."
stop_service dotplane.service
stop_service dotplane-agent.service

for unit in /etc/systemd/system/dotnet-app@*.service; do
  [[ -e "$unit" ]] || continue
  name="$(basename "$unit")"
  systemctl stop "$name" 2>/dev/null || true
  systemctl disable "$name" 2>/dev/null || true
done

log "Removing systemd units..."
rm -f /etc/systemd/system/dotplane.service
rm -f /etc/systemd/system/dotplane-agent.service
rm -f /etc/systemd/system/dotnet-app@.service
systemctl daemon-reload

log "Removing scheduled jobs and Dotplane configs..."
rm -f /etc/cron.d/dotplane-backup
rm -f /etc/fail2ban/jail.d/dotplane.conf
systemctl restart fail2ban 2>/dev/null || true

log "Removing install directories..."
rm -rf "$DOTPLANE_ROOT" "$AGENT_ROOT"

if [[ "$PURGE_DATA" == "1" ]]; then
  log "Purging artifacts, instances, and logs..."
  rm -rf "$ARTIFACTS_DIR" "$INSTANCES_DIR" "$LOG_DIR" /var/dotplane
  ok "All Dotplane data removed"
else
  warn "Artifacts/instances kept under /var/dotplane — pass --purge-data to delete"
fi

if [[ "$REMOVE_CADDY" == "1" ]]; then
  log "Removing Caddy..."
  stop_service caddy.service
  rm -f /etc/systemd/system/caddy.service
  rm -f /usr/local/bin/caddy
  rm -rf /etc/caddy /var/lib/caddy
  userdel caddy 2>/dev/null || true
  systemctl daemon-reload
  ok "Caddy removed"
else
  warn "Caddy kept — pass --remove-caddy if this host only served Dotplane"
fi

if [[ "$REMOVE_SYSTEM_DEPS" == "1" ]]; then
  log "Removing fnm/Node and .NET SDK..."
  rm -f /usr/local/bin/fnm /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm
  rm -rf /usr/local/share/fnm
  rm -rf /usr/share/dotnet
  rm -f /usr/local/bin/dotnet
  ok "fnm/Node and .NET SDK removed"
else
  warn "Node (.NET/fnm) and .NET SDK kept — pass --remove-system-deps to remove"
fi

ok "Dotplane uninstalled"
echo ""
echo "UFW and fail2ban were not changed. Review firewall rules if you no longer need ports 80/443 open."
