import { Router } from 'express'
import argon2 from 'argon2'
import crypto from 'crypto'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { requireRole } from '../middleware/rbac.js'
import { db } from '../db/index.js'
import {
  invites,
  sessions,
  userBackupCodes,
  userInstanceAccess,
  users,
} from '../db/schema.js'
import type { UserRole } from '../auth/tokens.js'

import { routeParam } from './helpers.js'

const router: Router = Router()

const CreateUserSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
  role: z.enum(['superadmin', 'manager', 'viewer']).default('viewer'),
  instanceIds: z.array(z.string()).optional(),
})

const UpdateUserSchema = z.object({
  role: z.enum(['superadmin', 'manager', 'viewer']).optional(),
  isActive: z.boolean().optional(),
  instanceIds: z.array(z.string()).optional(),
})

const InviteSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(['manager', 'viewer']).default('viewer'),
  instanceIds: z.array(z.string()).optional(),
  expiresInHours: z.number().int().min(1).max(168).default(24),
})

const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(128),
})

function sanitizeUser(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isActive: row.isActive,
    lastLogin: row.lastLogin,
    createdAt: row.createdAt,
    totpEnabled: row.totpEnabled,
  }
}

router.get('/', requireRole('superadmin'), (_req, res) => {
  const rows = db.select().from(users).all()
  res.json(rows.map(sanitizeUser))
})

router.get('/:id', requireRole('superadmin'), (req, res) => {
  const user = db.select().from(users).where(eq(users.id, Number.parseInt(routeParam(req, 'id'), 10))).get()
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const scope = db
    .select({ instanceId: userInstanceAccess.instanceId })
    .from(userInstanceAccess)
    .where(eq(userInstanceAccess.userId, user.id))
    .all()

  res.json({ ...sanitizeUser(user), instanceIds: scope.map((s) => s.instanceId) })
})

router.post('/', requireRole('superadmin'), async (req, res) => {
  const body = CreateUserSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const existing = db.select().from(users).where(eq(users.username, body.data.username)).get()
  if (existing) {
    res.status(409).json({ error: 'Username already exists' })
    return
  }

  const passwordHash = await argon2.hash(body.data.password, { type: argon2.argon2id })

  const created = db
    .insert(users)
    .values({
      username: body.data.username,
      passwordHash,
      role: body.data.role,
      createdBy: req.user?.userId ?? null,
    })
    .returning({ id: users.id })
    .get()

  if (created && body.data.role === 'manager' && body.data.instanceIds?.length) {
    for (const instanceId of body.data.instanceIds) {
      db.insert(userInstanceAccess).values({ userId: created.id, instanceId }).run()
    }
  }

  res.status(201).json({ id: created?.id })
})

router.patch('/:id', requireRole('superadmin'), async (req, res) => {
  const body = UpdateUserSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const userId = Number.parseInt(routeParam(req, 'id'), 10)
  const user = db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  db.update(users)
    .set({
      ...(body.data.role !== undefined ? { role: body.data.role } : {}),
      ...(body.data.isActive !== undefined ? { isActive: body.data.isActive } : {}),
    })
    .where(eq(users.id, userId))
    .run()

  if (body.data.instanceIds !== undefined) {
    db.delete(userInstanceAccess).where(eq(userInstanceAccess.userId, userId)).run()
    for (const instanceId of body.data.instanceIds) {
      db.insert(userInstanceAccess).values({ userId, instanceId }).run()
    }
  }

  res.json({ ok: true })
})

router.delete('/:id', requireRole('superadmin'), (req, res) => {
  const userId = Number.parseInt(routeParam(req, 'id'), 10)

  if (req.user?.userId === userId) {
    res.status(400).json({ error: 'Cannot delete your own account' })
    return
  }

  const user = db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  db.delete(users).where(eq(users.id, userId)).run()
  res.json({ ok: true })
})

router.post('/invites', requireRole('superadmin'), (req, res) => {
  const body = InviteSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const token = `inv_${crypto.randomBytes(16).toString('hex')}`
  const expiresAt = new Date(Date.now() + body.data.expiresInHours * 60 * 60 * 1000).toISOString()

  db.insert(invites)
    .values({
      token,
      email: body.data.email ?? null,
      role: body.data.role,
      createdBy: req.user?.userId ?? null,
      expiresAt,
    })
    .run()

  res.status(201).json({ token, expiresAt, role: body.data.role })
})

router.post('/invites/accept', async (req, res) => {
  const body = AcceptInviteSchema.safeParse(req.body)
  if (!body.success) {
    res.status(400).json({ error: body.error.flatten() })
    return
  }

  const invite = db.select().from(invites).where(eq(invites.token, body.data.token)).get()
  if (!invite || invite.usedAt || new Date(invite.expiresAt) <= new Date()) {
    res.status(400).json({ error: 'Invalid or expired invite' })
    return
  }

  const existing = db.select().from(users).where(eq(users.username, body.data.username)).get()
  if (existing) {
    res.status(409).json({ error: 'Username already exists' })
    return
  }

  const passwordHash = await argon2.hash(body.data.password, { type: argon2.argon2id })

  const created = db
    .insert(users)
    .values({
      username: body.data.username,
      passwordHash,
      role: invite.role as UserRole,
      createdBy: invite.createdBy,
    })
    .returning({ id: users.id })
    .get()

  if (created) {
    db.update(invites)
      .set({ usedAt: new Date().toISOString(), usedBy: created.id })
      .where(eq(invites.token, body.data.token))
      .run()
  }

  res.status(201).json({ id: created?.id })
})

router.get('/:id/sessions', requireRole('superadmin'), (req, res) => {
  const userId = Number.parseInt(routeParam(req, 'id'), 10)
  const rows = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.revoked, false)))
    .orderBy(desc(sessions.createdAt))
    .all()

  res.json(rows.map((s) => ({
    sessionId: s.sessionId,
    ip: s.ip,
    userAgent: s.userAgent,
    expiresAt: s.expiresAt,
    createdAt: s.createdAt,
  })))
})

router.post('/:id/sessions/:sessionId/revoke', requireRole('superadmin'), (req, res) => {
  db.update(sessions)
    .set({ revoked: true })
    .where(and(eq(sessions.userId, Number.parseInt(routeParam(req, 'id'), 10)), eq(sessions.sessionId, routeParam(req, 'sessionId'))))
    .run()

  res.json({ ok: true })
})

router.post('/:id/2fa-reset', requireRole('superadmin'), (req, res) => {
  const userId = Number.parseInt(routeParam(req, 'id'), 10)
  const user = db.select().from(users).where(eq(users.id, userId)).get()
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  db.update(users)
    .set({ totpSecretEnc: null, totpEnabled: false })
    .where(eq(users.id, userId))
    .run()

  db.delete(userBackupCodes).where(eq(userBackupCodes.userId, userId)).run()

  res.json({ ok: true })
})

export default router
