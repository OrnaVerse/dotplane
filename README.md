# Dotplane

Self-hosted .NET and Node.js hosting platform with multi-server fleet management, RBAC, VCS/manual deploys, PostgreSQL monitoring, and a Mantine-based dashboard.

## Structure

```
packages/
  platform/   # Express API + React dashboard (SQLite + Drizzle)
  agent/      # Server-side agent (systemd, Caddy, deploy)
  cli/        # dotplane-remote CLI for CI/CD
scripts/      # install.sh, bootstrap-install.sh, install-agent.sh
systemd/      # dotnet-app@.service template
docs/         # CI examples, security, webhooks
```

## Development

```bash
pnpm install
cp .env.example packages/platform/.env
cd packages/platform
pnpm db:migrate
pnpm dev
```

Dashboard: `http://localhost:5173/dev` (Vite) proxied to API at `http://127.0.0.1:3000/dev/api`.

---

## Production install

### Option A — One-line install from GitHub Release (recommended)

Push a version tag to trigger the release workflow, then on your Linux server:

```bash
curl -fsSL https://raw.githubusercontent.com/OrnaVerse/dotplane/main/scripts/bootstrap-install.sh | \
  sudo DOTPLANE_GITHUB_REPO=OrnaVerse/dotplane bash
```

The installer auto-generates a random admin username (`dp` + 10 chars) and a random 12-character password, then prints both in the final summary (also saved to `/opt/dotplane/access.txt`). Override with `DOTPLANE_ADMIN_USERNAME` / `DOTPLANE_ADMIN_PASSWORD` if needed.

Pin a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/OrnaVerse/dotplane/main/scripts/bootstrap-install.sh | \
  sudo DOTPLANE_GITHUB_REPO=OrnaVerse/dotplane DOTPLANE_VERSION=v0.1.14 bash
```

The bootstrap script downloads the pre-built release tarball, installs system dependencies (Node, Caddy, .NET, UFW, fail2ban), generates secrets, and starts services. Native modules compile on the target server during production dependency install.

### Option B — Git clone + install (development / air-gapped)

```bash
git clone https://github.com/OrnaVerse/dotplane.git
cd dotplane
sudo bash scripts/install.sh
```

Builds from source on the server. Requires the full repo — do not copy `install.sh` alone.

### Option C — Manual release tarball (air-gapped)

```bash
# On build machine
pnpm install && pnpm -r build
bash scripts/package-release.sh v1.0.0

# On server
scp dist-releases/dotplane-v1.0.0-linux-amd64.tar.gz root@server:/tmp/
ssh root@server
tar -xzf /tmp/dotplane-v1.0.0-linux-amd64.tar.gz -C /tmp
sudo bash /tmp/dotplane-v1.0.0-linux-amd64/scripts/install.sh \
  --from-release /tmp/dotplane-v1.0.0-linux-amd64
```

### Reinstall

Uninstall the current install, then run the bootstrap command again:

```bash
# From a git checkout on the server:
sudo bash scripts/uninstall.sh --purge-data --remove-caddy

# Or download the uninstall script directly:
curl -fsSL https://raw.githubusercontent.com/OrnaVerse/dotplane/main/scripts/uninstall.sh | sudo bash -s -- --purge-data --remove-caddy
```

Then reinstall with the one-line bootstrap command above.

`uninstall.sh` options:

| Flag | Effect |
|------|--------|
| *(default)* | Stops services and removes `/opt/dotplane` (including SQLite DB) — keeps `/var/dotplane`, Caddy, Node, .NET |
| `--purge-data` | Also deletes artifacts, instances, and logs under `/var/dotplane` |
| `--remove-caddy` | Removes Caddy binary, systemd unit, and config |
| `--remove-system-deps` | Also removes fnm/Node and .NET SDK installed by Dotplane |

UFW and fail2ban are left unchanged so SSH access is not disrupted.

---

## Creating a release

```bash
# Bump version in package.json, then:
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions (`.github/workflows/release.yml`) builds platform + agent, packages `dist-releases/dotplane-{tag}-linux-amd64.tar.gz`, and attaches it to the GitHub Release.

Local packaging without CI:

```bash
pnpm -r build
pnpm release:package v1.0.0
```

---

## Additional servers (agent only)

Register the server in the Platform UI, then run the install command shown in the dashboard:

```bash
curl -fsSL "https://your-platform/ov_xxx/agent-install/TOKEN" | sudo bash
```

---

## CLI

```bash
cd packages/cli && pnpm build
dotplane-remote login --url https://host/urlkey --token dp_xxx
dotplane-remote instances list
```

Server-side admin:

```bash
node /opt/dotplane/packages/platform/dist/server/cli.js set-password 'your-username' 'your-password'
node /opt/dotplane/packages/platform/dist/server/cli.js show-access
```

If a piped install stopped before showing credentials:

```bash
sudo bash /opt/dotplane/scripts/finish-install.sh
```

Recover the panel URL from an existing install:

```bash
cd /opt/dotplane/packages/platform
sudo DOTPLANE_ENV_PATH=/opt/dotplane/.env node dist/server/cli.js show-access
# Or manually: http://<IP>:$(grep PLATFORM_PORT /opt/dotplane/.env | cut -d= -f2)/$(grep PLATFORM_URL_KEY /opt/dotplane/.env | cut -d= -f2)
```

On cloud VMs (GCP, AWS, etc.), open the `PLATFORM_PORT` TCP port in your provider's firewall — UFW on the server is not enough.

See `docs/security.md` for hardening and secret rotation.
