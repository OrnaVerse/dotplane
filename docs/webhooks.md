# Webhooks

Dotplane fires **outbound webhooks** when platform events occur. Use them to notify Slack, PagerDuty, internal services, or trigger downstream automation after deploys and health changes.

## Overview

```
Platform event (deploy complete, health change, …)
        │
        ▼
  webhook.service.ts
        │
        ├─ Load active hooks from outbound_webhooks table
        ├─ Filter by subscribed events
        ├─ Sign payload with HMAC-SHA256
        └─ POST to each subscriber URL (3 retries, exponential backoff)
```

Webhooks are **outbound only** — Dotplane POSTs to your URL. Inbound webhooks from GitHub/GitLab/Azure/Bitbucket are handled separately via deploy tokens and CI pipelines (see `docs/ci-examples/`).

## Configuration

Configure webhooks in the Platform UI under **Settings → Webhooks**, or insert directly into the `outbound_webhooks` table.

| Field | Description |
|-------|-------------|
| `name` | Human label (e.g. "Slack deploy alerts") |
| `url` | HTTPS endpoint to receive POST requests |
| `secret` | Shared secret for HMAC signature verification |
| `events` | JSON array of event names, or `["*"]` for all |
| `is_active` | Enable/disable without deleting |

## Request format

Every delivery is a `POST` with JSON body:

```http
POST /your/endpoint HTTP/1.1
Content-Type: application/json
X-Dotplane-Event: deploy.completed
X-Dotplane-Signature: sha256=<hex-digest>
```

```json
{
  "event": "deploy.completed",
  "timestamp": "2026-06-11T14:23:01.000Z",
  "data": {
    "instanceId": "mehta-jewels",
    "version": "v1.4.3",
    "status": "success",
    "deploymentId": 42
  }
}
```

### Signature verification

The signature is `HMAC-SHA256(secret, raw_request_body)` as a hex string.

Node.js example:

```javascript
import crypto from 'crypto'

function verify(secret, body, signatureHeader) {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
}
```

Always verify the signature before trusting payload contents. Use the raw request body — do not re-serialize JSON.

## Event catalog

| Event | When fired | `data` fields |
|-------|------------|---------------|
| `deploy.started` | Deploy begins | `instanceId`, `version`, `deploymentId` |
| `deploy.completed` | Deploy succeeds | `instanceId`, `version`, `deploymentId`, `healthStatus` |
| `deploy.failed` | Deploy fails | `instanceId`, `version`, `deploymentId`, `error` |
| `deploy.all.completed` | Rolling deploy-all finishes | `appId`, `version`, `results` |
| `instance.health.changed` | Health status transition | `instanceId`, `from`, `to` |
| `instance.restarts.high` | Restart count exceeds threshold | `instanceId`, `restartCount` |
| `agent.offline` | Agent stops reporting | `serverId`, `lastSeen` |
| `agent.online` | Agent reconnects | `serverId` |
| `provision.completed` | New instance provisioned | `instanceId`, `domain`, `serverId` |
| `provision.failed` | Provisioning job failed | `jobId`, `error` |
| `release.uploaded` | Artifact uploaded via CLI/UI | `appId`, `version`, `sizeBytes` |
| `release.synced` | Releases synced from VCS | `appId`, `version` |

Subscribe to `"*"` to receive all events.

## Retry behaviour

- **Max retries:** 3
- **Backoff:** 1s, 2s, 3s between attempts
- **Timeout:** 10 seconds per request
- **Non-2xx responses:** Treated as failure, retried
- **Last status:** Stored in `outbound_webhooks.last_status` (HTTP code or `0` on network error)

Design your endpoint to be **idempotent** — the same event may be delivered more than once if a retry succeeds after your server already processed the first attempt.

## Example: Slack incoming webhook adapter

```javascript
// Minimal Express adapter — verify signature in production
app.post('/dotplane', express.raw({ type: 'application/json' }), (req, res) => {
  const payload = JSON.parse(req.body.toString())
  if (payload.event === 'deploy.completed') {
    // Forward to Slack webhook URL
  }
  res.sendStatus(200)
})
```

Return `200` quickly; process asynchronously for slow integrations.

## CI-triggered deploys vs outbound webhooks

| Mechanism | Direction | Auth | Use case |
|-----------|-----------|------|----------|
| Deploy token + `/api/releases/sync` | Inbound to Platform | Bearer deploy token | CI publishes release, triggers sync |
| `dotplane-remote deploy` | Inbound to Platform | JWT (CLI login) | Manual or scripted deploy |
| Outbound webhooks | Platform → your URL | HMAC signature | Notify after Platform events |

See `docs/ci-examples/github-actions.yml` for CI integration patterns.

## Security recommendations

1. Use HTTPS endpoints only.
2. Rotate webhook secrets periodically; update both Platform and subscriber.
3. Verify `X-Dotplane-Signature` on every request.
4. Restrict subscriber endpoints to known IP ranges if possible.
5. Do not log full payloads if they contain instance env var hints.
