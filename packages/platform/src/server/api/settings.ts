import { Router } from 'express'
import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { requireRole } from '../middleware/rbac.js'
import { db } from '../db/index.js'
import { settings } from '../db/schema.js'
import { decrypt, encrypt } from '../utils/crypto.js'

import { routeParam } from './helpers.js'

const SettingKeySchema = z.string().regex(/^[a-z0-9_]+$/).max(100)

const router: Router = Router()

const SENSITIVE_KEYS = new Set([
  'github_token',
  'vcs_token',
  'smtp_password',
  'webhook_secret',
  'encryption_key',
  'jwt_secret',
])

const UpdateSettingsSchema = z.object({
  settings: z.record(z.union([z.string(), z.number(), z.boolean()])),
})

function maskValue(key: string, value: string, isSensitive: boolean): string {
  if (isSensitive || SENSITIVE_KEYS.has(key)) {
    try {
      decrypt(value)
      return '[encrypted]'
    } catch {
      return value ? '[set]' : ''
    }
  }
  return value
}

router.get('/', requireRole('superadmin'), (_req, res) => {
  const rows = db.select().from(settings).all()

  res.json(
    rows.map((row) => ({
      key: row.key,
      value: maskValue(row.key, row.value, row.isSensitive),
      isSensitive: row.isSensitive || SENSITIVE_KEYS.has(row.key),
      updatedAt: row.updatedAt,
    })),
  )
})

router.get('/:key', requireRole('superadmin'), (req, res) => {
  const keyResult = SettingKeySchema.safeParse(routeParam(req, 'key'))
  if (!keyResult.success) {
    res.status(400).json({ error: 'Invalid setting key' })
    return
  }

  const row = db.select().from(settings).where(eq(settings.key, keyResult.data)).get()
  if (!row) {
    res.status(404).json({ error: 'Setting not found' })
    return
  }

  res.json({
    key: row.key,
    value: maskValue(row.key, row.value, row.isSensitive),
    isSensitive: row.isSensitive || SENSITIVE_KEYS.has(row.key),
    updatedAt: row.updatedAt,
  })
})

router.put('/', requireRole('superadmin'), (req, res) => {
  const body = UpdateSettingsSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const now = new Date().toISOString()

  for (const [key, rawValue] of Object.entries(body.data.settings)) {
    const value = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue)
    const isSensitive = SENSITIVE_KEYS.has(key)
    const storedValue = isSensitive ? encrypt(value) : value

    db.insert(settings)
      .values({ key, value: storedValue, isSensitive, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: storedValue, isSensitive, updatedAt: now },
      })
      .run()
  }

  res.json({ ok: true })
})

router.put('/:key', requireRole('superadmin'), (req, res) => {
  const ValueSchema = z.object({ value: z.union([z.string(), z.number(), z.boolean()]) })
  const body = ValueSchema.safeParse(req.body)

  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const keyResult = SettingKeySchema.safeParse(routeParam(req, 'key'))
  if (!keyResult.success) {
    res.status(400).json({ error: 'Invalid setting key' })
    return
  }

  const key = keyResult.data
  const rawValue = typeof body.data.value === 'string' ? body.data.value : JSON.stringify(body.data.value)
  const isSensitive = SENSITIVE_KEYS.has(key)
  const storedValue = isSensitive ? encrypt(rawValue) : rawValue
  const now = new Date().toISOString()

  db.insert(settings)
    .values({ key, value: storedValue, isSensitive, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: storedValue, isSensitive, updatedAt: now },
    })
    .run()

  res.json({ ok: true })
})

export function getSettingValue(key: string, fallback = ''): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get()
  if (!row) return fallback

  if (row.isSensitive || SENSITIVE_KEYS.has(key)) {
    try {
      return decrypt(row.value)
    } catch {
      return fallback
    }
  }

  return row.value
}

export function getSettings(keys: string[]): Record<string, string> {
  const rows = db.select().from(settings).where(inArray(settings.key, keys)).all()
  const result: Record<string, string> = {}

  for (const row of rows) {
    if (row.isSensitive || SENSITIVE_KEYS.has(row.key)) {
      try {
        result[row.key] = decrypt(row.value)
      } catch {
        result[row.key] = ''
      }
    } else {
      result[row.key] = row.value
    }
  }

  return result
}

export default router
