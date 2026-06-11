# Security

Dotplane is designed for self-hosted production use. This document covers secrets management, encryption, certificate lifecycle, and operational security practices.

## Security architecture

```
Internet
    │
    ▼
Caddy (TLS 1.2+, auto HTTPS)
    │
    ▼
Express (127.0.0.1:random port)
    ├── URL key middleware     → 404 if key missing (no panel disclosure)
    ├── helmet()               → security headers
    ├── rate limiting          → login, API, deploy endpoints
    ├── JWT auth + sessions    → 15m access token, 7d refresh (httpOnly cookie)
    ├── RBAC                   → superadmin / manager / viewer + instance scope
    └── audit log              → all mutations recorded

Platform ──mTLS──▶ Agent (localhost:7823)
                      ├── systemd (hardened units)
                      └── Caddy route API (localhost:2019)
```

## Secrets generated at install

`scripts/install.sh` generates fresh secrets — never ship defaults:

| Variable | Purpose | Rotation |
|----------|---------|----------|
| `PLATFORM_URL_KEY` | Secret URL prefix | CLI: `rotate-url-key` |
| `JWT_SECRET` | Access token signing | Requires re-login for all users |
| `REFRESH_SECRET` | Refresh token hashing | Revoke all sessions |
| `CSRF_SECRET` | CSRF double-submit cookie | Restart platform |
| `ENCRYPTION_KEY` | AES-256-GCM for sensitive DB fields | See [Encryption key rotation](#encryption-key-rotation) |

Store `/opt/dotplane/.env` with mode `600`. Directory `/opt/dotplane` should be mode `700`.

## Encryption at rest

Sensitive values (GitHub tokens, PostgreSQL credentials for monitored DBs, etc.) are encrypted with **AES-256-GCM** before storage in SQLite.

```typescript
// Format: iv:authTag:ciphertext (all hex)
encrypt(plaintext) → "a1b2...:c3d4...:e5f6..."
```

The key is read from `ENCRYPTION_KEY` (32-byte hex = 256 bits). Decryption fails closed if the key is wrong or ciphertext is tampered.

### Encrypted fields

- `apps.github_token` and per-app VCS tokens
- `settings` rows marked `is_sensitive = true`
- `pg_servers.pg_user_enc`, `pg_servers.pg_pass_enc`

Non-sensitive configuration (batch sizes, timeouts) is stored in plaintext.

## Encryption key rotation

Rotating `ENCRYPTION_KEY` requires re-encrypting all ciphertext in the database with the new key. A partial rotation leaves the platform unable to decrypt VCS tokens and DB monitor credentials.

### Prerequisites

- Maintenance window (deploys and VCS sync will fail mid-rotation)
- Full SQLite backup: `node dist/server/cli.js backup`
- Both old and new 32-byte hex keys available

### Procedure

1. **Generate new key**

   ```bash
   NEW_KEY=$(openssl rand -hex 32)
   echo "New key: $NEW_KEY"  # store in password manager
   ```

2. **Run re-encryption script** (Platform CLI)

   ```bash
   cd /opt/dotplane/packages/platform
   node dist/server/cli.js rotate-encryption-key "$NEW_KEY"
   ```

   The CLI should:
   - Read all rows with encrypted values
   - Decrypt with current `ENCRYPTION_KEY`
   - Re-encrypt with `NEW_KEY`
   - Update `.env` atomically
   - Verify a round-trip decrypt on a sample row

3. **Restart Platform**

   ```bash
   systemctl restart dotplane
   ```

4. **Verify**

   - Trigger a release sync (confirms VCS token decrypt works)
   - Check Settings page loads encrypted values
   - Review `/var/log/dotplane/error.log` for decrypt failures

5. **Securely destroy the old key** after confirming success.

### If rotation fails mid-way

1. Stop Platform: `systemctl stop dotplane`
2. Restore SQLite from backup taken in step 1
3. Restore original `.env`
4. Start Platform and investigate before retrying

### Key rotation schedule

| Environment | Recommended frequency |
|-------------|----------------------|
| Production | Annually, or after personnel change |
| After suspected compromise | Immediately |
| Development | Only if test data matters |

Document each rotation in your change log with date and operator — not the key itself.

## mTLS (Platform ↔ Agent)

- Platform acts as **TLS client** with `platform.crt` / `platform.key`
- Agent acts as **TLS server** with `agent.crt` / `agent.key`
- Both trust the same CA (`ca.crt`)
- Agent listens on `127.0.0.1:7823` only — not exposed to the internet

### Certificate rotation

1. Generate new certs: `CERT_DIR=/opt/dotplane/certs SERVER_ID=<id> HOSTNAME=<ip> ./scripts/generate-certs.sh`
2. Distribute agent certs via bootstrap or manual copy to `/opt/dotplane-agent/certs/`
3. Restart agent and platform
4. CA rotation requires re-issuing **all** platform and agent certs

Private keys: mode `600`. Cert directory: mode `700`.

## Authentication hardening

- **Passwords:** Argon2id (`m=65536, t=3, p=4`)
- **Login rate limit:** 5 attempts / minute per IP
- **Deploy rate limit:** 10 requests / minute per user
- **2FA:** TOTP supported for all roles (see auth routes)
- **Sessions:** Refresh token rotation on each use; revocable per session
- **Deploy tokens:** SHA-256 hashed at rest; scoped to app or global

## Network hardening (install.sh defaults)

**UFW:**

- Deny incoming by default
- Allow: SSH (22), HTTP (80), HTTPS (443)

**fail2ban:**

- SSH jail: 5 failures in 10 minutes → 1 hour ban

Restrict Platform admin access further with VPN or IP allowlisting at the firewall if exposed to the internet.

## Instance isolation (systemd)

Each .NET app runs as `www-data` with:

- `NoNewPrivileges=true`
- `ProtectSystem=strict`
- `PrivateTmp=true`
- `MemoryMax` / `CPUQuota` per tier
- `ReadWritePaths` limited to instance directory

Deploy logic **never overwrites** `uploads/` or `appsettings*.json` — enforced in Agent code, not convention.

## Audit trail

All POST/PUT/DELETE operations write to `audit_log` with actor, action, target, IP, and redacted params. Sensitive fields (`password`, `token`, `secret`) are stripped before persistence.

Superadmins can review audit history in the UI. Export periodically for compliance retention.

## Deploy token hygiene

1. Create per-CI-pipeline tokens (name: "GitHub Actions — OrnaVerse")
2. Scope to single `app_id` when possible
3. Rotate after team member departure
4. Never commit tokens — use CI secret stores
5. Revoke unused tokens in Settings

## Reporting vulnerabilities

Self-hosted deployments are operator-managed. Review audit logs, rotate secrets, and restore from backup if compromise is suspected. For upstream Dotplane security issues, contact your platform maintainer directly — do not disclose secrets in bug reports.
