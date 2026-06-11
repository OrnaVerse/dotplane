# Runtime Requirements

Dotplane runs on Linux servers. This document lists minimum and recommended resources for the Platform (control plane) and Agent (managed servers).

## Supported Operating Systems

| OS | Version | Notes |
|----|---------|-------|
| Ubuntu | 22.04 LTS, 24.04 LTS | Primary target |
| Debian | 12 (Bookworm) | Fully supported |
| Other systemd distros | — | May work; not officially tested |

**Not supported:** Windows, macOS (except local development), container-only deployments without systemd.

## Architecture

| Platform | Agent |
|----------|-------|
| x86_64 (amd64) | x86_64 (amd64) |
| aarch64 (arm64) | aarch64 (arm64) |

## Platform Server (control plane)

Runs the web UI, API, SQLite database, artifact cache, and optionally a co-located Agent on the same host.

### Minimum

| Resource | Value |
|----------|-------|
| CPU | 2 vCPU |
| RAM | 2 GB |
| Disk | 20 GB SSD |
| Network | Public IP or reverse proxy with TLS |

### Recommended (≤ 50 instances across fleet)

| Resource | Value |
|----------|-------|
| CPU | 4 vCPU |
| RAM | 4–8 GB |
| Disk | 50 GB SSD (+ artifact storage) |

### Software dependencies (installed by `scripts/install.sh`)

- **Node.js 20 LTS** — via [fnm](https://github.com/Schniz/fnm)
- **Caddy 2** — prebuilt binary; use [xcaddy](https://github.com/caddyserver/xcaddy) for custom modules
- **.NET 8 SDK** — for building/publishing apps managed on this server
- **SQLite 3** — embedded database (`better-sqlite3`, WAL mode)
- **OpenSSL** — mTLS certificate generation
- **UFW** — firewall (ports 22, 80, 443)
- **fail2ban** — SSH brute-force protection

### Reserved ports

| Port | Service |
|------|---------|
| 443 | Caddy (TLS termination → Platform UI/API) |
| 80 | Caddy HTTP (optional redirect) |
| 2019 | Caddy admin API (localhost only) |
| 49152–65535 | Platform internal port (random at install) |
| 7823 | Agent mTLS (localhost only) |
| 5100+ | .NET instance Kestrel ports (per instance) |

### Data directories

| Path | Purpose | Permissions |
|------|---------|-------------|
| `/opt/dotplane/` | Platform install | `700` |
| `/opt/dotplane/data/dotplane.db` | SQLite database | `600` (via parent dir) |
| `/opt/dotplane/data/backups/` | Daily DB backups | `700` |
| `/var/dotplane/instances/` | Deployed app files | `755` |
| `/var/dotplane/artifacts/` | Release artifact cache | `755` |
| `/var/log/dotplane/` | Error and backup logs | `755` |

## Agent Server (managed node)

Runs the Agent daemon, Caddy (instance routes), systemd app units, and .NET runtimes. No database.

### Minimum per agent

| Resource | Value |
|----------|-------|
| CPU | 2 vCPU |
| RAM | 2 GB + instance tiers |
| Disk | 10 GB + app/uploads storage |

Add instance memory per tier:

| Tier | MemoryMax |
|------|-----------|
| minimal | 256 MB |
| standard | 512 MB |
| professional | 768 MB |
| enterprise | 1024 MB |

### Software dependencies (installed by `scripts/install-agent.sh`)

- Node.js 20 (fnm)
- Caddy 2 (prebuilt)
- .NET 8 SDK (additional runtime versions installed on demand via Platform SDK page)

## Network requirements

- **Platform → Agent:** mTLS over HTTPS to `127.0.0.1:7823` (Agent binds localhost; Platform connects via SSH tunnel or same-host)
- **Agent → Platform:** HTTPS for bootstrap download and heartbeat
- **CI → Platform:** HTTPS with deploy token or `dotplane-remote login` JWT
- **Browser → Platform:** HTTPS via Caddy; URL key path prefix required

## Environment variables

See `scripts/install.sh` for the full `.env` template. Critical values:

```bash
DB_PATH=/opt/dotplane/data/dotplane.db
ENCRYPTION_KEY=<32-byte hex>    # AES-256 for encrypted settings
PLATFORM_URL_KEY=ov_<random>    # Secret URL prefix
MTLS_CA_CERT_PATH=...
MTLS_CLIENT_CERT_PATH=...
MTLS_CLIENT_KEY_PATH=...
```

## Backup

Daily SQLite backup runs at 02:00 UTC via cron (configured by `install.sh`). Retains 30 days in `BACKUP_DIR`.

Manual backup:

```bash
cd /opt/dotplane/packages/platform
node dist/server/cli.js backup
```

## Development (local)

| Requirement | Version |
|-------------|---------|
| Node.js | 20+ |
| pnpm | 9+ |
| .NET SDK | 8.0+ |

SQLite database defaults to `./data/dotplane.db` relative to the platform package.
