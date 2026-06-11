import type { Request, Response, NextFunction } from 'express'
import { db } from '../db/index.js'
import { auditLog } from '../db/schema.js'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'token',
  'refreshToken',
  'refresh_token',
  'secret',
  'totpSecret',
  'totp_secret',
  'totpCode',
  'backupCode',
  'mfaToken',
  'vcsToken',
  'vcs_token',
  'vcsTokenEnc',
  'githubToken',
  'github_token',
])

function redactSensitive(value: unknown): unknown {
  if (value === null || value === undefined) return value

  if (Array.isArray(value)) {
    return value.map(redactSensitive)
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}

    for (const [key, nested] of Object.entries(value)) {
      result[key] = SENSITIVE_KEYS.has(key) ? '[REDACTED]' : redactSensitive(nested)
    }

    return result
  }

  return value
}

function extractTarget(req: Request): { targetType: string | null; targetId: string | null } {
  const params = req.params as Record<string, string | undefined>
  const priority = ['id', 'instanceId', 'serverId', 'appId', 'userId', 'pgServerId'] as const

  for (const key of priority) {
    const value = params[key]
    if (value) {
      return { targetType: key.replace(/Id$/, ''), targetId: value }
    }
  }

  const body = req.body as Record<string, unknown> | undefined
  if (body && typeof body.id === 'string') {
    return { targetType: 'resource', targetId: body.id }
  }

  return { targetType: null, targetId: null }
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATION_METHODS.has(req.method.toUpperCase())) {
    next()
    return
  }

  const detail =
    req.body && typeof req.body === 'object'
      ? (redactSensitive(req.body) as Record<string, unknown>)
      : null

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return

    const { targetType, targetId } = extractTarget(req)
    const action = `${req.method.toUpperCase()} ${req.baseUrl}${req.path}`

    db.insert(auditLog)
      .values({
        action,
        actorId: req.user?.userId ?? null,
        actorUsername: req.user?.username ?? (req.deployTokenId ? 'deploy-token' : null),
        targetType,
        targetId,
        detail,
        ip: req.ip ?? null,
      })
      .run()
  })

  next()
}
